import mongoose from "mongoose";

const farmhouseSchema = new mongoose.Schema({
  name: { type: String, required: true },

  images: [String], // cloudinary URLs

  address: { type: String, required: true },

  description: String,

  amenities: [String], // ["pool", "bbq", "garden"]

  bookingFor: { type: String }, // ex: "birthday", "marriage", "friends-party"

  price: { type: Number, required: true },

  rating: { type: Number, default: 0 },

  feedbackSummary: { type: String, default: "" },

  // GeoJSON location for NEARBY FARMHOUSE
  location: {
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

  // Wishlist – users who saved farmhouse
  wishlist: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  ],

  createdAt: { type: Date, default: Date.now }
});

// 2D Geospatial Index
farmhouseSchema.index({ location: "2dsphere" });

export const Farmhouse = mongoose.model("Farmhouse", farmhouseSchema);
