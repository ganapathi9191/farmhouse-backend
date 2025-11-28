import User from "../models/User.js";
import bcrypt from "bcryptjs";
import { generateToken, verifyToken } from "../utils/jwt.js";
import cloudinary from "../config/cloudinary.js";

export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, phoneNumber, password, confirmPassword } = req.body;

    if (!firstName || !lastName || !email || !phoneNumber || !password || !confirmPassword)
      return res.status(400).json({ message: "All fields required" });

    if (password !== confirmPassword)
      return res.status(400).json({ message: "Passwords do not match" });

    const exists = await User.findOne({ phoneNumber });
    if (exists)
      return res.status(400).json({ message: "Phone number already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      email,
      phoneNumber,
      password: hashedPassword
    });

    const otp = "1234";

    const token = generateToken(
      { id: user._id, phoneNumber, otp, type: "register" },
      "10m"
    );

    res.json({
      success: true,
      message: "Registration successful. OTP sent!",
      otp,
      token,
      user
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// -----------------------------
// VERIFY OTP (REGISTER / LOGIN / FORGOT)
// -----------------------------
export const verifyOtp = async (req, res) => {
  try {
    const { token, otp } = req.body;

    if (!token || !otp)
      return res.status(400).json({ message: "Token & OTP required" });

    const decoded = verifyToken(token);

    if (decoded.otp !== otp)
      return res.status(400).json({ message: "Invalid OTP" });

    // CASE 1: Registration / Login → final auth token
    if (decoded.type === "register" || decoded.type === "login") {
      const finalToken = generateToken(
        { id: decoded.id, phoneNumber: decoded.phoneNumber },
        "7d"
      );

      return res.json({
        success: true,
        message: "OTP Verified Successfully",
        token: finalToken
      });
    }

    // CASE 2: Forgot password → return reset-password token
    if (decoded.type === "forgot") {
      const resetToken = generateToken(
        { phoneNumber: decoded.phoneNumber, type: "reset" },
        "15m"
      );

      return res.json({
        success: true,
        message: "OTP Verified. You may now reset your password.",
        token: resetToken
      });
    }

    res.status(400).json({ message: "Invalid OTP flow" });

  } catch (err) {
    res.status(500).json({ message: "Invalid or expired token" });
  }
};


// -----------------------------
// LOGIN
// -----------------------------
export const login = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user)
      return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: "Invalid password" });

    const otp = "1234";

    const otpToken = generateToken(
      { id: user._id, phoneNumber, otp, type: "login" },
      "10m"
    );

    res.json({
      success: true,
      message: "Login successful. OTP sent!",
      otp,
      token: otpToken,
      user
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// -----------------------------
// FORGOT PASSWORD
// -----------------------------
export const forgotPassword = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user)
      return res.status(400).json({ message: "Phone number not registered" });

    const otp = "1234";

    const otpToken = generateToken(
      { phoneNumber, otp, type: "forgot" },
      "10m"
    );

    res.json({
      success: true,
      message: "OTP sent for password reset",
      otp,
      token: otpToken
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// -----------------------------
// RESET PASSWORD
// -----------------------------
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmNewPassword } = req.body;

    if (newPassword !== confirmNewPassword)
      return res.status(400).json({ message: "Passwords do not match" });

    const decoded = verifyToken(token);

    if (decoded.type !== "reset")
      return res.status(400).json({ message: "Invalid reset token" });

    const hashed = await bcrypt.hash(newPassword, 10);

    await User.findOneAndUpdate(
      { phoneNumber: decoded.phoneNumber },
      { password: hashed }
    );

    res.json({
      success: true,
      message: "Password reset successful"
    });

  } catch (err) {
    res.status(500).json({ message: "Invalid or expired token" });
  }
};


// ------------------------
// UPDATE PROFILE
// ------------------------
export const updateProfile = async (req, res) => {
    try {
    const { userId } = req.params;

    console.log("📝 Update Profile Request:");
    console.log("UserID:", userId);
    console.log("Body:", req.body);
    console.log("File:", req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : "No file");

    // Validate userId
    if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    const { fullName, username, gender } = req.body;

    if (!fullName) {
      return res.status(400).json({ message: "Full Name is required" });
    }

    // Split full name
    const nameParts = fullName.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "";

    let updateData = {
      fullName,
      firstName,
      lastName,
    };

    if (username) updateData.username = username;
    if (gender) updateData.gender = gender;

    // Handle image upload to Cloudinary
    if (req.file) {
      try {
        console.log("☁️ Uploading to Cloudinary...");
        console.log("Environment check:", {
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET ? "present" : "missing"
        });
        
        // Re-configure cloudinary to ensure credentials are set
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
          secure: true
        });
        
        const uploadedImage = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { 
              folder: "profile_images",
              resource_type: "auto",
              transformation: [
                { width: 500, height: 500, crop: "limit" }
              ]
            },
            (error, result) => {
              if (error) {
                console.error("❌ Cloudinary error:", error);
                reject(error);
              } else {
                console.log("✅ Cloudinary success:", result.secure_url);
                resolve(result);
              }
            }
          );
          
          uploadStream.end(req.file.buffer);
        });

        updateData.profileImage = uploadedImage.secure_url;
        
      } catch (uploadError) {
        console.error("❌ Upload error:", uploadError);
        return res.status(500).json({ 
          message: "Image upload failed", 
          error: uploadError.message,
          details: uploadError.http_code ? `Cloudinary error ${uploadError.http_code}` : "Unknown error"
        });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      updateData, 
      {
        new: true,
        runValidators: true
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      profile: updatedUser,
    });

  } catch (err) {
    console.error("❌ Update profile error:", err);
    res.status(500).json({ 
      message: "Error updating profile",
      error: err.message 
    });
  }
};

// ------------------------
// GET PROFILE
// ------------------------
export const getProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      profile: user,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ------------------------
// DELETE PROFILE IMAGE
// ------------------------
export const deleteProfileImage = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user || !user.profileImage)
      return res.status(404).json({ message: "No image found" });

    const publicId = user.profileImage.split("/").pop().split(".")[0];

    await cloudinary.uploader.destroy(`profile_images/${publicId}`);

    user.profileImage = null;
    await user.save();

    res.json({
      success: true,
      message: "Profile image deleted successfully",
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ------------------------
// DELETE ACCOUNT
// ------------------------
export const deleteAccount = async (req, res) => {
   try {
    const { userId } = req.params;

    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: "Account deleted successfully",
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};