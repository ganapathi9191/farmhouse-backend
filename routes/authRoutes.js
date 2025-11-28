import express from "express";
import * as UserController from  "../controllers/authController.js";
import upload from "../utils/upload.js";
const router = express.Router();

router.post("/register", UserController.register);
router.post("/login", UserController.login);
router.post("/forgot-password", UserController.forgotPassword);
router.post("/verify-otp", UserController.verifyOtp);
router.post("/reset-password", UserController.resetPassword);

router.get("/getprofile/:userId", UserController.getProfile);

router.put("/:userId/update", upload.single("profileImage"), UserController.updateProfile);
router.delete("/delete-image/:userId", UserController.deleteProfileImage);

router.delete("/delete-account/:userId", UserController.deleteAccount);
export default router;
