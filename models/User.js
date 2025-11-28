import mongoose from "mongoose";

// --------------------------------------
// USER SCHEMA
// --------------------------------------
const userSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  fullName: String,
  username: String,

  gender: { type: String, enum: ["male", "female", "other"], default: "other" },

  email: { type: String, unique: true },
  phoneNumber: { type: String, unique: true },

  profileImage: String,

  password: String,
});

// --------------------------------------
// BANNER SCHEMA
// --------------------------------------
const bannerSchema = new mongoose.Schema({
  images: [String], // Cloudinary URLs array
  createdAt: { type: Date, default: Date.now }
});

// --------------------------------------
// EXPORT MODELS (NO DEFAULT)
// --------------------------------------
export const User = mongoose.model("User", userSchema);
export const Banner = mongoose.model("Banner", bannerSchema);
