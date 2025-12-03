import { Booking } from "../models/bookingModel.js";
import { Farmhouse } from "../models/farmhouseModel.js";
import { User } from "../models/User.js";


// ========================================================================
// HELPER: Calculate total price based on hours + days
// ========================================================================
const calculatePrice = (start, end, farmhouse) => {
  const ms = end - start;
  const hours = ms / (1000 * 60 * 60);

  let totalPrice = 0;

  if (hours <= 24) {
    totalPrice = Math.ceil(hours) * farmhouse.pricePerHour;
  } else {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    totalPrice =
      days * farmhouse.pricePerDay +
      Math.ceil(remainingHours) * farmhouse.pricePerHour;
  }

  return totalPrice;
};



// ========================================================================
// CREATE BOOKING  ⭐ FIXED: farmhouseImage now saved in DB
// ========================================================================
export const createBooking = async (req, res) => {
  try {
    const { userId, farmhouseId, startDate, endDate } = req.body;

    if (!userId || !farmhouseId || !startDate || !endDate)
      return res.status(400).json({ message: "All fields required" });

    // FIX: use lean() to get plain JSON
    const farmhouse = await Farmhouse.findById(farmhouseId).lean();
    if (!farmhouse)
      return res.status(404).json({ message: "Farmhouse not found" });

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end)
      return res.status(400).json({ message: "End must be after start" });

    const overlapping = await Booking.findOne({
      farmhouseId,
      $or: [{ startDate: { $lt: end }, endDate: { $gt: start } }]
    });

    if (overlapping)
      return res.status(400).json({
        message: "Farmhouse not available for the selected time"
      });

    const totalPrice = calculatePrice(start, end, farmhouse);

    // FIX: image now loads correctly
    const farmhouseImage =
      farmhouse?.images?.length > 0 ? farmhouse.images[0] : null;

    const booking = await Booking.create({
      userId,
      farmhouseId,
      farmhouseImage,  // ⭐ STORE IN DATABASE
      startDate: start,
      endDate: end,
      totalPrice
    });

    res.json({
      success: true,
      message: "Booking created",
      booking
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ========================================================================
// GET ALL BOOKINGS (ADMIN)
// ========================================================================
export const getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate("farmhouseId")
      .populate("userId")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: bookings.length,
      bookings
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ========================================================================
// GET BOOKING BY ID
// ========================================================================
export const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId)
      .populate("farmhouseId")
      .populate("userId");

    if (!booking)
      return res.status(404).json({ message: "Booking not found" });

    res.json({
      success: true,
      booking
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ========================================================================
// GET BOOKINGS BY USER
// ========================================================================
export const getUserBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ userId: req.params.userId })
      .populate("farmhouseId")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: bookings.length,
      bookings
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ========================================================================
// CHECK AVAILABILITY
// ========================================================================
export const checkAvailability = async (req, res) => {
  try {
    const { farmhouseId, startDate, endDate } = req.query;

    if (!farmhouseId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "farmhouseId, startDate and endDate are required"
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const overlapping = await Booking.findOne({
      farmhouseId,
      $or: [{ startDate: { $lt: end }, endDate: { $gt: start } }]
    });

    return res.json({
      success: true,
      farmhouseId,
      requestedSlot: { startDate: start, endDate: end },
      available: !overlapping,
      message: overlapping
        ? "Farmhouse is NOT available for the selected time slot"
        : "Farmhouse is available for the selected time slot"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ========================================================================
// UPDATE BOOKING  ⭐ FIX: update farmhouseImage too
// ========================================================================
export const updateBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { startDate, endDate } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking)
      return res.status(404).json({ message: "Booking not found" });

    // Fix: Use lean()
    const farmhouse = await Farmhouse.findById(booking.farmhouseId).lean();

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end)
      return res.status(400).json({ message: "End must be after start" });

    const overlapping = await Booking.findOne({
      farmhouseId: booking.farmhouseId,
      _id: { $ne: bookingId },
      $or: [{ startDate: { $lt: end }, endDate: { $gt: start } }]
    });

    if (overlapping)
      return res.status(400).json({
        message: "Farmhouse not available for updated time"
      });

    const totalPrice = calculatePrice(start, end, farmhouse);

    booking.startDate = start;
    booking.endDate = end;
    booking.totalPrice = totalPrice;

    // FIX: ALWAYS update image from farmhouse
    booking.farmhouseImage =
      farmhouse?.images?.length > 0 ? farmhouse.images[0] : null;

    await booking.save();

    res.json({
      success: true,
      message: "Booking updated",
      booking
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// ========================================================================
// DELETE BOOKING
// ========================================================================
export const deleteBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId);
    if (!booking)
      return res.status(404).json({ message: "Booking not found" });

    await Booking.findByIdAndDelete(bookingId);

    res.json({
      success: true,
      message: "Booking deleted successfully"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

