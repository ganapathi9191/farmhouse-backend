import User from "../models/User.js";
import bcrypt from "bcryptjs";
import { generateToken, verifyToken } from "../utils/jwt.js";


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