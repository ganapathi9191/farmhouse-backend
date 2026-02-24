import express from "express";
import upload from "../utils/upload.js";
import {
  createFarmhouse,
    toggleActiveStatus,      // New
  addInactiveDate,        // New
  removeInactiveDate,     // New
  getInactiveDates,       // New
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

  createReview,

  toggleSlotActive
  
} from "../controllers/farmhouseController.js";

const router = express.Router();

/* ===================================================== 
   FARMHOUSE CRUD 
===================================================== */
router.post("/farmhouse-create", upload.array("images", 10), createFarmhouse);

// New admin control routes
router.put("/:farmhouseId/toggle-active", toggleActiveStatus);
router.post("/:farmhouseId/inactive-dates", addInactiveDate);
router.delete("/:farmhouseId/inactive-dates/:dateId", removeInactiveDate);
router.get("/:farmhouseId/inactive-dates", getInactiveDates);

router.get("/all-farmhouse", getAllFarmhouses);
router.get("/farmhouse/:farmhouseId", getFarmhouseById);
router.put("/farmhouse/:farmhouseId", upload.array("images", 10), updateFarmhouse);
router.delete("/farmhouse/:farmhouseId", deleteFarmhouse);

router.put("/:farmhouseId/slots/:slotId/toggle", toggleSlotActive);

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
router.get("/search", searchFarmhouse);
router.get("/search-filter", filterFarmhouses);

/* ===================================================== 
   REVIEWS 
===================================================== */
router.post("/:farmhouseId/review", createReview);


export default router;