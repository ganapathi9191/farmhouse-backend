import express from "express";
import upload from "../utils/upload.js";
import {
  createFarmhouse,
  getAllFarmhouses,
  getFarmhouseById,
  updateFarmhouse,
  deleteFarmhouse,
  toggleWishlist,
  getUserWishlists,
  getNearbyFarmhouses,
  getAvailableSlots,
  searchFarmhouse,
  filterFarmhouses,
  checkAvailabilityByRange,
  bookSlot,
  cancelBooking,
  getUserBookings,
  getUserBookingHistory,
  createReview,
  getFarmhouseBookings,
  adminBlockSlot,
  adminUnblockSlot,
  
} from "../controllers/farmhouseController.js";

const router = express.Router();

/* ===================================================== 
   FARMHOUSE CRUD 
===================================================== */
router.post("/farmhouse-create", upload.array("images", 10), createFarmhouse);
router.get("/all-farmhouse", getAllFarmhouses);
router.get("/farmhouse/:farmhouseId", getFarmhouseById);
router.put("/farmhouse/:farmhouseId", upload.array("images", 10), updateFarmhouse);
router.delete("/farmhouse/:farmhouseId", deleteFarmhouse);

/* ===================================================== 
   WISHLIST 
===================================================== */
router.put("/:farmhouseId/wishlist/:userId", toggleWishlist);
router.get('/get-wishlist/:userId', getUserWishlists);
/* ===================================================== 
   NEARBY 
===================================================== */
router.get("/nearby/user/:userId", getNearbyFarmhouses);

/* ===================================================== 
   AVAILABILITY 
===================================================== */
router.get("/:farmhouseId/slots", getAvailableSlots);
router.get("/check-availability", checkAvailabilityByRange);
router.get("/search", searchFarmhouse);
router.get("/search-filter", filterFarmhouses);
/* ===================================================== 
   BOOKINGS (USER) 
===================================================== */
router.post("/:farmhouseId/book", bookSlot);
router.post("/:farmhouseId/cancel", cancelBooking);
router.get("/user/:userId/bookings", getUserBookings);
router.get("/user/:userId/history", getUserBookingHistory);

/* ===================================================== 
   REVIEWS 
===================================================== */
router.post("/:farmhouseId/review", createReview);

/* ===================================================== 
   ADMIN 
===================================================== */
router.get("/:farmhouseId/admin/bookings", getFarmhouseBookings);
router.post("/:farmhouseId/admin/block", adminBlockSlot);
router.post("/admin/unblock", adminUnblockSlot);

export default router;