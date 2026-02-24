import express from "express";
import {
  vendorLogin,

} from "../controllers/vendorController.js";

const router = express.Router();

// Public routes
router.post("/login", vendorLogin);

export default router;