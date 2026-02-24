import express from "express";
import {
  verifySlotAvailability,
  createBooking,
 getUserBookings, 
  cancelBooking,
  getAllBookingsSummary,
  getUserBookingsAllStatus,
  getBookingsByDateRange,
  getDashboardData,
    getAllPayments,
  getPaymentById,
  getPaymentStatistics,
  getUserPayments,
  getRevenueAnalytics
} from "../controllers/orderController.js";

const router = express.Router();

// Booking routes
router.post("/verify-slot", verifySlotAvailability); // Verify slot and get verificationId
router.post("/create", createBooking); // Create booking with verificationId
// Get bookings with status filter
router.get('/all', getUserBookings);

// Cancel booking
router.post('/cancel', cancelBooking);

router.get('/admin/summary', getAllBookingsSummary); // Admin only
router.get('/user/:userId/all-status', getUserBookingsAllStatus);
router.get('/date-range', getBookingsByDateRange);
router.get('/dashbord',getDashboardData)

// GET all payments with filters 
router.get('/payments', getAllPayments);

// GET payment statistics/dashboard
router.get('/payments/statistics', getPaymentStatistics);

// GET single payment by ID
router.get('/payments/:paymentId', getPaymentById);

// GET user payment history
router.get('/users/:userId/payments', getUserPayments);

router.get("/revenue", getRevenueAnalytics);

export default router;