// models/vendorModel.js
import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  password: { type: String, required: true },
  farmhouseId: { type: mongoose.Schema.Types.ObjectId, ref: "Farmhouse" ,},
  createdAt: { type: Date, default: Date.now }
});

export const Vendor = mongoose.model("Vendor", vendorSchema);