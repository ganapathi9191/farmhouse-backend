import { Vendor } from "../models/vendor.js";
import { Farmhouse } from "../models/farmhouseModel.js";

// ============================================
// VENDOR LOGIN
// ============================================
export const vendorLogin = async (req, res) => {
  try {
    const { name, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({
        success: false,
        message: "Name and password are required"
      });
    }

    // Find vendor by name and password
    const vendor = await Vendor.findOne({ name, password });

    if (!vendor) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }

    // Get farmhouse details
    const farmhouse = await Farmhouse.findById(vendor.farmhouseId);

    // Prepare vendor data (excluding password for security)
    const vendorData = {
      _id: vendor._id,
      name: vendor.name,
      farmhouseId: vendor.farmhouseId,
      createdAt: vendor.createdAt
    };

    res.json({
      success: true,
      message: "Login successful",
      vendor: vendorData,
      farmhouse: farmhouse || null
    });
  } catch (err) {
    console.error("Vendor login error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};