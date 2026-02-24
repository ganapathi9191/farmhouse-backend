import { Farmhouse } from "../models/farmhouseModel.js";
import { Booking } from "../models/bookingModel.js";
import { User } from "../models/User.js";
import { VerificationToken } from "../models/verificationTokenModel.js";
import { calculateCheckTimes } from "../utils/timeHelper.js";
import { FeeConfig } from "../models/feeConfigModel.js";
import razorpay from "../config/razorpay.js";
import crypto from "crypto";
import mongoose from "mongoose";
import { BookingSession } from "../models/BookingSession.js";
import { Vendor } from "../models/vendor.js";


// ===================================================== 
// VERIFY SLOT AVAILABILITY - UPDATED
// ===================================================== 
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

    // Find slot in timePrices
    const slot = farmhouse.timePrices.find(tp => 
      tp.label === label && tp.timing === timing
    );

    if (!slot) {
      return res.status(404).json({
        success: false,
        message: "Slot not found"
      });
    }

    // Calculate check times
    const { checkIn, checkOut } = calculateCheckTimes(date, timing);

    // Normalize requested date
    const requestedDateObj = new Date(date);
    requestedDateObj.setHours(0, 0, 0, 0);
    const requestedDate = requestedDateObj.toISOString().split('T')[0];

    // Check if this exact slot is already booked for this date
    const slotAlreadyBooked = farmhouse.bookedSlots.some((b) => {
      try {
        // Use date field if available, otherwise fallback to checkIn
        let bookingDate = b.date;
        if (!bookingDate && b.checkIn) {
          bookingDate = b.checkIn;
        }
        
        if (!bookingDate) return false;

        const bookedDateObj = new Date(bookingDate);
        if (isNaN(bookedDateObj.getTime())) return false;

        bookedDateObj.setHours(0, 0, 0, 0);
        const bookedDate = bookedDateObj.toISOString().split('T')[0];
        
        return bookedDate === requestedDate && 
               b.label === label && 
               b.timing === timing;
      } catch (err) {
        console.error("Error checking booked slot:", err);
        return false;
      }
    });

    if (slotAlreadyBooked) {
      return res.status(400).json({
        success: false,
        message: "This slot is already booked for the selected date"
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

    // ===================================================== 
    // CREATE TEMPORARY BOOKING SESSION
    // ===================================================== 
    const sessionId = `session_${Date.now()}_${userId}_${farmhouseId}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

    const bookingSession = await BookingSession.create({
      sessionId,
      userId,
      farmhouseId,
      slotId: slot._id,
      date: requestedDateObj,
      label,
      timing,
      price: slotPrice,
      expiresAt
    });

    console.log("✅ Slot verification completed successfully");
    console.log("📝 Created booking session:", sessionId);

    // Return session ID to frontend
    res.json({
      success: true,
      available: true,
      userId,
      farmhouseId,
      slotId: slot._id,
      sessionId: sessionId, // Send session ID to frontend
      selectedDate: date,
      slotDetails: {
        date: new Date(date),
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
      message: "Slot is available. You can proceed with booking."
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
// CREATE BOOKING - FIXED VERSION
// ===================================================== 
export const createBooking = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();

    const { userId, farmhouseId, slotId, transactionId } = req.body;

    console.log("\n========================================");
    console.log("💳 CREATE BOOKING - START");
    console.log("========================================");
    console.log("Request body:", { userId, farmhouseId, slotId, transactionId });

    // Validate required fields
    if (!userId || !farmhouseId || !slotId || !transactionId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "userId, farmhouseId, slotId, and transactionId are required"
      });
    }

    // ===================================================== 
    // STEP 1: FIND ACTIVE BOOKING SESSION
    // ===================================================== 
    console.log("\n🔍 Looking for active booking session...");
    
    // Find most recent booking session for this user and farmhouse
    const bookingSession = await BookingSession.findOne({
      userId,
      farmhouseId,
      slotId,
      expiresAt: { $gt: new Date() } // Not expired
    }).sort({ createdAt: -1 }); // Get most recent

    if (!bookingSession) {
      console.error("❌ No active booking session found!");
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "No active booking session found. Please verify slot availability first."
      });
    }

    console.log("✅ Found booking session:", bookingSession.sessionId);
    console.log("📅 Booking date from session:", bookingSession.date);
    console.log("🎯 Slot details:", bookingSession.label, bookingSession.timing);

    // ===================================================== 
    // STEP 2: USE DATE FROM BOOKING SESSION
    // ===================================================== 
    const bookingDate = bookingSession.date;
    const bookingDateForDB = new Date(bookingDate);
    bookingDateForDB.setHours(0, 0, 0, 0);
    const normalizedBookingDate = bookingDateForDB.toISOString().split('T')[0];
    
    console.log("🎯 Final booking date:", normalizedBookingDate);

    // ===================================================== 
    // STEP 3: VERIFY USER, FARMHOUSE, AND SLOT
    // ===================================================== 
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    console.log("✅ User found:", user.name);

    const farmhouse = await Farmhouse.findById(farmhouseId).session(session);
    if (!farmhouse) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Farmhouse not found"
      });
    }
    console.log("✅ Farmhouse found:", farmhouse.name);

    const slot = farmhouse.timePrices.find(
      slot => slot._id.toString() === slotId
    );

    if (!slot) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Slot not found in farmhouse"
      });
    }
    console.log("✅ Slot found:", slot.label, "-", slot.timing);

    // Verify slot matches session
    if (slot.label !== bookingSession.label || slot.timing !== bookingSession.timing) {
      console.error("❌ Slot mismatch between session and farmhouse!");
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Slot details mismatch. Please verify slot availability again."
      });
    }

    // ===================================================== 
    // STEP 4: CALCULATE CHECK TIMES
    // ===================================================== 
    console.log("\n⏰ Calculating check times...");
    const { checkIn, checkOut } = calculateCheckTimes(normalizedBookingDate, slot.timing);
    console.log("✅ Check-in:", checkIn);
    console.log("✅ Check-out:", checkOut);

    // ===================================================== 
    // STEP 5: FIX EXISTING BOOKED SLOTS WITHOUT DATE FIELD
    // ===================================================== 
    console.log("\n🔧 Ensuring all booked slots have date field...");
    for (let i = 0; i < farmhouse.bookedSlots.length; i++) {
      const bookedSlot = farmhouse.bookedSlots[i];
      if (!bookedSlot.date && bookedSlot.checkIn) {
        const slotDate = new Date(bookedSlot.checkIn);
        slotDate.setHours(0, 0, 0, 0);
        farmhouse.bookedSlots[i].date = slotDate;
      }
    }

    // ===================================================== 
    // STEP 6: RACE CONDITION CHECK
    // ===================================================== 
    console.log("\n🔒 Checking for race conditions...");
    
    const slotAlreadyBooked = farmhouse.bookedSlots.some(b => {
      try {
        if (!b.date) return false;

        const bookedDateObj = new Date(b.date);
        if (isNaN(bookedDateObj.getTime())) return false;

        bookedDateObj.setHours(0, 0, 0, 0);
        const bookedDate = bookedDateObj.toISOString().split('T')[0];
        
        return bookedDate === normalizedBookingDate && 
               b.label === slot.label && 
               b.timing === slot.timing;
      } catch (err) {
        return false;
      }
    });

    if (slotAlreadyBooked) {
      console.error("❌ Slot already booked!");
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `This ${slot.label} slot (${slot.timing}) is already booked for ${normalizedBookingDate}.`
      });
    }
    console.log("✅ No race condition detected");

    // ===================================================== 
    // STEP 7: GET FEE CONFIGURATION AND CALCULATE AMOUNTS
    // ===================================================== 
    let feeConfig = await FeeConfig.findOne({ isActive: true }).session(session);
    if (!feeConfig) {
      feeConfig = await FeeConfig.create([{
        cleaningFee: 200,
        serviceFee: 100,
        taxPercentage: 0,
        isActive: true
      }], { session });
      feeConfig = feeConfig[0];
    }

    const slotPrice = slot.price || 0;
    const cleaningFee = feeConfig.cleaningFee || 0;
    const serviceFee = feeConfig.serviceFee || 0;
    const totalAmount = slotPrice + cleaningFee + serviceFee;

    console.log("\n🧾 Price breakdown:");
    console.log("  Slot price:", slotPrice);
    console.log("  Cleaning fee:", cleaningFee);
    console.log("  Service fee:", serviceFee);
    console.log("  Total amount:", totalAmount);

    // ===================================================== 
    // STEP 8: PAYMENT PROCESSING
    // ===================================================== 
    console.log("\n💳 Verifying payment...");
    
    let paymentDetails;
    try {
      paymentDetails = await razorpay.payments.fetch(transactionId);
      console.log("Payment status:", paymentDetails.status);
      
      if (paymentDetails.status === 'authorized') {
        console.log("🔄 Capturing payment...");
        await razorpay.payments.capture(transactionId, paymentDetails.amount, paymentDetails.currency);
        paymentDetails = await razorpay.payments.fetch(transactionId);
      }
      
      if (paymentDetails.status !== 'captured') {
        throw new Error(`Payment status is ${paymentDetails.status}`);
      }
      
      console.log("✅ Payment verified and captured");
    } catch (paymentErr) {
      console.error("❌ Payment verification failed:", paymentErr);
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Payment verification failed: ${paymentErr.message}`
      });
    }

    // ===================================================== 
    // STEP 9: CREATE BOOKING DOCUMENT - FIXED STRUCTURE
    // ===================================================== 
    console.log("\n📝 Creating booking document...");
    const currentDate = new Date();
    
    // CRITICAL FIX: Create booking data according to your schema
    const bookingData = {
      userId: userId,
      farmhouseId: farmhouseId,
      transactionId: transactionId,
      verificationId: crypto.randomBytes(16).toString('hex'),
      razorpayOrderId: paymentDetails.order_id,
      razorpayPaymentId: transactionId,
      
      // Booking details (nested object)
      bookingDetails: {
        date: bookingDateForDB,
        label: slot.label,
        timing: slot.timing,
        checkIn: checkIn,
        checkOut: checkOut
      },
      
      // CRITICAL: These must be at the top level (required by your schema)
      slotPrice: slotPrice, // Top level - required
      cleaningFee: cleaningFee, // Top level - required
      serviceFee: serviceFee, // Top level - required
      totalAmount: totalAmount, // Top level - required
      
      // Status fields
      status: 'confirmed',
      paymentStatus: 'completed',
      
      createdAt: currentDate,
      updatedAt: currentDate
    };

    console.log("📋 Booking data to save:", JSON.stringify(bookingData, null, 2));

    const booking = await Booking.create([bookingData], { session });
    const createdBooking = booking[0];
    console.log("✅ Booking document created:", createdBooking._id);

    // ===================================================== 
    // STEP 10: ADD TO FARMHOUSE BOOKED SLOTS
    // ===================================================== 
    console.log("\n🏠 Adding to farmhouse.bookedSlots...");
    
    const bookedSlotData = {
      bookingId: createdBooking._id,
      userId: userId,
      checkIn: checkIn,
      checkOut: checkOut,
      date: bookingDateForDB,
      label: slot.label,
      timing: slot.timing,
      bookedAt: currentDate
    };

    farmhouse.bookedSlots.push(bookedSlotData);
    console.log("✅ Added to bookedSlots (total:", farmhouse.bookedSlots.length, ")");

    await farmhouse.save({ session });
    console.log("✅ Farmhouse saved successfully");

    // ===================================================== 
    // STEP 11: DELETE BOOKING SESSION
    // ===================================================== 
    await BookingSession.deleteOne({ sessionId: bookingSession.sessionId });
    console.log("✅ Deleted booking session");

    // Commit transaction
    await session.commitTransaction();
    session.endSession();
    console.log("✅ Transaction committed");

    console.log("\n========================================");
    console.log("✅ BOOKING CREATED SUCCESSFULLY");
    console.log("Booking ID:", createdBooking._id);
    console.log("Date:", normalizedBookingDate);
    console.log("Slot:", slot.label, "-", slot.timing);
    console.log("========================================\n");

    // Return response
    res.json({
      success: true,
      message: "Booking confirmed successfully",
      bookingId: createdBooking._id,
      bookingDetails: {
        bookingId: createdBooking._id,
        farmhouseName: farmhouse.name,
        slotInfo: {
          date: normalizedBookingDate,
          label: slot.label,
          timing: slot.timing,
          checkIn: checkIn,
          checkOut: checkOut
        },
        paymentInfo: {
          transactionId: transactionId,
          amount: totalAmount,
          status: 'captured'
        },
        bookingStatus: 'confirmed'
      }
    });

  } catch (err) {
    console.error("\n❌ ERROR IN CREATE BOOKING:");
    console.error(err);
    
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    // Handle specific error types
    if (err.name === 'ValidationError') {
      console.error("Validation errors:", err.errors);
      return res.status(400).json({
        success: false,
        message: "Validation error in booking data",
        errors: Object.keys(err.errors).map(key => ({
          field: key,
          message: err.errors[key].message
        }))
      });
    }

    if (err.error && err.error.description) {
      return res.status(400).json({
        success: false,
        message: `Payment error: ${err.error.description}`
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error while processing booking",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};
// =====================================================
// GET USER BOOKINGS WITH FILTERS (UPCOMING/COMPLETED/CANCELED)
// =====================================================
export const getUserBookings = async (req, res) => {
  try {
    const { userId, status } = req.query;
    
    // Validate required fields
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId format"
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

    // Get current date for comparison
    const currentDate = new Date();
    
    // Build query based on status
    let query = { userId: userId };
    let statusFilter = 'all'; // Default
    
    // IMPORTANT: Use bookingDetails.checkIn based on your Booking model schema
    switch(status) {
      case 'upcoming':
        query['bookingDetails.checkIn'] = { $gt: currentDate };
        statusFilter = 'upcoming';
        break;
        
      case 'completed':
        query['bookingDetails.checkOut'] = { $lt: currentDate };
        query.status = { $ne: 'cancelled' }; // Note: lowercase 'cancelled' from your model
        statusFilter = 'completed';
        break;
        
      case 'canceled':
        query.status = 'cancelled'; // Note: lowercase 'cancelled' from your model
        statusFilter = 'canceled';
        break;
        
      case 'active':
        query['bookingDetails.checkIn'] = { $lte: currentDate };
        query['bookingDetails.checkOut'] = { $gte: currentDate };
        query.status = { $ne: 'cancelled' }; // Note: lowercase 'cancelled' from your model
        statusFilter = 'active';
        break;
        
      default:
        // Get all bookings, no additional filters
        break;
    }

    console.log(`📋 Fetching ${statusFilter} bookings for user ${userId}`);
    
    // Fetch bookings with populated farmhouse details
    const bookings = await Booking.find(query)
      .populate('farmhouseId', 'name address images rating')
      .populate('userId', 'name email phone')
      .sort({ 'bookingDetails.checkIn': 1 }) // Sort by check-in time
      .lean();

    console.log(`✅ Found ${bookings.length} bookings`);

    // Process bookings to add calculated fields
    const processedBookings = bookings.map(booking => {
      // IMPORTANT: Use bookingDetails instead of slotDetails
      const checkInDate = new Date(booking.bookingDetails?.checkIn || booking.createdAt);
      const checkOutDate = new Date(booking.bookingDetails?.checkOut || booking.createdAt);
      
      // Use status from model (not bookingStatus)
      let bookingStatus = booking.status || 'pending';
      
      if (bookingStatus !== 'cancelled') {
        if (checkOutDate < currentDate) {
          bookingStatus = 'completed';
        } else if (checkInDate <= currentDate && checkOutDate >= currentDate) {
          bookingStatus = 'active';
        } else if (checkInDate > currentDate) {
          bookingStatus = 'upcoming';
        }
      }

      // Calculate time remaining/elapsed
      let timeInfo = {};
      if (bookingStatus === 'upcoming') {
        const timeDiff = checkInDate.getTime() - currentDate.getTime();
        const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        timeInfo = {
          timeRemaining: `${days} days, ${hours} hours`,
          startsIn: timeDiff
        };
      } else if (bookingStatus === 'completed') {
        const timeDiff = currentDate.getTime() - checkOutDate.getTime();
        const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        
        timeInfo = {
          completedAgo: `${days} days ago`,
          completedDays: days
        };
      }

      // Check if user can cancel (only upcoming bookings within cancellation window)
      const canCancel = bookingStatus === 'upcoming' && 
                       (checkInDate.getTime() - currentDate.getTime()) > 2 * 60 * 60 * 1000; // 2 hours before

      // Check if user can reschedule (only upcoming bookings)
      const canReschedule = bookingStatus === 'upcoming';

      return {
        ...booking,
        bookingStatus: bookingStatus,
        isActive: bookingStatus === 'active',
        isUpcoming: bookingStatus === 'upcoming',
        isCompleted: bookingStatus === 'completed',
        isCanceled: bookingStatus === 'cancelled',
        timeInfo,
        actions: {
          canCancel,
          canReschedule,
          canGenerateQR: bookingStatus === 'upcoming' || bookingStatus === 'active',
          canLeaveReview: bookingStatus === 'completed' && !booking.hasReviewed
        },
        formattedDates: {
          checkIn: checkInDate.toLocaleString('en-IN', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          checkOut: checkOutDate.toLocaleString('en-IN', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          bookingDate: new Date(booking.createdAt).toLocaleDateString('en-IN')
        }
      };
    });

    // Filter again after processing dynamic status (for status query)
    let filteredBookings = processedBookings;
    if (status && ['upcoming', 'completed', 'active'].includes(status)) {
      filteredBookings = processedBookings.filter(booking => 
        booking.bookingStatus === status
      );
    }

    // Calculate summary statistics
    const summary = {
      total: processedBookings.length,
      upcoming: processedBookings.filter(b => b.bookingStatus === 'upcoming').length,
      active: processedBookings.filter(b => b.bookingStatus === 'active').length,
      completed: processedBookings.filter(b => b.bookingStatus === 'completed').length,
      canceled: processedBookings.filter(b => b.bookingStatus === 'cancelled').length,
      totalSpent: processedBookings
        .filter(b => b.bookingStatus !== 'cancelled')
        .reduce((sum, booking) => sum + (booking.totalAmount || 0), 0)
    };

    const response = {
      success: true,
      message: `Bookings retrieved successfully`,
      summary,
      filters: {
        requested: status || 'all',
        applied: statusFilter,
        count: filteredBookings.length
      },
      bookings: filteredBookings
    };

    res.json(response);

  } catch (err) {
    console.error("❌ Error fetching user bookings:", err);
    
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching bookings",
      error: err.message
    });
  }
};


// =====================================================
// CANCEL BOOKING WITH REFUND
// =====================================================
export const cancelBooking = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const { bookingId, userId, reason } = req.body;
    
    console.log("❌ Cancelling booking:", { bookingId, userId, reason });

    // Validate required fields
    if (!bookingId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Booking ID and User ID are required"
      });
    }

    // Find booking
    const booking = await Booking.findOne({
      _id: bookingId,
      userId: userId
    }).session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Booking not found or unauthorized"
      });
    }

    // Check if booking can be cancelled
    const now = new Date();
    const checkIn = new Date(booking.slotDetails.checkIn);
    
    if (booking.bookingStatus === 'cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Booking is already cancelled"
      });
    }

    if (booking.bookingStatus !== 'confirmed') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Booking status is ${booking.bookingStatus}, cannot cancel`
      });
    }

    if (now >= checkIn) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Cannot cancel booking after check-in time"
      });
    }

    // Calculate refund amount based on cancellation policy
    const hoursBeforeCheckIn = Math.abs(checkIn - now) / (1000 * 60 * 60);
    let refundPercentage = 0;
    let cancellationCharges = 0;

    // Cancellation policy: 
    // - 100% refund if cancelled 24+ hours before check-in
    // - 50% refund if cancelled 12-24 hours before check-in
    // - 0% refund if cancelled less than 12 hours before check-in
    if (hoursBeforeCheckIn >= 24) {
      refundPercentage = 100;
    } else if (hoursBeforeCheckIn >= 12) {
      refundPercentage = 50;
      cancellationCharges = booking.fees.totalAmount * 0.5;
    }

    const refundAmount = (booking.fees.totalAmount * refundPercentage) / 100;

    console.log("💰 Refund calculation:", {
      hoursBeforeCheckIn,
      refundPercentage,
      refundAmount,
      cancellationCharges
    });

    // Initiate refund if applicable
    let refundDetails = null;
    if (refundAmount > 0) {
      try {
        const refund = await razorpay.payments.refund(
          booking.paymentDetails.transactionId,
          {
            amount: Math.round(refundAmount * 100), // Convert to paise
            speed: "normal",
            notes: {
              bookingId: bookingId,
              reason: reason || "Cancelled by user",
              cancelledAt: new Date().toISOString()
            }
          }
        );

        console.log("✅ Refund initiated:", refund.id);

        refundDetails = {
          refundId: refund.id,
          amount: refundAmount,
          status: refund.status,
          requestedAt: new Date(),
          processedAt: refund.processed_at ? new Date(refund.processed_at * 1000) : null,
          notes: refund.notes,
          refundTo: refund.acquirer_data || booking.paymentDetails.method
        };

      } catch (refundErr) {
        console.error("❌ Refund failed:", refundErr);
        // Continue with cancellation even if refund fails (mark for manual review)
        refundDetails = {
          refundId: `MANUAL_${Date.now()}`,
          amount: refundAmount,
          status: 'failed',
          requestedAt: new Date(),
          error: refundErr.message,
          requiresManualReview: true
        };
      }
    }

    // Update booking status
    booking.bookingStatus = 'cancelled';
    booking.cancellationDetails = {
      cancelledAt: new Date(),
      cancelledBy: userId,
      reason: reason,
      refundAmount: refundAmount,
      cancellationCharges: cancellationCharges,
      hoursBeforeCheckIn: hoursBeforeCheckIn
    };

    if (refundDetails) {
      booking.refundDetails = refundDetails;
    }

    await booking.save({ session });

    // Remove booked slot from farmhouse
    const farmhouse = await Farmhouse.findById(booking.farmhouseId).session(session);
    if (farmhouse) {
      farmhouse.bookedSlots = farmhouse.bookedSlots.filter(
        slot => slot.bookingId.toString() !== bookingId
      );
      await farmhouse.save({ session });
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    // Send cancellation notification
    try {
      // Send email/SMS notification here
      console.log("📧 Cancellation notification sent");
    } catch (notifErr) {
      console.error("⚠️ Notification failed:", notifErr);
    }

    res.json({
      success: true,
      message: "Booking cancelled successfully",
      bookingId: bookingId,
      refundInfo: {
        eligible: refundAmount > 0,
        refundAmount: refundAmount,
        cancellationCharges: cancellationCharges,
        refundStatus: refundDetails?.status || 'not_eligible',
        estimatedProcessingTime: refundAmount > 0 ? "5-7 business days" : null
      },
      cancellationDetails: {
        cancelledAt: booking.cancellationDetails.cancelledAt,
        reason: booking.cancellationDetails.reason,
        hoursBeforeCheckIn: hoursBeforeCheckIn
      }
    });

  } catch (err) {
    console.error("❌ Error cancelling booking:", err);
    
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    res.status(500).json({
      success: false,
      message: "Failed to cancel booking",
      error: err.message
    });
  }
};


// =====================================================
// GET ALL BOOKINGS WITH STATUS SUMMARY (ADMIN ONLY)
// =====================================================
export const getAllBookingsSummary = async (req, res) => {
  try {
    // Check if user is admin (optional - add your admin check)
    // if (!req.user.isAdmin) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "Access denied. Admin only."
    //   });
    // }

    const currentDate = new Date();

    // Get counts for different statuses
    const [
      totalBookings,
      pendingBookings,
      completedBookings,
      canceledBookings,
      upcomingBookings,
      activeBookings,
      recentBookings
    ] = await Promise.all([
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'pending' }),
      Booking.countDocuments({ 
        status: 'confirmed',
        'bookingDetails.checkOut': { $lt: currentDate }
      }),
      Booking.countDocuments({ status: 'cancelled' }),
      Booking.countDocuments({ 
        status: 'confirmed',
        'bookingDetails.checkIn': { $gt: currentDate }
      }),
      Booking.countDocuments({ 
        status: 'confirmed',
        'bookingDetails.checkIn': { $lte: currentDate },
        'bookingDetails.checkOut': { $gte: currentDate }
      }),
      Booking.find()
        .populate('farmhouseId', 'name address images')
        .populate('userId', 'name email phone')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
    ]);

    // Calculate total revenue
    const revenueData = await Booking.aggregate([
      {
        $match: { 
          status: 'confirmed',
          paymentStatus: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          avgBookingValue: { $avg: '$totalAmount' },
          maxBookingValue: { $max: '$totalAmount' },
          minBookingValue: { $min: '$totalAmount' }
        }
      }
    ]);

    // Get today's bookings
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayBookings = await Booking.countDocuments({
      'bookingDetails.checkIn': { $gte: todayStart, $lte: todayEnd }
    });

    // Get weekly statistics
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const weeklyStats = await Booking.aggregate([
      {
        $match: {
          createdAt: { $gte: weekAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Get bookings by farmhouse (top farmhouses)
    const topFarmhouses = await Booking.aggregate([
      {
        $match: { status: 'confirmed' }
      },
      {
        $group: {
          _id: '$farmhouseId',
          bookingCount: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { bookingCount: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'farmhouses',
          localField: '_id',
          foreignField: '_id',
          as: 'farmhouseDetails'
        }
      }
    ]);

    res.json({
      success: true,
      summary: {
        total: totalBookings,
        pending: pendingBookings,
        confirmed: {
          total: totalBookings - pendingBookings - canceledBookings,
          upcoming: upcomingBookings,
          active: activeBookings,
          completed: completedBookings
        },
        canceled: canceledBookings,
        today: todayBookings
      },
      revenue: revenueData[0] || {
        totalRevenue: 0,
        avgBookingValue: 0,
        maxBookingValue: 0,
        minBookingValue: 0
      },
      weeklyStats,
      topFarmhouses: topFarmhouses.map(fh => ({
        farmhouseId: fh._id,
        name: fh.farmhouseDetails[0]?.name || 'Unknown',
        bookingCount: fh.bookingCount,
        revenue: fh.totalRevenue
      })),
      recentBookings: recentBookings.map(booking => ({
        _id: booking._id,
        user: booking.userId,
        farmhouse: booking.farmhouseId,
        date: booking.bookingDetails?.date,
        checkIn: booking.bookingDetails?.checkIn,
        totalAmount: booking.totalAmount,
        status: booking.status,
        createdAt: booking.createdAt
      }))
    });

  } catch (err) {
    console.error("❌ Error getting bookings summary:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bookings summary",
      error: err.message
    });
  }
};

// =====================================================
// GET USER BOOKINGS WITH ALL STATUSES IN ONE RESPONSE
// =====================================================
export const getUserBookingsAllStatus = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format"
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

    const currentDate = new Date();

    // Get all bookings for the user
    const allBookings = await Booking.find({ userId })
      .populate('farmhouseId', 'name address images rating location')
      .sort({ 'bookingDetails.checkIn': -1 })
      .lean();

    // Categorize bookings by status
    const categorizedBookings = {
      pending: [],
      upcoming: [],
      active: [],
      completed: [],
      canceled: []
    };

    // Process each booking
    allBookings.forEach(booking => {
      const checkInDate = new Date(booking.bookingDetails?.checkIn);
      const checkOutDate = new Date(booking.bookingDetails?.checkOut);
      
      // Format booking for response
      const formattedBooking = {
        ...booking,
        formattedDates: {
          checkIn: checkInDate.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short'
          }),
          checkOut: checkOutDate.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short'
          }),
          bookingDate: new Date(booking.createdAt).toLocaleDateString('en-IN', {
            dateStyle: 'medium'
          })
        },
        canCancel: checkInDate > currentDate && 
                   (checkInDate.getTime() - currentDate.getTime()) > 2 * 60 * 60 * 1000,
        canReschedule: checkInDate > currentDate
      };

      // Categorize based on status and dates
      if (booking.status === 'cancelled') {
        categorizedBookings.canceled.push(formattedBooking);
      } else if (booking.status === 'pending') {
        categorizedBookings.pending.push(formattedBooking);
      } else if (booking.status === 'confirmed') {
        if (checkOutDate < currentDate) {
          categorizedBookings.completed.push(formattedBooking);
        } else if (checkInDate <= currentDate && checkOutDate >= currentDate) {
          categorizedBookings.active.push(formattedBooking);
        } else if (checkInDate > currentDate) {
          categorizedBookings.upcoming.push(formattedBooking);
        }
      }
    });

    // Calculate statistics
    const statistics = {
      total: allBookings.length,
      pending: categorizedBookings.pending.length,
      upcoming: categorizedBookings.upcoming.length,
      active: categorizedBookings.active.length,
      completed: categorizedBookings.completed.length,
      canceled: categorizedBookings.canceled.length,
      totalSpent: categorizedBookings.completed.reduce((sum, b) => sum + (b.totalAmount || 0), 0),
      upcomingTotal: categorizedBookings.upcoming.reduce((sum, b) => sum + (b.totalAmount || 0), 0)
    };

    res.json({
      success: true,
      message: "User bookings retrieved successfully",
      userId,
      userName: user.name,
      userEmail: user.email,
      statistics,
      bookings: categorizedBookings
    });

  } catch (err) {
    console.error("❌ Error fetching user bookings all status:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user bookings",
      error: err.message
    });
  }
};

// // =====================================================
// // GET BOOKINGS BY DATE RANGE WITH STATUS FILTER
// // =====================================================
// export const getBookingsByDateRange = async (req, res) => {
//   try {
//     const { startDate, endDate, status, userId } = req.query;

//     // Validate dates
//     if (!startDate || !endDate) {
//       return res.status(400).json({
//         success: false,
//         message: "Start date and end date are required"
//       });
//     }

//     const start = new Date(startDate);
//     const end = new Date(endDate);
    
//     if (isNaN(start.getTime()) || isNaN(end.getTime())) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid date format"
//       });
//     }

//     // Build query
//     let query = {
//       'bookingDetails.checkIn': {
//         $gte: start,
//         $lte: end
//       }
//     };

//     // Add status filter if provided
//     if (status && status !== 'all') {
//       if (status === 'upcoming') {
//         query['bookingDetails.checkIn'] = { $gt: new Date() };
//         query.status = 'confirmed';
//       } else if (status === 'completed') {
//         query['bookingDetails.checkOut'] = { $lt: new Date() };
//         query.status = 'confirmed';
//       } else if (status === 'active') {
//         query['bookingDetails.checkIn'] = { $lte: new Date() };
//         query['bookingDetails.checkOut'] = { $gte: new Date() };
//         query.status = 'confirmed';
//       } else {
//         query.status = status;
//       }
//     }

//     // Add user filter if provided
//     if (userId) {
//       if (!mongoose.Types.ObjectId.isValid(userId)) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid user ID format"
//         });
//       }
//       query.userId = userId;
//     }

//     const bookings = await Booking.find(query)
//       .populate('farmhouseId', 'name address images')
//       .populate('userId', 'name email phone')
//       .sort({ 'bookingDetails.checkIn': 1 });

//     // Calculate statistics for the date range
//     const statistics = {
//       total: bookings.length,
//       totalRevenue: bookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0),
//       averageBookingValue: bookings.length > 0 
//         ? bookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0) / bookings.length 
//         : 0,
//       byStatus: {
//         pending: bookings.filter(b => b.status === 'pending').length,
//         confirmed: bookings.filter(b => b.status === 'confirmed').length,
//         cancelled: bookings.filter(b => b.status === 'cancelled').length
//       }
//     };

//     res.json({
//       success: true,
//       dateRange: {
//         start,
//         end
//       },
//       statistics,
//       bookings
//     });

//   } catch (err) {
//     console.error("❌ Error fetching bookings by date range:", err);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch bookings by date range",
//       error: err.message
//     });
//   }
// };


// =====================================================
// GET BOOKINGS BY DATE RANGE - FARMHOUSE WISE STATISTICS
// =====================================================
export const getBookingsByDateRange = async (req, res) => {
  try {
    const { startDate, endDate, farmhouseId } = req.query;

    // Validate dates
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Start date and end date are required"
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format"
      });
    }

    // Set time to start and end of day
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Build base query
    let matchQuery = {
      'bookingDetails.checkIn': {
        $gte: start,
        $lte: end
      }
    };

    // Add farmhouse filter if provided
    if (farmhouseId) {
      if (!mongoose.Types.ObjectId.isValid(farmhouseId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid farmhouse ID format"
        });
      }
      matchQuery.farmhouseId = new mongoose.Types.ObjectId(farmhouseId);
    }

    // Aggregation pipeline for farmhouse-wise statistics
    const farmhouseStats = await Booking.aggregate([
      {
        $match: matchQuery
      },
      {
        $lookup: {
          from: 'farmhouses',
          localField: 'farmhouseId',
          foreignField: '_id',
          as: 'farmhouse'
        }
      },
      {
        $unwind: {
          path: '$farmhouse',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $group: {
          _id: '$farmhouseId',
          farmhouseName: { $first: '$farmhouse.name' },
          farmhouseAddress: { $first: '$farmhouse.address' },
          totalBookings: { $sum: 1 },
          totalRevenue: { 
            $sum: { 
              $cond: [
                { $eq: ['$status', 'confirmed'] },
                '$totalAmount',
                0
              ]
            }
          },
          pendingCount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0]
            }
          },
          confirmedCount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0]
            }
          },
          cancelledCount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0]
            }
          },
          upcomingCount: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $eq: ['$status', 'confirmed'] },
                    { $gt: ['$bookingDetails.checkIn', new Date()] }
                  ]
                },
                1,
                0
              ]
            }
          },
          activeCount: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $eq: ['$status', 'confirmed'] },
                    { $lte: ['$bookingDetails.checkIn', new Date()] },
                    { $gte: ['$bookingDetails.checkOut', new Date()] }
                  ]
                },
                1,
                0
              ]
            }
          },
          completedCount: {
            $sum: {
              $cond: [
                { 
                  $and: [
                    { $eq: ['$status', 'confirmed'] },
                    { $lt: ['$bookingDetails.checkOut', new Date()] }
                  ]
                },
                1,
                0
              ]
            }
          },
          bookings: {
            $push: {
              bookingId: '$_id',
              transactionId: '$transactionId',
              status: '$status',
              totalAmount: '$totalAmount',
              slotPrice: '$slotPrice',
              cleaningFee: '$cleaningFee',
              serviceFee: '$serviceFee',
              bookingDetails: '$bookingDetails',
              createdAt: '$createdAt',
              user: {
                userId: '$user._id',
                name: '$user.fullName',
                email: '$user.email',
                phone: '$user.phoneNumber'
              }
            }
          }
        }
      },
      {
        $sort: { totalBookings: -1 }
      }
    ]);

    // Calculate overall statistics
    const overallStats = {
      totalFarmhouses: farmhouseStats.length,
      totalBookings: farmhouseStats.reduce((sum, f) => sum + f.totalBookings, 0),
      totalRevenue: farmhouseStats.reduce((sum, f) => sum + f.totalRevenue, 0),
      totalPending: farmhouseStats.reduce((sum, f) => sum + f.pendingCount, 0),
      totalConfirmed: farmhouseStats.reduce((sum, f) => sum + f.confirmedCount, 0),
      totalCancelled: farmhouseStats.reduce((sum, f) => sum + f.cancelledCount, 0),
      totalUpcoming: farmhouseStats.reduce((sum, f) => sum + f.upcomingCount, 0),
      totalActive: farmhouseStats.reduce((sum, f) => sum + f.activeCount, 0),
      totalCompleted: farmhouseStats.reduce((sum, f) => sum + f.completedCount, 0)
    };

    // Format the response
    const response = {
      success: true,
      dateRange: {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0]
      },
      filters: {
        farmhouseId: farmhouseId || 'all'
      },
      overall: overallStats,
      farmhouses: farmhouseStats.map(farmhouse => ({
        farmhouseId: farmhouse._id,
        farmhouseName: farmhouse.farmhouseName,
        farmhouseAddress: farmhouse.farmhouseAddress,
        statistics: {
          totalBookings: farmhouse.totalBookings,
          totalRevenue: farmhouse.totalRevenue,
          pending: farmhouse.pendingCount,
          confirmed: farmhouse.confirmedCount,
          cancelled: farmhouse.cancelledCount,
          upcoming: farmhouse.upcomingCount,
          active: farmhouse.activeCount,
          completed: farmhouse.completedCount
        },
        bookings: farmhouse.bookings
      }))
    };

    // If single farmhouse requested, simplify response
    if (farmhouseId && farmhouseStats.length === 1) {
      const farmhouse = farmhouseStats[0];
      response.farmhouse = {
        farmhouseId: farmhouse._id,
        farmhouseName: farmhouse.farmhouseName,
        farmhouseAddress: farmhouse.farmhouseAddress,
        statistics: {
          totalBookings: farmhouse.totalBookings,
          totalRevenue: farmhouse.totalRevenue,
          pending: farmhouse.pendingCount,
          confirmed: farmhouse.confirmedCount,
          cancelled: farmhouse.cancelledCount,
          upcoming: farmhouse.upcomingCount,
          active: farmhouse.activeCount,
          completed: farmhouse.completedCount
        },
        bookings: farmhouse.bookings
      };
      delete response.farmhouses;
    }

    res.json(response);

  } catch (err) {
    console.error("❌ Error fetching bookings by date range:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bookings by date range",
      error: err.message
    });
  }
};


// =====================================================
// COMPREHENSIVE DASHBOARD API
// =====================================================
export const getDashboardData = async (req, res) => {
  try {
    const currentDate = new Date();
    const startOfToday = new Date(currentDate);
    startOfToday.setHours(0, 0, 0, 0);
    
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(currentDate.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const startOfMonth = new Date(currentDate);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const startOfYear = new Date(currentDate);
    startOfYear.setMonth(0, 1);
    startOfYear.setHours(0, 0, 0, 0);

    // Run all queries in parallel for better performance
    const [
      // User statistics
      totalUsers,
      newUsersToday,
      newUsersThisWeek,
      newUsersThisMonth,
      newUsersThisYear,
      usersByDate,
      
      // Farmhouse statistics
      totalFarmhouses,
      activeFarmhouses,
      inactiveFarmhouses,
      farmhousesByStatus,
      farmhousesWithVendors,
      
      // Vendor statistics
      totalVendors,
      vendorsByDate,
      
      // Booking statistics
      totalBookings,
      pendingBookings,
      confirmedBookings,
      cancelledBookings,
      upcomingBookings,
      activeBookings,
      completedBookings,
      bookingsToday,
      bookingsThisWeek,
      bookingsThisMonth,
      bookingsThisYear,
      
      // Revenue statistics
      totalRevenue,
      revenueToday,
      revenueThisWeek,
      revenueThisMonth,
      revenueThisYear,
      
      // Recent data
      recentUsers,
      recentBookings,
      recentFarmhouses,
      recentVendors,
      
      // Top performing
      topFarmhouses,
      topUsers,
      
      // Charts data
      bookingsByDayChart,
      revenueByDayChart,
      usersByDayChart,
      farmhousesByTypeChart,
      
      // Location based
      farmhousesByLocation,
      
      // Ratings summary
      ratingsSummary,
      
      // Summary counts for quick stats
      summaryCounts
    ] = await Promise.all([
      // 1. Total users count
      User.countDocuments(),
      
      // 2. New users today
      User.countDocuments({
        createdAt: { $gte: startOfToday }
      }),
      
      // 3. New users this week
      User.countDocuments({
        createdAt: { $gte: startOfWeek }
      }),
      
      // 4. New users this month
      User.countDocuments({
        createdAt: { $gte: startOfMonth }
      }),
      
      // 5. New users this year
      User.countDocuments({
        createdAt: { $gte: startOfYear }
      }),
      
      // 6. Users by date (for chart)
      User.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfMonth }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" }
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 }
        },
        {
          $project: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: {
                  $dateFromParts: {
                    year: "$_id.year",
                    month: "$_id.month",
                    day: "$_id.day"
                  }
                }
              }
            },
            count: 1,
            _id: 0
          }
        }
      ]),
      
      // 7. Total farmhouses
      Farmhouse.countDocuments(),
      
      // 8. Active farmhouses
      Farmhouse.countDocuments({ active: true }),
      
      // 9. Inactive farmhouses
      Farmhouse.countDocuments({ active: false }),
      
      // 10. Farmhouses by status
      Farmhouse.aggregate([
        {
          $group: {
            _id: "$active",
            count: { $sum: 1 }
          }
        }
      ]),
      
      // 11. Farmhouses with vendor info
      Farmhouse.aggregate([
        {
          $lookup: {
            from: "vendors",
            localField: "_id",
            foreignField: "farmhouseId",
            as: "vendor"
          }
        },
        {
          $project: {
            name: 1,
            address: 1,
            active: 1,
            pricePerHour: 1,
            images: { $slice: ["$images", 1] },
            hasVendor: { $gt: [{ $size: "$vendor" }, 0] },
            vendorCount: { $size: "$vendor" },
            createdAt: 1
          }
        },
        { $sort: { createdAt: -1 } },
        { $limit: 5 }
      ]),
      
      // 12. Total vendors
      Vendor.countDocuments(),
      
      // 13. Vendors by date
      Vendor.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfMonth }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" }
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 }
        },
        {
          $project: {
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: {
                  $dateFromParts: {
                    year: "$_id.year",
                    month: "$_id.month",
                    day: "$_id.day"
                  }
                }
              }
            },
            count: 1,
            _id: 0
          }
        }
      ]),
      
      // 14. Total bookings
      Booking.countDocuments(),
      
      // 15. Pending bookings
      Booking.countDocuments({ status: 'pending' }),
      
      // 16. Confirmed bookings
      Booking.countDocuments({ status: 'confirmed' }),
      
      // 17. Cancelled bookings
      Booking.countDocuments({ status: 'cancelled' }),
      
      // 18. Upcoming bookings
      Booking.countDocuments({
        status: 'confirmed',
        'bookingDetails.checkIn': { $gt: currentDate }
      }),
      
      // 19. Active bookings (currently happening)
      Booking.countDocuments({
        status: 'confirmed',
        'bookingDetails.checkIn': { $lte: currentDate },
        'bookingDetails.checkOut': { $gte: currentDate }
      }),
      
      // 20. Completed bookings
      Booking.countDocuments({
        status: 'confirmed',
        'bookingDetails.checkOut': { $lt: currentDate }
      }),
      
      // 21. Bookings today
      Booking.countDocuments({
        'bookingDetails.checkIn': {
          $gte: startOfToday,
          $lt: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
        }
      }),
      
      // 22. Bookings this week
      Booking.countDocuments({
        createdAt: { $gte: startOfWeek }
      }),
      
      // 23. Bookings this month
      Booking.countDocuments({
        createdAt: { $gte: startOfMonth }
      }),
      
      // 24. Bookings this year
      Booking.countDocuments({
        createdAt: { $gte: startOfYear }
      }),
      
      // 25. Total revenue (confirmed bookings only)
      Booking.aggregate([
        {
          $match: {
            status: 'confirmed',
            paymentStatus: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalAmount" }
          }
        }
      ]),
      
      // 26. Revenue today
      Booking.aggregate([
        {
          $match: {
            status: 'confirmed',
            paymentStatus: 'completed',
            createdAt: { $gte: startOfToday }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalAmount" }
          }
        }
      ]),
      
      // 27. Revenue this week
      Booking.aggregate([
        {
          $match: {
            status: 'confirmed',
            paymentStatus: 'completed',
            createdAt: { $gte: startOfWeek }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalAmount" }
          }
        }
      ]),
      
      // 28. Revenue this month
      Booking.aggregate([
        {
          $match: {
            status: 'confirmed',
            paymentStatus: 'completed',
            createdAt: { $gte: startOfMonth }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalAmount" }
          }
        }
      ]),
      
      // 29. Revenue this year
      Booking.aggregate([
        {
          $match: {
            status: 'confirmed',
            paymentStatus: 'completed',
            createdAt: { $gte: startOfYear }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$totalAmount" }
          }
        }
      ]),
      
      // 30. Recent users (last 5)
      User.find()
        .select('-password -deleteToken -deleteTokenExpiration')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      
      // 31. Recent bookings (last 5)
      Booking.find()
        .populate('userId', 'fullName email phoneNumber')
        .populate('farmhouseId', 'name address')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      
      // 32. Recent farmhouses (last 5)
      Farmhouse.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      
      // 33. Recent vendors (last 5)
      Vendor.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      
      // 34. Top farmhouses by bookings
      Booking.aggregate([
        {
          $match: { status: 'confirmed' }
        },
        {
          $group: {
            _id: '$farmhouseId',
            bookingCount: { $sum: 1 },
            totalRevenue: { $sum: '$totalAmount' }
          }
        },
        { $sort: { bookingCount: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'farmhouses',
            localField: '_id',
            foreignField: '_id',
            as: 'farmhouse'
          }
        },
        {
          $unwind: '$farmhouse'
        },
        {
          $project: {
            farmhouseId: '$_id',
            farmhouseName: '$farmhouse.name',
            address: '$farmhouse.address',
            bookingCount: 1,
            totalRevenue: 1,
            averageRating: '$farmhouse.rating'
          }
        }
      ]),
      
      // 35. Top users by bookings
      Booking.aggregate([
        {
          $match: { status: 'confirmed' }
        },
        {
          $group: {
            _id: '$userId',
            bookingCount: { $sum: 1 },
            totalSpent: { $sum: '$totalAmount' }
          }
        },
        { $sort: { bookingCount: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $unwind: '$user'
        },
        {
          $project: {
            userId: '$_id',
            name: '$user.fullName',
            email: '$user.email',
            phone: '$user.phoneNumber',
            bookingCount: 1,
            totalSpent: 1
          }
        }
      ]),
      
      // 36. Bookings by day chart (last 30 days)
      Booking.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000)
            }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            },
            count: { $sum: 1 },
            revenue: { $sum: "$totalAmount" }
          }
        },
        { $sort: { "_id": 1 } },
        {
          $project: {
            date: "$_id",
            count: 1,
            revenue: 1,
            _id: 0
          }
        }
      ]),
      
      // 37. Revenue by day chart (last 30 days)
      // Already included in bookingsByDayChart, but we'll keep separate for clarity
      
      // 38. Users by day chart (last 30 days)
      User.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(currentDate.getTime() - 30 * 24 * 60 * 60 * 1000)
            }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { "_id": 1 } },
        {
          $project: {
            date: "$_id",
            count: 1,
            _id: 0
          }
        }
      ]),
      
      // 39. Farmhouses by type/amenities
      Farmhouse.aggregate([
        { $unwind: "$amenities" },
        {
          $group: {
            _id: "$amenities",
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $project: {
            amenity: "$_id",
            count: 1,
            _id: 0
          }
        }
      ]),
      
      // 40. Farmhouses by location (city extraction from address)
      Farmhouse.aggregate([
        {
          $group: {
            _id: {
              $arrayElemAt: [
                { $split: ["$address", ","] },
                1
              ]
            },
            count: { $sum: 1 },
            farmhouses: { $push: { name: "$name", id: "$_id" } }
          }
        },
        { $match: { _id: { $ne: null } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $project: {
            city: { $trim: { input: "$_id" } },
            count: 1,
            farmhouses: { $slice: ["$farmhouses", 3] },
            _id: 0
          }
        }
      ]),
      
      // 41. Ratings summary
      Farmhouse.aggregate([
        {
          $group: {
            _id: null,
            averageRating: { $avg: "$rating" },
            totalRatedFarmhouses: {
              $sum: { $cond: [{ $gt: ["$rating", 0] }, 1, 0] }
            },
            farmhousesWithReviews: {
              $sum: { $cond: [{ $gt: [{ $size: "$reviews" }, 0] }, 1, 0] }
            },
            totalReviews: { $sum: { $size: "$reviews" } }
          }
        },
        {
          $project: {
            averageRating: { $round: ["$averageRating", 1] },
            totalRatedFarmhouses: 1,
            farmhousesWithReviews: 1,
            totalReviews: 1,
            _id: 0
          }
        }
      ]),
      
      // 42. Summary counts for quick stats
      Promise.all([
        User.countDocuments(),
        Farmhouse.countDocuments(),
        Vendor.countDocuments(),
        Booking.countDocuments(),
        Booking.countDocuments({ status: 'confirmed' }),
        Booking.aggregate([
          { $match: { status: 'confirmed', paymentStatus: 'completed' } },
          { $group: { _id: null, total: { $sum: "$totalAmount" } } }
        ])
      ]).then(([users, farmhouses, vendors, bookings, confirmedBookings, revenueResult]) => ({
        users,
        farmhouses,
        vendors,
        bookings,
        confirmedBookings,
        revenue: revenueResult[0]?.total || 0
      }))
    ]);

    // Process revenue results
    const processRevenue = (revenueArray) => revenueArray[0]?.total || 0;

    // Prepare the comprehensive dashboard response
    const dashboardData = {
      success: true,
      timestamp: new Date().toISOString(),
      
      // Summary statistics
      summary: {
        users: {
          total: totalUsers,
          newToday: newUsersToday,
          newThisWeek: newUsersThisWeek,
          newThisMonth: newUsersThisMonth,
          newThisYear: newUsersThisYear
        },
        farmhouses: {
          total: totalFarmhouses,
          active: activeFarmhouses,
          inactive: inactiveFarmhouses,
          withVendors: farmhousesWithVendors.filter(f => f.hasVendor).length,
          withoutVendors: farmhousesWithVendors.filter(f => !f.hasVendor).length
        },
        vendors: {
          total: totalVendors,
          newThisMonth: vendorsByDate.reduce((sum, day) => sum + day.count, 0)
        },
        bookings: {
          total: totalBookings,
          pending: pendingBookings,
          confirmed: confirmedBookings,
          cancelled: cancelledBookings,
          upcoming: upcomingBookings,
          active: activeBookings,
          completed: completedBookings,
          today: bookingsToday,
          thisWeek: bookingsThisWeek,
          thisMonth: bookingsThisMonth,
          thisYear: bookingsThisYear,
          completionRate: totalBookings > 0 
            ? Math.round((completedBookings / totalBookings) * 100) 
            : 0
        },
        revenue: {
          total: processRevenue(totalRevenue),
          today: processRevenue(revenueToday),
          thisWeek: processRevenue(revenueThisWeek),
          thisMonth: processRevenue(revenueThisMonth),
          thisYear: processRevenue(revenueThisYear),
          averagePerBooking: confirmedBookings > 0 
            ? Math.round(processRevenue(totalRevenue) / confirmedBookings) 
            : 0
        }
      },
      
      // Charts data
      charts: {
        usersByDay: usersByDate,
        bookingsByDay: bookingsByDayChart.map(item => ({
          date: item.date,
          bookings: item.count,
          revenue: item.revenue
        })),
        revenueByDay: bookingsByDayChart.map(item => ({
          date: item.date,
          revenue: item.revenue
        })),
        farmhousesByAmenities: farmhousesByTypeChart,
        farmhousesByStatus: farmhousesByStatus.map(item => ({
          status: item._id ? 'Active' : 'Inactive',
          count: item.count
        }))
      },
      
      // Recent activity
      recentActivity: {
        users: recentUsers.map(user => ({
          id: user._id,
          name: user.fullName,
          email: user.email,
          phone: user.phoneNumber,
          joinedAt: user.createdAt
        })),
        bookings: recentBookings.map(booking => ({
          id: booking._id,
          user: booking.userId,
          farmhouse: booking.farmhouseId,
          date: booking.bookingDetails?.date,
          checkIn: booking.bookingDetails?.checkIn,
          totalAmount: booking.totalAmount,
          status: booking.status,
          bookedAt: booking.createdAt
        })),
        farmhouses: recentFarmhouses.map(farmhouse => ({
          id: farmhouse._id,
          name: farmhouse.name,
          address: farmhouse.address,
          pricePerHour: farmhouse.pricePerHour,
          active: farmhouse.active,
          image: farmhouse.images?.[0],
          createdAt: farmhouse.createdAt
        })),
        vendors: recentVendors.map(vendor => ({
          id: vendor._id,
          name: vendor.name,
          farmhouseId: vendor.farmhouseId,
          farmhouseName: vendor.farmhouseName,
          createdAt: vendor.createdAt
        }))
      },
      
      // Top performers
      topPerformers: {
        farmhouses: topFarmhouses,
        users: topUsers
      },
      
      // Location based
      locationInsights: {
        farmhousesByCity: farmhousesByLocation
      },
      
      // Ratings
      ratings: ratingsSummary[0] || {
        averageRating: 0,
        totalRatedFarmhouses: 0,
        farmhousesWithReviews: 0,
        totalReviews: 0
      },
      
      // Quick stats
      quickStats: summaryCounts
    };

    res.json(dashboardData);

  } catch (err) {
    console.error("❌ Error fetching dashboard data:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard data",
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};
// =====================================================
// GET ALL PAYMENTS WITH FILTERS AND DETAILS
// =====================================================
export const getAllPayments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      startDate,
      endDate,
      userId,
      farmhouseId,
      minAmount,
      maxAmount,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query filters
    let query = {};

    // Filter by payment status
    if (status && status !== 'all') {
      if (status === 'completed' || status === 'captured') {
        query.paymentStatus = 'completed';
      } else if (status === 'pending') {
        query.paymentStatus = 'pending';
      } else if (status === 'failed') {
        query.paymentStatus = 'failed';
      } else if (status === 'refunded') {
        query.paymentStatus = 'refunded';
      }
    }

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Filter by user
    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID format"
        });
      }
      query.userId = userId;
    }

    // Filter by farmhouse
    if (farmhouseId) {
      if (!mongoose.Types.ObjectId.isValid(farmhouseId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid farmhouse ID format"
        });
      }
      query.farmhouseId = farmhouseId;
    }

    // Filter by amount range
    if (minAmount || maxAmount) {
      query.totalAmount = {};
      if (minAmount) query.totalAmount.$gte = Number(minAmount);
      if (maxAmount) query.totalAmount.$lte = Number(maxAmount);
    }

    // Search functionality (search by transaction ID or user name)
    if (search) {
      query.$or = [
        { transactionId: { $regex: search, $options: 'i' } },
        { razorpayPaymentId: { $regex: search, $options: 'i' } },
        { razorpayOrderId: { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Determine sort order
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    console.log("📊 Fetching payments with filters:", JSON.stringify(query, null, 2));

    // Execute queries in parallel
    const [payments, totalCount, paymentStats] = await Promise.all([
      // Get payments with populated data
      Booking.find(query)
        .populate({
          path: 'userId',
          select: 'fullName email phoneNumber profileImage'
        })
        .populate({
          path: 'farmhouseId',
          select: 'name address images ownerName'
        })
        .select(
          'transactionId razorpayPaymentId razorpayOrderId verificationId ' +
          'userId farmhouseId bookingDetails slotPrice cleaningFee serviceFee ' +
          'totalAmount status paymentStatus cancellationDetails refundDetails ' +
          'createdAt updatedAt'
        )
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),

      // Get total count for pagination
      Booking.countDocuments(query),

      // Get payment statistics
      Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$totalAmount' },
            avgAmount: { $avg: '$totalAmount' },
            minAmount: { $min: '$totalAmount' },
            maxAmount: { $max: '$totalAmount' },
            count: { $sum: 1 },
            completedCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'completed'] }, 1, 0] }
            },
            pendingCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0] }
            },
            failedCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'failed'] }, 1, 0] }
            },
            refundedCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'refunded'] }, 1, 0] }
            },
            totalRefundAmount: {
              $sum: { $ifNull: ['$refundDetails.amount', 0] }
            }
          }
        }
      ])
    ]);

    // Process payments to add calculated fields
    const processedPayments = payments.map(payment => ({
      _id: payment._id,
      transactionId: payment.transactionId,
      razorpayPaymentId: payment.razorpayPaymentId,
      razorpayOrderId: payment.razorpayOrderId,
      verificationId: payment.verificationId,
      
      // User details
      user: payment.userId ? {
        id: payment.userId._id,
        name: payment.userId.fullName,
        email: payment.userId.email,
        phone: payment.userId.phoneNumber,
        profileImage: payment.userId.profileImage
      } : null,
      
      // Farmhouse details
      farmhouse: payment.farmhouseId ? {
        id: payment.farmhouseId._id,
        name: payment.farmhouseId.name,
        address: payment.farmhouseId.address,
        ownerName: payment.farmhouseId.ownerName,
        image: payment.farmhouseId.images?.[0]
      } : null,
      
      // Booking details
      bookingDetails: {
        date: payment.bookingDetails?.date,
        label: payment.bookingDetails?.label,
        timing: payment.bookingDetails?.timing,
        checkIn: payment.bookingDetails?.checkIn,
        checkOut: payment.bookingDetails?.checkOut
      },
      
      // Payment breakdown
      paymentBreakdown: {
        slotPrice: payment.slotPrice || 0,
        cleaningFee: payment.cleaningFee || 0,
        serviceFee: payment.serviceFee || 0,
        totalAmount: payment.totalAmount || 0
      },
      
      // Payment status
      paymentStatus: payment.paymentStatus || 'pending',
      bookingStatus: payment.status,
      
      // Refund details if any
      refundDetails: payment.refundDetails ? {
        refundId: payment.refundDetails.refundId,
        amount: payment.refundDetails.amount,
        status: payment.refundDetails.status,
        requestedAt: payment.refundDetails.requestedAt,
        processedAt: payment.refundDetails.processedAt,
        reason: payment.cancellationDetails?.reason
      } : null,
      
      // Cancellation details if any
      cancellationDetails: payment.cancellationDetails ? {
        cancelledAt: payment.cancellationDetails.cancelledAt,
        reason: payment.cancellationDetails.reason,
        hoursBeforeCheckIn: payment.cancellationDetails.hoursBeforeCheckIn
      } : null,
      
      // Timestamps
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      
      // Formatted date for display
      formattedDate: new Date(payment.createdAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    }));

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    // Prepare response
    const response = {
      success: true,
      message: 'Payments retrieved successfully',
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,

      },
 
      
      statistics: paymentStats[0] ? {
        totalPayments: paymentStats[0].count,
        totalAmount: paymentStats[0].totalAmount,
        averageAmount: Math.round(paymentStats[0].avgAmount * 100) / 100,
        minAmount: paymentStats[0].minAmount,
        maxAmount: paymentStats[0].maxAmount,
        byStatus: {
          completed: paymentStats[0].completedCount,
          pending: paymentStats[0].pendingCount,
          failed: paymentStats[0].failedCount,
          refunded: paymentStats[0].refundedCount
        },
        totalRefundAmount: paymentStats[0].totalRefundAmount
      } : {
        totalPayments: 0,
        totalAmount: 0,
        averageAmount: 0,
        minAmount: 0,
        maxAmount: 0,
        byStatus: {
          completed: 0,
          pending: 0,
          failed: 0,
          refunded: 0
        },
        totalRefundAmount: 0
      },
      payments: processedPayments
    };

    res.json(response);

  } catch (err) {
    console.error("❌ Error fetching payments:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

// =====================================================
// GET SINGLE PAYMENT BY ID
// =====================================================
export const getPaymentById = async (req, res) => {
  try {
    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: "Payment ID is required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format"
      });
    }

    console.log(`🔍 Fetching payment details for ID: ${paymentId}`);

    // Get payment with full details
    const payment = await Booking.findById(paymentId)
      .populate({
        path: 'userId',
        select: 'fullName email phoneNumber profileImage address createdAt'
      })
      .populate({
        path: 'farmhouseId',
        select: 'name address images description amenities pricePerHour rating ownerName ownerPhone location'
      })
      .lean();

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found"
      });
    }

    // Verify payment with Razorpay (optional - if you want real-time status)
    let razorpayDetails = null;
    if (payment.razorpayPaymentId) {
      try {
        razorpayDetails = await razorpay.payments.fetch(payment.razorpayPaymentId);
      } catch (razorpayErr) {
        console.warn("⚠️ Could not fetch Razorpay details:", razorpayErr.message);
      }
    }

    // Prepare detailed payment response
    const paymentDetails = {
      _id: payment._id,
      
      // Payment Identifiers
      identifiers: {
        transactionId: payment.transactionId,
        razorpayPaymentId: payment.razorpayPaymentId,
        razorpayOrderId: payment.razorpayOrderId,
        verificationId: payment.verificationId
      },
      
      // User Information
      user: payment.userId ? {
        id: payment.userId._id,
        name: payment.userId.fullName,
        email: payment.userId.email,
        phone: payment.userId.phoneNumber,
        profileImage: payment.userId.profileImage,
        address: payment.userId.address,
        joinedAt: payment.userId.createdAt
      } : null,
      
      // Farmhouse Information
      farmhouse: payment.farmhouseId ? {
        id: payment.farmhouseId._id,
        name: payment.farmhouseId.name,
        address: payment.farmhouseId.address,
        description: payment.farmhouseId.description,
        amenities: payment.farmhouseId.amenities,
        pricePerHour: payment.farmhouseId.pricePerHour,
        rating: payment.farmhouseId.rating,
        ownerName: payment.farmhouseId.ownerName,
        ownerPhone: payment.farmhouseId.ownerPhone,
        location: payment.farmhouseId.location,
        images: payment.farmhouseId.images
      } : null,
      
      // Booking Details
      booking: {
        date: payment.bookingDetails?.date,
        label: payment.bookingDetails?.label,
        timing: payment.bookingDetails?.timing,
        checkIn: payment.bookingDetails?.checkIn,
        checkOut: payment.bookingDetails?.checkOut,
        status: payment.status
      },
      
      // Financial Details
      financial: {
        breakdown: {
          slotPrice: payment.slotPrice || 0,
          cleaningFee: payment.cleaningFee || 0,
          serviceFee: payment.serviceFee || 0,
          total: payment.totalAmount || 0
        },
        status: {
          payment: payment.paymentStatus,
          booking: payment.status
        }
      },
      
      // Refund Information (if any)
      refund: payment.refundDetails ? {
        refundId: payment.refundDetails.refundId,
        amount: payment.refundDetails.amount,
        status: payment.refundDetails.status,
        requestedAt: payment.refundDetails.requestedAt,
        processedAt: payment.refundDetails.processedAt,
        requiresManualReview: payment.refundDetails.requiresManualReview || false
      } : null,
      
      // Cancellation Information (if any)
      cancellation: payment.cancellationDetails ? {
        cancelledAt: payment.cancellationDetails.cancelledAt,
        cancelledBy: payment.cancellationDetails.cancelledBy,
        reason: payment.cancellationDetails.reason,
        refundAmount: payment.cancellationDetails.refundAmount,
        cancellationCharges: payment.cancellationDetails.cancellationCharges,
        hoursBeforeCheckIn: payment.cancellationDetails.hoursBeforeCheckIn
      } : null,
      
      // Razorpay Real-time Details
      razorpay: razorpayDetails ? {
        id: razorpayDetails.id,
        entity: razorpayDetails.entity,
        amount: razorpayDetails.amount / 100, // Convert from paise
        currency: razorpayDetails.currency,
        status: razorpayDetails.status,
        method: razorpayDetails.method,
        description: razorpayDetails.description,
        email: razorpayDetails.email,
        contact: razorpayDetails.contact,
        fee: razorpayDetails.fee ? razorpayDetails.fee / 100 : null,
        tax: razorpayDetails.tax ? razorpayDetails.tax / 100 : null,
        createdAt: new Date(razorpayDetails.created_at * 1000),
        bank: razorpayDetails.bank,
        card: razorpayDetails.card,
        wallet: razorpayDetails.wallet,
        vpa: razorpayDetails.vpa,
        acquirerData: razorpayDetails.acquirer_data
      } : null,
      
      // Timelines
      timeline: {
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        formatted: {
          created: new Date(payment.createdAt).toLocaleString('en-IN', {
            dateStyle: 'full',
            timeStyle: 'long'
          }),
          updated: new Date(payment.updatedAt).toLocaleString('en-IN', {
            dateStyle: 'full',
            timeStyle: 'long'
          })
        }
      },
      
      // Payment Summary
      summary: {
        totalPaid: payment.totalAmount || 0,
        paymentMethod: razorpayDetails?.method || 'Unknown',
        paymentStatus: payment.paymentStatus,
        bookingStatus: payment.status,
        hasRefund: !!payment.refundDetails,
        refundAmount: payment.refundDetails?.amount || 0,
        netAmount: (payment.totalAmount || 0) - (payment.refundDetails?.amount || 0)
      }
    };

    res.json({
      success: true,
      message: 'Payment details retrieved successfully',
      payment: paymentDetails
    });

  } catch (err) {
    console.error("❌ Error fetching payment details:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment details",
      error: err.message
    });
  }
};

// =====================================================
// GET PAYMENT STATISTICS/DASHBOARD
// =====================================================
export const getPaymentStatistics = async (req, res) => {
  try {
    const { period = 'month' } = req.query; // period: day, week, month, year, all

    const currentDate = new Date();
    let startDate = new Date();

    // Set date range based on period
    switch(period) {
      case 'day':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(currentDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'month':
        startDate.setMonth(currentDate.getMonth() - 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'year':
        startDate.setFullYear(currentDate.getFullYear() - 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'all':
        startDate = new Date(0); // Beginning of time
        break;
      default:
        startDate.setMonth(currentDate.getMonth() - 1);
    }

    console.log(`📊 Fetching payment statistics for period: ${period}`);

    // Get payment statistics
    const [
      overallStats,
      dailyStats,
      paymentMethodStats,
      refundStats,
      topPayments
    ] = await Promise.all([
      // Overall statistics
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            totalPayments: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' },
            avgAmount: { $avg: '$totalAmount' },
            completedCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'completed'] }, 1, 0] }
            },
            pendingCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0] }
            },
            failedCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'failed'] }, 1, 0] }
            },
            refundedCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'refunded'] }, 1, 0] }
            }
          }
        }
      ]),

      // Daily statistics for chart
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            },
            count: { $sum: 1 },
            amount: { $sum: '$totalAmount' },
            completed: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'completed'] }, 1, 0] }
            },
            failed: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'failed'] }, 1, 0] }
            }
          }
        },
        { $sort: { '_id': 1 } }
      ]),

      // Payment method statistics (from razorpay)
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate },
            paymentStatus: 'completed'
          }
        },
        {
          $lookup: {
            from: 'razorpay_payments', // You might need to adjust this
            localField: 'razorpayPaymentId',
            foreignField: 'id',
            as: 'razorpay'
          }
        },
        {
          $group: {
            _id: '$razorpay.method',
            count: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' }
          }
        },
        {
          $match: { _id: { $ne: null } }
        }
      ]),

      // Refund statistics
      Booking.aggregate([
        {
          $match: {
            'refundDetails': { $exists: true, $ne: null },
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            totalRefunds: { $sum: 1 },
            totalRefundAmount: { $sum: '$refundDetails.amount' },
            successfulRefunds: {
              $sum: { $cond: [{ $eq: ['$refundDetails.status', 'processed'] }, 1, 0] }
            },
            pendingRefunds: {
              $sum: { $cond: [{ $eq: ['$refundDetails.status', 'pending'] }, 1, 0] }
            },
            failedRefunds: {
              $sum: { $cond: [{ $eq: ['$refundDetails.status', 'failed'] }, 1, 0] }
            }
          }
        }
      ]),

      // Top 5 payments by amount
      Booking.find({
        createdAt: { $gte: startDate },
        paymentStatus: 'completed'
      })
        .populate('userId', 'fullName email')
        .populate('farmhouseId', 'name')
        .sort({ totalAmount: -1 })
        .limit(5)
        .select('totalAmount userId farmhouseId createdAt')
        .lean()
    ]);

    // Prepare response
    const statistics = {
      period,
      dateRange: {
        start: startDate,
        end: currentDate
      },
      overview: overallStats[0] ? {
        totalPayments: overallStats[0].totalPayments,
        totalAmount: overallStats[0].totalAmount,
        averageAmount: Math.round(overallStats[0].avgAmount * 100) / 100,
        successRate: overallStats[0].totalPayments > 0
          ? Math.round((overallStats[0].completedCount / overallStats[0].totalPayments) * 100)
          : 0,
        byStatus: {
          completed: overallStats[0].completedCount,
          pending: overallStats[0].pendingCount,
          failed: overallStats[0].failedCount,
          refunded: overallStats[0].refundedCount
        }
      } : {
        totalPayments: 0,
        totalAmount: 0,
        averageAmount: 0,
        successRate: 0,
        byStatus: {
          completed: 0,
          pending: 0,
          failed: 0,
          refunded: 0
        }
      },
      dailyTrend: dailyStats.map(day => ({
        date: day._id,
        payments: day.count,
        amount: day.amount,
        completed: day.completed,
        failed: day.failed
      })),
      paymentMethods: paymentMethodStats.map(method => ({
        method: method._id || 'Unknown',
        count: method.count,
        amount: method.totalAmount
      })),
      refunds: refundStats[0] ? {
        totalRefunds: refundStats[0].totalRefunds,
        totalRefundAmount: refundStats[0].totalRefundAmount,
        successful: refundStats[0].successfulRefunds,
        pending: refundStats[0].pendingRefunds,
        failed: refundStats[0].failedRefunds,
        refundRate: overallStats[0]?.totalPayments
          ? Math.round((refundStats[0].totalRefunds / overallStats[0].totalPayments) * 100)
          : 0
      } : {
        totalRefunds: 0,
        totalRefundAmount: 0,
        successful: 0,
        pending: 0,
        failed: 0,
        refundRate: 0
      },
      topPayments: topPayments.map(payment => ({
        id: payment._id,
        amount: payment.totalAmount,
        user: payment.userId?.fullName || 'Unknown',
        farmhouse: payment.farmhouseId?.name || 'Unknown',
        date: payment.createdAt
      }))
    };

    res.json({
      success: true,
      message: 'Payment statistics retrieved successfully',
      statistics
    });

  } catch (err) {
    console.error("❌ Error fetching payment statistics:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment statistics",
      error: err.message
    });
  }
};

// =====================================================
// GET USER PAYMENT HISTORY
// =====================================================
export const getUserPayments = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10, status } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format"
      });
    }

    // Build query
    let query = { userId };
    if (status && status !== 'all') {
      query.paymentStatus = status;
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get user's payments
    const [payments, totalCount, userStats] = await Promise.all([
      Booking.find(query)
        .populate('farmhouseId', 'name address images')
        .select(
          'transactionId razorpayPaymentId bookingDetails slotPrice cleaningFee ' +
          'serviceFee totalAmount paymentStatus status refundDetails createdAt'
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),

      Booking.countDocuments(query),

      Booking.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalSpent: { $sum: '$totalAmount' },
            totalBookings: { $sum: 1 },
            completedPayments: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'completed'] }, 1, 0] }
            },
            totalRefunds: {
              $sum: { $ifNull: ['$refundDetails.amount', 0] }
            }
          }
        }
      ])
    ]);

    const processedPayments = payments.map(payment => ({
      id: payment._id,
      transactionId: payment.transactionId,
      razorpayPaymentId: payment.razorpayPaymentId,
      farmhouse: payment.farmhouseId ? {
        name: payment.farmhouseId.name,
        image: payment.farmhouseId.images?.[0]
      } : null,
      bookingDate: payment.bookingDetails?.date,
      slot: {
        label: payment.bookingDetails?.label,
        timing: payment.bookingDetails?.timing
      },
      amount: {
        slotPrice: payment.slotPrice,
        cleaningFee: payment.cleaningFee,
        serviceFee: payment.serviceFee,
        total: payment.totalAmount
      },
      status: {
        payment: payment.paymentStatus,
        booking: payment.status
      },
      refund: payment.refundDetails ? {
        amount: payment.refundDetails.amount,
        status: payment.refundDetails.status
      } : null,
      date: payment.createdAt,
      formattedDate: new Date(payment.createdAt).toLocaleDateString('en-IN', {
        dateStyle: 'medium'
      })
    }));

    const totalPages = Math.ceil(totalCount / limitNum);

    res.json({
      success: true,
      message: 'User payments retrieved successfully',
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      userStats: userStats[0] ? {
        totalSpent: userStats[0].totalSpent,
        totalBookings: userStats[0].totalBookings,
        completedPayments: userStats[0].completedPayments,
        totalRefunds: userStats[0].totalRefunds,
        netSpent: userStats[0].totalSpent - userStats[0].totalRefunds
      } : {
        totalSpent: 0,
        totalBookings: 0,
        completedPayments: 0,
        totalRefunds: 0,
        netSpent: 0
      },
      payments: processedPayments
    });

  } catch (err) {
    console.error("❌ Error fetching user payments:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user payments",
      error: err.message
    });
  }
};

// =====================================================
// COMPREHENSIVE REVENUE ANALYTICS API
// =====================================================
export const getRevenueAnalytics = async (req, res) => {
  try {
    const { 
      period = 'month',        // day, week, month, year, custom
      startDate,               // for custom period
      endDate,                 // for custom period
      farmhouseId,            // optional: specific farmhouse
      groupBy = 'farmhouse'    // farmhouse, day, month
    } = req.query;

    console.log("📊 Revenue Analytics Request:", { period, startDate, endDate, farmhouseId });

    // =====================================================
    // DATE RANGE CALCULATION
    // =====================================================
    const currentDate = new Date();
    let start = new Date();
    let end = new Date();

    // Set date range based on period
    switch(period) {
      case 'day':
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        break;
        
      case 'week':
        // Get current week (Sunday to Saturday)
        const dayOfWeek = currentDate.getDay(); // 0 = Sunday
        start.setDate(currentDate.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        break;
        
      case 'month':
        start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
        
      case 'year':
        start = new Date(currentDate.getFullYear(), 0, 1);
        end = new Date(currentDate.getFullYear(), 11, 31, 23, 59, 59, 999);
        break;
        
      case 'custom':
        if (!startDate || !endDate) {
          return res.status(400).json({
            success: false,
            message: "startDate and endDate are required for custom period"
          });
        }
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        break;
        
      default:
        // Default to current month
        start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // Validate dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date range"
      });
    }

    console.log(`📅 Date Range: ${start.toISOString()} to ${end.toISOString()}`);

    // =====================================================
    // BUILD MATCH QUERY
    // =====================================================
    const matchQuery = {
      status: 'confirmed',
      paymentStatus: 'completed',
      createdAt: { $gte: start, $lte: end }
    };

    // Add farmhouse filter if provided
    if (farmhouseId) {
      if (!mongoose.Types.ObjectId.isValid(farmhouseId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid farmhouse ID format"
        });
      }
      matchQuery.farmhouseId = new mongoose.Types.ObjectId(farmhouseId);
    }

    // =====================================================
    // MAIN REVENUE QUERY - Group by Farmhouse
    // =====================================================
    const revenueByFarmhouse = await Booking.aggregate([
      { $match: matchQuery },
      
      // Group by farmhouse
      {
        $group: {
          _id: '$farmhouseId',
          totalRevenue: { $sum: '$totalAmount' },
          bookingCount: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          slotRevenue: { $sum: '$slotPrice' },
          cleaningFeeRevenue: { $sum: '$cleaningFee' },
          serviceFeeRevenue: { $sum: '$serviceFee' },
          averageBookingValue: { $avg: '$totalAmount' },
          minBookingValue: { $min: '$totalAmount' },
          maxBookingValue: { $max: '$totalAmount' },
          firstBooking: { $min: '$createdAt' },
          lastBooking: { $max: '$createdAt' },
          bookings: { 
            $push: {
              bookingId: '$_id',
              amount: '$totalAmount',
              date: '$createdAt',
              userId: '$userId'
            }
          }
        }
      },
      
      // Add farmhouse details
      {
        $lookup: {
          from: 'farmhouses',
          localField: '_id',
          foreignField: '_id',
          as: 'farmhouseDetails'
        }
      },
      
      { $unwind: '$farmhouseDetails' },
      
      // Calculate unique users count
      {
        $addFields: {
          uniqueUserCount: { $size: '$uniqueUsers' }
        }
      },
      
      // Project final structure
      {
        $project: {
          farmhouseId: '$_id',
          farmhouseName: '$farmhouseDetails.name',
          farmhouseAddress: '$farmhouseDetails.address',
          farmhouseRating: '$farmhouseDetails.rating',
          farmhouseImage: { $arrayElemAt: ['$farmhouseDetails.images', 0] },
          totalRevenue: 1,
          bookingCount: 1,
          uniqueUserCount: 1,
          slotRevenue: 1,
          cleaningFeeRevenue: 1,
          serviceFeeRevenue: 1,
          averageBookingValue: { $round: ['$averageBookingValue', 2] },
          minBookingValue: 1,
          maxBookingValue: 1,
          firstBooking: 1,
          lastBooking: 1,
          bookings: { $slice: ['$bookings', 5] } // Only last 5 bookings
        }
      },
      
      { $sort: { totalRevenue: -1 } }
    ]);

    // =====================================================
    // COMBINED REVENUE STATISTICS
    // =====================================================
    const combinedStats = await Booking.aggregate([
      { $match: matchQuery },
      
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalBookings: { $sum: 1 },
          uniqueFarmhouses: { $addToSet: '$farmhouseId' },
          uniqueUsers: { $addToSet: '$userId' },
          totalSlotRevenue: { $sum: '$slotPrice' },
          totalCleaningFee: { $sum: '$cleaningFee' },
          totalServiceFee: { $sum: '$serviceFee' },
          averageBookingValue: { $avg: '$totalAmount' },
          maxBookingValue: { $max: '$totalAmount' },
          minBookingValue: { $min: '$totalAmount' }
        }
      },
      
      {
        $addFields: {
          uniqueFarmhouseCount: { $size: '$uniqueFarmhouses' },
          uniqueUserCount: { $size: '$uniqueUsers' }
        }
      }
    ]);

    // =====================================================
    // TIME-BASED GROUPING (for trends)
    // =====================================================
    let dateGroupFormat;
    switch(period) {
      case 'day':
        dateGroupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
          hour: { $hour: '$createdAt' }
        };
        break;
      case 'week':
        dateGroupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
        break;
      case 'month':
        dateGroupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          week: { $week: '$createdAt' }
        };
        break;
      case 'year':
        dateGroupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
      default:
        dateGroupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
    }

    const revenueByTime = await Booking.aggregate([
      { $match: matchQuery },
      
      {
        $group: {
          _id: dateGroupFormat,
          revenue: { $sum: '$totalAmount' },
          bookings: { $sum: 1 },
          users: { $addToSet: '$userId' }
        }
      },
      
      {
        $addFields: {
          uniqueUsers: { $size: '$users' },
          period: {
            $switch: {
              branches: [
                { case: { $eq: ['day', period] }, then: { 
                  $dateToString: { 
                    format: "%Y-%m-%d %H:00", 
                    date: { 
                      $dateFromParts: { 
                        year: '$_id.year', 
                        month: '$_id.month', 
                        day: '$_id.day',
                        hour: '$_id.hour'
                      } 
                    } 
                  } 
                }},
                { case: { $eq: ['week', period] }, then: { 
                  $concat: [
                    { $toString: '$_id.year' }, '-W', 
                    { $toString: '$_id.week' }
                  ] 
                }},
                { case: { $eq: ['month', period] }, then: { 
                  $dateToString: { 
                    format: "%Y-%m", 
                    date: { 
                      $dateFromParts: { 
                        year: '$_id.year', 
                        month: '$_id.month' 
                      } 
                    } 
                  } 
                }},
                { case: { $eq: ['year', period] }, then: { 
                  $toString: '$_id.year' 
                }}
              ],
              default: { 
                $dateToString: { 
                  format: "%Y-%m-%d", 
                  date: { 
                    $dateFromParts: { 
                      year: '$_id.year', 
                      month: '$_id.month', 
                      day: '$_id.day' 
                    } 
                  } 
                } 
              }
            }
          }
        }
      },
      
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
      
      {
        $project: {
          _id: 0,
          period: 1,
          revenue: 1,
          bookings: 1,
          uniqueUsers: 1
        }
      }
    ]);

    // =====================================================
    // PREVIOUS PERIOD COMPARISON
    // =====================================================
    const periodDuration = end.getTime() - start.getTime();
    const previousStart = new Date(start.getTime() - periodDuration);
    const previousEnd = new Date(start.getTime() - 1);

    const previousPeriodStats = await Booking.aggregate([
      {
        $match: {
          status: 'confirmed',
          paymentStatus: 'completed',
          createdAt: { $gte: previousStart, $lte: previousEnd }
        }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$totalAmount' },
          bookings: { $sum: 1 }
        }
      }
    ]);

    // =====================================================
    // USER BOOKINGS PER FARMHOUSE
    // =====================================================
    const userBookingsPerFarmhouse = await Booking.aggregate([
      { $match: matchQuery },
      
      {
        $group: {
          _id: {
            farmhouseId: '$farmhouseId',
            userId: '$userId'
          },
          bookings: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' }
        }
      },
      
      {
        $group: {
          _id: '$_id.farmhouseId',
          users: {
            $push: {
              userId: '$_id.userId',
              bookingCount: '$bookings',
              totalSpent: '$totalSpent'
            }
          },
          totalUsers: { $sum: 1 }
        }
      },
      
      {
        $lookup: {
          from: 'farmhouses',
          localField: '_id',
          foreignField: '_id',
          as: 'farmhouse'
        }
      },
      
      { $unwind: '$farmhouse' },
      
      {
        $project: {
          farmhouseId: '$_id',
          farmhouseName: '$farmhouse.name',
          totalUsers: 1,
          users: { $slice: ['$users', 10] } // Top 10 users per farmhouse
        }
      }
    ]);

    // =====================================================
    // CALCULATE GROWTH PERCENTAGES
    // =====================================================
    const currentPeriodRevenue = combinedStats[0]?.totalRevenue || 0;
    const previousPeriodRevenue = previousPeriodStats[0]?.revenue || 0;
    
    let revenueGrowth = 0;
    if (previousPeriodRevenue > 0) {
      revenueGrowth = ((currentPeriodRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100;
    }

    const currentPeriodBookings = combinedStats[0]?.totalBookings || 0;
    const previousPeriodBookings = previousPeriodStats[0]?.bookings || 0;
    
    let bookingsGrowth = 0;
    if (previousPeriodBookings > 0) {
      bookingsGrowth = ((currentPeriodBookings - previousPeriodBookings) / previousPeriodBookings) * 100;
    }

    // =====================================================
    // PREPARE RESPONSE
    // =====================================================
    const response = {
      success: true,
      message: 'Revenue analytics retrieved successfully',
      
      // Period information
      period: {
        type: period,
        start: start.toISOString(),
        end: end.toISOString(),
        previousPeriod: {
          start: previousStart.toISOString(),
          end: previousEnd.toISOString()
        },
        duration: {
          days: Math.round(periodDuration / (1000 * 60 * 60 * 24)),
          hours: Math.round(periodDuration / (1000 * 60 * 60))
        }
      },
      
      // Combined revenue for all farmhouses
      combined: combinedStats[0] ? {
        totalRevenue: currentPeriodRevenue,
        totalBookings: currentPeriodBookings,
        uniqueFarmhouses: combinedStats[0].uniqueFarmhouseCount || 0,
        uniqueUsers: combinedStats[0].uniqueUserCount || 0,
        averageBookingValue: Math.round((combinedStats[0].averageBookingValue || 0) * 100) / 100,
        minBookingValue: combinedStats[0].minBookingValue || 0,
        maxBookingValue: combinedStats[0].maxBookingValue || 0,
        revenueBreakdown: {
          slotRevenue: combinedStats[0].totalSlotRevenue || 0,
          cleaningFee: combinedStats[0].totalCleaningFee || 0,
          serviceFee: combinedStats[0].totalServiceFee || 0
        },
        growth: {
          revenue: Math.round(revenueGrowth * 100) / 100,
          bookings: Math.round(bookingsGrowth * 100) / 100
        }
      } : {
        totalRevenue: 0,
        totalBookings: 0,
        uniqueFarmhouses: 0,
        uniqueUsers: 0,
        averageBookingValue: 0,
        minBookingValue: 0,
        maxBookingValue: 0,
        revenueBreakdown: {
          slotRevenue: 0,
          cleaningFee: 0,
          serviceFee: 0
        },
        growth: {
          revenue: 0,
          bookings: 0
        }
      },
      
      // Revenue by farmhouse (array of farmhouses with their stats)
      byFarmhouse: revenueByFarmhouse.map(fh => ({
        farmhouseId: fh.farmhouseId,
        farmhouseName: fh.farmhouseName,
        farmhouseAddress: fh.farmhouseAddress,
        farmhouseRating: fh.farmhouseRating,
        farmhouseImage: fh.farmhouseImage,
        statistics: {
          totalRevenue: fh.totalRevenue,
          bookingCount: fh.bookingCount,
          uniqueUsers: fh.uniqueUserCount,
          averageBookingValue: fh.averageBookingValue,
          minBookingValue: fh.minBookingValue,
          maxBookingValue: fh.maxBookingValue,
          revenueBreakdown: {
            slotRevenue: fh.slotRevenue,
            cleaningFee: fh.cleaningFeeRevenue,
            serviceFee: fh.serviceFeeRevenue
          }
        },
        timeline: {
          firstBooking: fh.firstBooking,
          lastBooking: fh.lastBooking
        },
        recentBookings: fh.bookings
      })),
      
      // Time-based revenue trends
      trends: revenueByTime,
      
      // User booking distribution by farmhouse
      userDistribution: userBookingsPerFarmhouse.map(item => ({
        farmhouseId: item.farmhouseId,
        farmhouseName: item.farmhouseName,
        totalUsers: item.totalUsers,
        topUsers: item.users.map(user => ({
          userId: user.userId,
          bookingCount: user.bookingCount,
          totalSpent: user.totalSpent
        }))
      })),
      
      // Summary statistics
      summary: {
        totalFarmhousesWithRevenue: revenueByFarmhouse.length,
        farmhousesWithNoRevenue: await Farmhouse.countDocuments({
          _id: { $nin: revenueByFarmhouse.map(f => f.farmhouseId) }
        }),
        topPerformingFarmhouse: revenueByFarmhouse[0] ? {
          name: revenueByFarmhouse[0].farmhouseName,
          revenue: revenueByFarmhouse[0].totalRevenue,
          bookings: revenueByFarmhouse[0].bookingCount
        } : null,
        averageRevenuePerFarmhouse: revenueByFarmhouse.length > 0 
          ? currentPeriodRevenue / revenueByFarmhouse.length 
          : 0,
        averageBookingsPerFarmhouse: revenueByFarmhouse.length > 0
          ? currentPeriodBookings / revenueByFarmhouse.length
          : 0
      }
    };

    // If specific farmhouse requested, simplify response
    if (farmhouseId && revenueByFarmhouse.length === 1) {
      const farmhouseData = revenueByFarmhouse[0];
      response.farmhouse = {
        farmhouseId: farmhouseData.farmhouseId,
        farmhouseName: farmhouseData.farmhouseName,
        farmhouseAddress: farmhouseData.farmhouseAddress,
        farmhouseRating: farmhouseData.farmhouseRating,
        farmhouseImage: farmhouseData.farmhouseImage,
        statistics: {
          totalRevenue: farmhouseData.totalRevenue,
          bookingCount: farmhouseData.bookingCount,
          uniqueUsers: farmhouseData.uniqueUserCount,
          averageBookingValue: farmhouseData.averageBookingValue,
          minBookingValue: farmhouseData.minBookingValue,
          maxBookingValue: farmhouseData.maxBookingValue,
          revenueBreakdown: {
            slotRevenue: farmhouseData.slotRevenue,
            cleaningFee: farmhouseData.cleaningFeeRevenue,
            serviceFee: farmhouseData.serviceFeeRevenue
          }
        },
        timeline: {
          firstBooking: farmhouseData.firstBooking,
          lastBooking: farmhouseData.lastBooking
        },
        recentBookings: farmhouseData.bookings
      };
      delete response.byFarmhouse;
    }

    console.log("✅ Revenue analytics generated successfully");
    
    res.json(response);

  } catch (err) {
    console.error("❌ Error generating revenue analytics:", err);
    res.status(500).json({
      success: false,
      message: "Failed to generate revenue analytics",
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};