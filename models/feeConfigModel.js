import mongoose from "mongoose";

const feeConfigSchema = new mongoose.Schema({
  cleaningFee: {
    type: Number,
    default: 200,
    required: true
  },
  serviceFee: {
    type: Number,
    default: 100,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

feeConfigSchema.pre("save", function(next) {
  this.updatedAt = new Date();
  next();
});

export const FeeConfig = mongoose.model("FeeConfig", feeConfigSchema);