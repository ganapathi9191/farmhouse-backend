// models/transactionModel.js
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  bookingIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking"
  }],
  amount: {
    type: Number,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ["online", "cash", "card"],
    default: "online"
  },
  status: {
    type: String,
    enum: ["pending", "completed", "failed", "refunded"],
    default: "pending"
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export const Transaction = mongoose.model("Transaction", transactionSchema);