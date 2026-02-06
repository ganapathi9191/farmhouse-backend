import { FeeConfig } from "../models/feeConfigModel.js";

// ============================================
// CREATE/UPDATE FEE CONFIG (ADMIN)
// ============================================
export const updateFeeConfig = async (req, res) => {
  try {
    const { cleaningFee, serviceFee } = req.body;

    let config = await FeeConfig.findOne({ isActive: true });

    if (!config) {
      config = await FeeConfig.create({
        cleaningFee,
        serviceFee,
        isActive: true
      });
    } else {
      if (cleaningFee !== undefined) config.cleaningFee = cleaningFee;
      if (serviceFee !== undefined) config.serviceFee = serviceFee;
      await config.save();
    }

    res.json({
      success: true,
      message: "Fee configuration updated successfully",
      config
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// GET FEE CONFIG
// ============================================
// ============================================
// GET ALL FEE CONFIGS
// ============================================
export const getFeeConfig = async (req, res) => {
  try {
    const configs = await FeeConfig.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      count: configs.length,
      configs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================================
// GET FEE CONFIG BY ID
// ============================================
export const getFeeConfigById = async (req, res) => {
  try {
    const { id } = req.params;

    const config = await FeeConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        success: false,
        message: "Fee configuration not found"
      });
    }

    res.json({
      success: true,
      config
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ============================================
// DELETE FEE CONFIG
// ============================================
export const deleteFeeConfig = async (req, res) => {
  try {
    const { id } = req.params;

    const config = await FeeConfig.findById(id);

    if (!config) {
      return res.status(404).json({
        success: false,
        message: "Fee configuration not found"
      });
    }

    await FeeConfig.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Fee configuration deleted successfully"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
