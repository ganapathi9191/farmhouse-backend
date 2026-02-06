import mongoose from "mongoose";

const verificationTokenSchema = new mongoose.Schema({
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
  verificationId: {
    type: String,
    required: true,
    unique: true
  },
  slotDetails: {
    date: Date,
    label: String,
    timing: String,
    checkIn: Date,
    checkOut: Date,
    price: Number
  },
  priceBreakdown: {
    slotPrice: Number,
    cleaningFee: Number,
    serviceFee: Number,
    totalAmount: Number
  },
  status: {
    type: String,
    enum: ["pending", "used", "expired"],
    default: "pending"
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create TTL index for auto-deletion after expiry
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationToken = mongoose.model("VerificationToken", verificationTokenSchema);