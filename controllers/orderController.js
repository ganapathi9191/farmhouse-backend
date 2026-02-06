import { Farmhouse } from "../models/farmhouseModel.js";
import { Booking } from "../models/bookingModel.js";
import { User } from "../models/User.js";
import { VerificationToken } from "../models/verificationTokenModel.js";
import { calculateCheckTimes } from "../utils/timeHelper.js";
import { FeeConfig } from "../models/feeConfigModel.js";
import razorpay from "../config/razorpay.js";
import crypto from "crypto";

// ============================================
// VERIFY SLOT AVAILABILITY (Returns verification token)
// ============================================
// ============================================
// VERIFY SLOT AVAILABILITY (DEBUG VERSION)
// ============================================
export const verifySlotAvailability = async (req, res) => {
  try {
    const { userId, farmhouseId, date, label, timing } = req.body;

    console.log("🔍 Verifying slot - Received data:", {
      userId,
      farmhouseId,
      date,
      label,
      timing
    });

    if (!userId || !farmhouseId || !date || !label || !timing) {
      return res.status(400).json({
        success: false,
        message: "userId, farmhouseId, date, label, and timing are required"
      });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Get farmhouse
    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({
        success: false,
        message: "Farmhouse not found"
      });
    }

    console.log("📊 Farmhouse timePrices:", farmhouse.timePrices);
    console.log("🔍 Looking for slot with label:", label, "and timing:", timing);

    // Normalize the timing from request (remove spaces)
    const normalizedTiming = timing.replace(/\s+/g, '').toLowerCase();
    console.log("🔄 Normalized timing from request:", normalizedTiming);

    // Find slot in timePrices
    const slot = farmhouse.timePrices.find(tp => {
      // Normalize stored timing too
      const storedTiming = tp.timing ? tp.timing.replace(/\s+/g, '').toLowerCase() : '';
      console.log(`Comparing: label "${tp.label}" === "${label}"? ${tp.label === label}`);
      console.log(`Comparing: timing "${storedTiming}" === "${normalizedTiming}"? ${storedTiming === normalizedTiming}`);

      return tp.label === label && storedTiming === normalizedTiming;
    });

    console.log("🎯 Found slot:", slot);

    if (!slot) {
      // Log all available slots for debugging
      const availableSlots = farmhouse.timePrices.map(tp => ({
        label: tp.label,
        timing: tp.timing,
        price: tp.price
      }));

      return res.status(404).json({
        success: false,
        message: "Slot not found",
        debug: {
          requested: { label, timing, normalizedTiming },
          availableSlots: availableSlots
        }
      });
    }

    // Calculate check times
    const { checkIn, checkOut } = calculateCheckTimes(date, timing);
    console.log("⏰ Calculated times:", { checkIn, checkOut });

    // Check availability
    const overlap = farmhouse.bookedSlots.some(
      (b) => checkIn < b.checkOut && checkOut > b.checkIn
    );

    console.log("📅 Slot overlap check:", overlap ? "Already booked" : "Available");

    if (overlap) {
      return res.status(400).json({
        success: false,
        message: "This slot is already booked"
      });
    }

    // Check if user already booked this slot
    const userBooked = farmhouse.bookedSlots.some(
      (b) =>
        b.userId &&
        b.userId.toString() === userId &&
        checkIn < b.checkOut &&
        checkOut > b.checkIn
    );

    if (userBooked) {
      return res.status(400).json({
        success: false,
        message: "You have already booked this slot"
      });
    }

    // Get fee configuration
    let feeConfig = await FeeConfig.findOne({ isActive: true });
    if (!feeConfig) {
      feeConfig = await FeeConfig.create({});
    }

    // Calculate total amount
    const slotPrice = slot.price || 0;
    const cleaningFee = feeConfig.cleaningFee || 0;
    const serviceFee = feeConfig.serviceFee || 0;
    const totalAmount = slotPrice + cleaningFee + serviceFee;

    // Generate verification token
    const verificationId = `VERIFY_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Delete old pending verifications
    await VerificationToken.deleteMany({
      userId,
      farmhouseId,
      "slotDetails.label": label,
      "slotDetails.timing": timing,
      "slotDetails.date": new Date(date),
      status: "pending"
    });

    // Create verification token
    await VerificationToken.create({
      userId,
      farmhouseId,
      verificationId,
      slotDetails: {
        date: new Date(date),
        label,
        timing,
        checkIn,
        checkOut,
        price: slotPrice
      },
      priceBreakdown: {
        slotPrice,
        cleaningFee,
        serviceFee,
        totalAmount
      },
      expiresAt,
      status: "pending"
    });

    console.log("✅ Verification token created:", verificationId);

    res.json({
      success: true,
      available: true,
      verificationId,
      expiresAt,
      slotDetails: {
        label: slot.label,
        timing: slot.timing,
        price: slotPrice,
        checkIn,
        checkOut
      },
      priceBreakdown: {
        slotPrice,
        cleaningFee,
        serviceFee,
        totalAmount
      },
      farmhouse: {
        name: farmhouse.name,
        address: farmhouse.address,
        images: farmhouse.images
      },
      message: "Slot is available. Use verificationId to create booking within 10 minutes."
    });
  } catch (err) {
    console.error("❌ Error verifying slot:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// =====================================================
// CREATE BOOKING (PAYMENT-ID BASED)
// =====================================================
export const createBooking = async (req, res) => {
  try {
    const { verificationId, transactionId, userId } = req.body;

    if (!verificationId || !transactionId || !userId) {
      return res.status(400).json({
        success: false,
        message: "verificationId, transactionId, userId are required"
      });
    }

    const token = await VerificationToken.findOne({
      verificationId,
      status: "pending",
      expiresAt: { $gt: new Date() }
    }).populate("userId farmhouseId");

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verificationId"
      });
    }

    if (token.userId._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized booking attempt"
      });
    }

    /* =======================
       VERIFY PAYMENT (FIXED)
    ======================= */
    let payment;
    try {
      payment = await razorpay.payments.fetch(transactionId);
    } catch {
      return res.status(400).json({
        success: false,
        message: "Invalid Razorpay payment ID"
      });
    }

    if (!["captured", "authorized"].includes(payment.status)) {
      return res.status(400).json({
        success: false,
        message: "Payment not completed",
        razorpayStatus: payment.status
      });
    }

    /* =======================
       FINAL SLOT CHECK
    ======================= */
    const farmhouse = await Farmhouse.findById(token.farmhouseId._id);
    const { checkIn, checkOut, label, timing, date } = token.slotDetails;

    const overlap = farmhouse.bookedSlots.some(
      b => checkIn < b.checkOut && checkOut > b.checkIn
    );

    if (overlap) {
      token.status = "expired";
      await token.save();

      return res.status(400).json({
        success: false,
        message: "Slot already booked"
      });
    }

    /* =======================
       CREATE BOOKING
    ======================= */
    const booking = await Booking.create({
      userId,
      farmhouseId: farmhouse._id,
      transactionId,
      verificationId,
      razorpayPaymentId: payment.id,
      razorpayOrderId: payment.order_id,
      bookingDetails: { date, label, timing, checkIn, checkOut },
      ...token.priceBreakdown,
      status: "confirmed",
      paymentStatus: "completed"
    });

    token.status = "used";
    token.bookingId = booking._id;
    await token.save();

    farmhouse.bookedSlots.push({
      userId,
      bookingId: booking._id,
      checkIn,
      checkOut,
      label,
      timing,
      confirmed: true
    });
    await farmhouse.save();

    const user = await User.findById(userId);
    user.notifications.push({
      title: "Booking Confirmed",
      message: `Your booking at ${farmhouse.name} is confirmed`,
      type: "booking",
      referenceId: booking._id
    });
    await user.save();

    return res.status(201).json({
      success: true,
      message: "Payment verified & booking confirmed",
      bookingId: booking._id
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};




// ============================================
// GET USER BOOKINGS
// ============================================
export const getUserBookings = async (req, res) => {
  try {
    const { userId } = req.params;

    console.log("📋 Getting bookings for user:", userId);

    const bookings = await Booking.find({ userId })
      .populate("farmhouseId", "name images address")
      .sort({ createdAt: -1 });

    const formattedBookings = bookings.map(booking => ({
      _id: booking._id,
      transactionId: booking.transactionId,
      verificationId: booking.verificationId,
      farmhouse: booking.farmhouseId,
      slotDetails: booking.bookingDetails,
      priceBreakdown: {
        slotPrice: booking.slotPrice,
        cleaningFee: booking.cleaningFee,
        serviceFee: booking.serviceFee,
        totalAmount: booking.totalAmount
      },
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    }));

    res.json({
      success: true,
      count: bookings.length,
      bookings: formattedBookings
    });
  } catch (err) {
    console.error("❌ Error getting user bookings:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================
// GET BOOKING BY TRANSACTION ID
// ============================================
export const getBookingByTransactionId = async (req, res) => {
  try {
    const { transactionId } = req.params;

    console.log("🔍 Getting booking by transaction ID:", transactionId);

    const booking = await Booking.findOne({ transactionId })
      .populate("userId", "name email phone")
      .populate("farmhouseId", "name images address amenities timePrices");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    res.json({
      success: true,
      booking: {
        _id: booking._id,
        transactionId: booking.transactionId,
        verificationId: booking.verificationId,
        user: booking.userId,
        farmhouse: booking.farmhouseId,
        slotDetails: booking.bookingDetails,
        priceBreakdown: {
          slotPrice: booking.slotPrice,
          cleaningFee: booking.cleaningFee,
          serviceFee: booking.serviceFee,
          totalAmount: booking.totalAmount
        },
        razorpayOrderId: booking.razorpayOrderId,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt
      }
    });
  } catch (err) {
    console.error("❌ Error getting booking:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================
// CANCEL BOOKING
// ============================================
export const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { userId } = req.body;

    console.log("❌ Cancelling booking:", bookingId, "for user:", userId);

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    // Check if user owns this booking
    if (booking.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this booking"
      });
    }

    // Check if booking can be cancelled (not too close to check-in)
    const now = new Date();
    const hoursUntilCheckIn = (booking.bookingDetails.checkIn - now) / (1000 * 60 * 60);

    if (hoursUntilCheckIn < 24) {
      return res.status(400).json({
        success: false,
        message: "Bookings can only be cancelled at least 24 hours before check-in"
      });
    }

    // Update booking status
    booking.status = "cancelled";
    booking.paymentStatus = booking.paymentStatus === "completed" ? "refunded" : "failed";
    booking.updatedAt = new Date();
    await booking.save();

    // Remove from farmhouse's bookedSlots
    const farmhouse = await Farmhouse.findById(booking.farmhouseId);
    if (farmhouse) {
      farmhouse.bookedSlots = farmhouse.bookedSlots.filter(
        slot => slot.bookingId?.toString() !== bookingId
      );
      await farmhouse.save();
    }

    // Notify user
    const user = await User.findById(userId);
    if (user) {
      user.notifications.push({
        title: "Booking Cancelled",
        message: `Your booking (${booking.transactionId}) has been cancelled.`,
        type: "cancellation",
        referenceId: booking._id
      });
      await user.save();
    }

    console.log("✅ Booking cancelled:", bookingId);

    res.json({
      success: true,
      message: "Booking cancelled successfully",
      booking: {
        _id: booking._id,
        transactionId: booking.transactionId,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        updatedAt: booking.updatedAt
      }
    });
  } catch (err) {
    console.error("❌ Error cancelling booking:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================
// GET BOOKING HISTORY WITH FILTERS
// ============================================
export const getBookingHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, startDate, endDate, paymentStatus } = req.query;

    console.log("📜 Getting booking history for user:", userId, "with filters:", req.query);

    let filter = { userId };

    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const bookings = await Booking.find(filter)
      .populate("farmhouseId", "name images address")
      .sort({ createdAt: -1 });

    const formattedBookings = bookings.map(booking => ({
      _id: booking._id,
      transactionId: booking.transactionId,
      verificationId: booking.verificationId,
      farmhouse: booking.farmhouseId,
      slotDetails: booking.bookingDetails,
      priceBreakdown: {
        slotPrice: booking.slotPrice,
        cleaningFee: booking.cleaningFee,
        serviceFee: booking.serviceFee,
        totalAmount: booking.totalAmount
      },
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    }));

    res.json({
      success: true,
      count: bookings.length,
      bookings: formattedBookings
    });
  } catch (err) {
    console.error("❌ Error getting booking history:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================
// GET VERIFICATION STATUS
// ============================================
export const getVerificationStatus = async (req, res) => {
  try {
    const { verificationId } = req.query;

    if (!verificationId) {
      return res.status(400).json({
        success: false,
        message: "verificationId is required"
      });
    }

    const verificationToken = await VerificationToken.findOne({ verificationId })
      .populate("userId", "name email")
      .populate("farmhouseId", "name address images");

    if (!verificationToken) {
      return res.status(404).json({
        success: false,
        message: "Verification not found"
      });
    }

    const now = new Date();
    const isValid = verificationToken.status === "pending" &&
      verificationToken.expiresAt > now;

    res.json({
      success: true,
      verification: {
        id: verificationToken.verificationId,
        status: verificationToken.status,
        isValid,
        expiresAt: verificationToken.expiresAt,
        createdAt: verificationToken.createdAt,
        userId: verificationToken.userId,
        farmhouseId: verificationToken.farmhouseId,
        slotDetails: verificationToken.slotDetails,
        priceBreakdown: verificationToken.priceBreakdown
      },
      message: isValid
        ? "Verification is valid and can be used for booking"
        : verificationToken.status === "used"
          ? "Verification has already been used"
          : "Verification has expired"
    });
  } catch (err) {
    console.error("❌ Error getting verification status:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================
// GET ALL BOOKINGS (ADMIN)
// ============================================
export const getAllBookings = async (req, res) => {
  try {
    const { status, paymentStatus, startDate, endDate } = req.query;

    let filter = {};

    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const bookings = await Booking.find(filter)
      .populate("userId", "name email phone")
      .populate("farmhouseId", "name address")
      .sort({ createdAt: -1 });

    const formattedBookings = bookings.map(booking => ({
      _id: booking._id,
      transactionId: booking.transactionId,
      verificationId: booking.verificationId,
      user: booking.userId,
      farmhouse: booking.farmhouseId,
      slotDetails: booking.bookingDetails,
      priceBreakdown: {
        slotPrice: booking.slotPrice,
        cleaningFee: booking.cleaningFee,
        serviceFee: booking.serviceFee,
        totalAmount: booking.totalAmount
      },
      razorpayOrderId: booking.razorpayOrderId,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    }));

    res.json({
      success: true,
      count: bookings.length,
      bookings: formattedBookings
    });
  } catch (err) {
    console.error("❌ Error getting all bookings:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================
// GET BOOKING DETAILS BY ID
// ============================================
export const getBookingDetails = async (req, res) => {
  try {
    const { bookingId } = req.params;

    console.log("🔍 Getting booking details for:", bookingId);

    const booking = await Booking.findById(bookingId)
      .populate("userId", "name email phone")
      .populate("farmhouseId", "name images address amenities timePrices");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    res.json({
      success: true,
      booking: {
        _id: booking._id,
        transactionId: booking.transactionId,
        verificationId: booking.verificationId,
        user: booking.userId,
        farmhouse: booking.farmhouseId,
        slotDetails: booking.bookingDetails,
        priceBreakdown: {
          slotPrice: booking.slotPrice,
          cleaningFee: booking.cleaningFee,
          serviceFee: booking.serviceFee,
          totalAmount: booking.totalAmount
        },
        razorpayOrderId: booking.razorpayOrderId,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt
      }
    });
  } catch (err) {
    console.error("❌ Error getting booking details:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};