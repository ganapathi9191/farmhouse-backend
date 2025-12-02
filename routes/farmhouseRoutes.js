import express from "express";
import upload from "../utils/upload.js";
import {
  createFarmhouse,
  getAllFarmhouses,
  getFarmhouseById,
  updateFarmhouse,
  deleteFarmhouse,
  toggleWishlist,
  getNearbyFarmhouses
} from "../controllers/farmhouseController.js";

const router = express.Router();

router.post("/farmhouse-create", upload.array("images", 10), createFarmhouse);
router.get("/all-farmhouse", getAllFarmhouses);
router.get("/farmhouse/:farmhouseId", getFarmhouseById);
router.put("/farmhouse/:farmhouseId", upload.array("images", 10), updateFarmhouse);
router.delete("/farmhouse/:farmhouseId", deleteFarmhouse);

// wishlist
router.put("/:farmhouseId/wishlist/:userId", toggleWishlist);

// nearby
router.get("/nearby/user/:userId", getNearbyFarmhouses);

export default router;
