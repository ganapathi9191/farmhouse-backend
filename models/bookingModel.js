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
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  verificationId: {
    type: String,
    required: true
  },
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  
  bookingDetails: {
    date: { type: Date, required: true },
    label: { type: String, required: true },
    timing: { type: String, required: true },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true }
  },
  
  slotPrice: { type: Number, required: true },
  cleaningFee: { type: Number, default: 0, required: true },
  serviceFee: { type: Number, default: 0, required: true },
  totalAmount: { type: Number, required: true },
  
  status: {
    type: String,
    enum: ["pending", "confirmed", "cancelled", "completed"],
    default: "pending"
  },
  
  paymentStatus: {
    type: String,
    enum: ["pending", "completed", "failed", "refunded"],
    default: "completed"
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

bookingSchema.pre("save", function(next) {
  this.updatedAt = new Date();
  next();
});

export const Booking = mongoose.model("Booking", bookingSchema);