import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  farmhouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Farmhouse",
    required: true
  },

  farmhouseImage: { 
    type: String, 
    default: null             // ⭐ newly added field
  },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },

  totalPrice: { type: Number, required: true },

  status: {
    type: String,
    enum: ["pending", "confirmed", "cancelled"],
    default: "pending"
  },

  createdAt: { type: Date, default: Date.now }
});

// Prevent overlapping bookings
bookingSchema.index({ farmhouseId: 1, startDate: 1, endDate: 1 });

export const Booking = mongoose.model("Booking", bookingSchema);
