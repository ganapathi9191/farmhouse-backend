import mongoose from "mongoose";

const farmhouseSchema = new mongoose.Schema({
  name: { type: String, required: true },

  images: [String],

  address: { type: String, required: true },

  description: String,

  amenities: [String],

  bookingFor: { type: String },

  pricePerHour: { type: Number, required: true },  // ⭐ required
  pricePerDay: { type: Number, required: true },   // ⭐ required

  rating: { type: Number, default: 0 },

  feedbackSummary: { type: String, default: "" },

  location: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number],
      default: [0.0, 0.0]
    }
  },

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
