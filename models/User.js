import mongoose from "mongoose";

const addressSchema = new mongoose.Schema({
  street: String,
  city: String,
  state: String,
  country: String,
  postalCode: String,
  addressType: String, // Home, Office, Hostel...
  lat: Number,
  lng: Number,
  fullAddress: String
});

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

  // 🔥 Live Location GeoJSON
  liveLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number], // [lng, lat]
      default: [0.0, 0.0]
    }
  },

  // 🔥 Array of Addresses
  addresses: [addressSchema]
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

userSchema.index({ location: "2dsphere" });


export const User = mongoose.model("User", userSchema);
export const Banner = mongoose.model("Banner", bannerSchema);
