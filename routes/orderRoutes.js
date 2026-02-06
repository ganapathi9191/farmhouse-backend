import express from "express";
import {
  verifySlotAvailability,
  createBooking,
  
  getVerificationStatus,
  getUserBookings,
  getBookingDetails,
  getBookingByTransactionId,
  cancelBooking,
  getBookingHistory,
  getAllBookings
} from "../controllers/orderController.js";

const router = express.Router();

// Booking routes
router.post("/verify-slot", verifySlotAvailability); // Verify slot and get verificationId
router.post("/create", createBooking); // Create booking with verificationId
router.get("/verification-status", getVerificationStatus); // Check verification status

// User bookings
router.get("/user/:userId", getUserBookings); // Get user bookings
router.get("/:bookingId", getBookingDetails); // Get booking details by ID
router.get("/transaction/:transactionId", getBookingByTransactionId); // Get booking by transaction ID
router.put("/cancel/:bookingId", cancelBooking); // Cancel booking
router.get("/history/:userId", getBookingHistory); // Get booking history with filters

// Admin routes
router.get("/admin/all", getAllBookings); // Admin: Get all bookings

export default router;