import User from "../models/User.js";
import bcrypt from "bcryptjs";
import { generateToken, verifyToken } from "../utils/jwt.js";


// REGISTER
export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, phoneNumber, password, confirmPassword } = req.body;

    if (!firstName || !lastName || !email || !phoneNumber || !password || !confirmPassword)
      return res.status(400).json({ message: "All fields required" });

    if (password !== confirmPassword)
      return res.status(400).json({ message: "Passwords do not match" });

    const exist = await User.findOne({ phoneNumber });
    if (exist) return res.status(400).json({ message: "Phone number already registered" });

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstName, lastName, email, phoneNumber, password: hashed
    });

    res.json({
      success: true,
      message: "Registration successful",
      user
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// LOGIN
export const login = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid password" });

    res.json({
      success: true,
      message: "Login successful",
      user
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// FORGOT PASSWORD → OTP (1234)
export const forgotPassword = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user) return res.status(400).json({ message: "Phone number not registered" });

    const otp = "1234"; // FIXED OTP

    const token = generateToken({ phoneNumber, otp }, "10m");

    res.json({
      success: true,
      message: "OTP sent successfully",
      otp,
      token
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// VERIFY OTP
export const verifyOtp = async (req, res) => {
  try {
    const { token, otp } = req.body;

    const decoded = verifyToken(token);

    if (decoded.otp !== otp)
      return res.status(400).json({ message: "Invalid OTP" });

    res.json({
      success: true,
      message: "OTP Verified",
      phoneNumber: decoded.phoneNumber
    });

  } catch (err) {
    res.status(500).json({ error: "Invalid or expired token" });
  }
};


// RESET PASSWORD
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmNewPassword } = req.body;

    if (newPassword !== confirmNewPassword)
      return res.status(400).json({ message: "Passwords do not match" });

    const decoded = verifyToken(token);

    const hashed = await bcrypt.hash(newPassword, 10);

    await User.findOneAndUpdate(
      { phoneNumber: decoded.phoneNumber },
      { password: hashed }
    );

    res.json({
      success: true,
      message: "Password Reset Successfully"
    });

  } catch (err) {
    res.status(500).json({ error: "Invalid or expired token" });
  }
};
