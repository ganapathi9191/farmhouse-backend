import express from "express";
import {
  addToCart,
  getCart,
  removeFromCart,
  clearCart,
  updateCartItem
} from "../controllers/cartController.js";

const router = express.Router();

router.post("/add", addToCart);
router.get("/:userId", getCart);
router.delete("/:userId/item/:itemId", removeFromCart);
router.delete("/:userId/clear", clearCart);
router.put("/:userId/item/:itemId", updateCartItem);

export default router;