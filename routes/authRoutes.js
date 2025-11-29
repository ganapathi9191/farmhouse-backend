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

router.post("/create-banner", upload.array("images", 10), UserController.createBanner);
router.get("/all-banners", UserController.getAllBanners);
router.get("/get/:bannerId", UserController.getBanner);
router.put("/update-banner/:bannerId", upload.array("images", 10), UserController.updateBanner);
router.delete("/delete-banner/:bannerId", UserController.deleteBanner);

// LIVE LOCATION
router.post("/:userId/live-location", UserController.saveLiveLocation);
router.put("/:userId/live-location", UserController.saveLiveLocation);
router.get("/:userId/live-location", UserController.getLiveLocation);
router.delete("/:userId/live-location", UserController.deleteLiveLocation);

// ADDRESS CRUD
router.post("/:userId/add-address", UserController.addAddress);
router.put("/:userId/update-address/:addressIndex", UserController.updateAddress);
router.delete("/:userId/delete-address/:addressIndex", UserController.deleteAddress);
router.get("/:userId/all-addresses", UserController.getAllAddresses);

export default router;
