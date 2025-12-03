import express from "express";
import {
  createBooking,
  getUserBookings,
  checkAvailability,
  updateBooking,
  deleteBooking,
  getAllBookings,
  getBookingById
} from "../controllers/bookingController.js";

const router = express.Router();

// CREATE BOOKING
router.post("/create-booking", createBooking);

// GET ALL BOOKINGS (ADMIN)
router.get("/all-bookings", getAllBookings);

// GET BOOKING BY ID
router.get("/booking/:bookingId", getBookingById);

// GET BOOKINGS BY USER
router.get("/user-booking/:userId", getUserBookings);

// CHECK AVAILABILITY
router.get("/check-availability", checkAvailability);

// UPDATE BOOKING
router.put("/update/:bookingId", updateBooking);

// DELETE BOOKING
router.delete("/delete/:bookingId", deleteBooking);

export default router;
