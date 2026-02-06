import { Farmhouse } from "../models/farmhouseModel.js";
import { FeeConfig } from "../models/feeConfigModel.js";
import { calculateCheckTimes } from "../utils/timeHelper.js";

// ============================================
// ADD TO CART
// ============================================
export const addToCart = async (req, res) => {
  try {
    const { userId, farmhouseId, date, label, timing } = req.body;

    if (!userId || !farmhouseId || !date || !label || !timing) {
      return res.status(400).json({
        message: "userId, farmhouseId, date, label, and timing are required"
      });
    }

    // Get farmhouse
    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    // Get fee config
    let feeConfig = await FeeConfig.findOne({ isActive: true });
    if (!feeConfig) {
      feeConfig = await FeeConfig.create({});
    }

    // Find slot price
    const slot = farmhouse.timePrices.find(
      (tp) => tp.label === label && tp.timing === timing
    );

    if (!slot) {
      return res.status(404).json({ message: "Slot not found" });
    }

    const { checkIn, checkOut } = calculateCheckTimes(date, timing);

    // Check availability
    const overlap = farmhouse.bookedSlots.some(
      (b) => checkIn < b.checkOut && checkOut > b.checkIn
    );

    if (overlap) {
      return res.status(400).json({
        message: "Selected slot is not available"
      });
    }

    // Calculate fees
    const farmhouseFee = slot.price;
    const cleaningFee = feeConfig.cleaningFee;
    const serviceFee = feeConfig.serviceFee;
    const subtotal = farmhouseFee + cleaningFee + serviceFee;

    // Find or create cart
    let cart = await Cart.findOne({ userId });

    if (!cart) {
      cart = new Cart({ userId, items: [], totalAmount: 0 });
    }

    // Check if item already in cart
    const existingItem = cart.items.find(
      (item) =>
        item.farmhouseId.toString() === farmhouseId &&
        item.bookingDetails.date === date &&
        item.bookingDetails.label === label
    );

    if (existingItem) {
      return res.status(400).json({
        message: "This farmhouse with same slot is already in cart"
      });
    }

    // Add item to cart
    cart.items.push({
      farmhouseId,
      farmhouseName: farmhouse.name,
      farmhouseImage: farmhouse.images[0] || "",
      bookingDetails: {
        date,
        label,
        timing,
        checkIn,
        checkOut
      },
      farmhouseFee,
      cleaningFee,
      serviceFee,
      subtotal
    });

    // Update total
    cart.totalAmount = cart.items.reduce((sum, item) => sum + item.subtotal, 0);

    await cart.save();

    res.status(201).json({
      success: true,
      message: "Item added to cart successfully",
      cart
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// GET CART
// ============================================
export const getCart = async (req, res) => {
  try {
    const { userId } = req.params;

    let cart = await Cart.findOne({ userId }).populate(
      "items.farmhouseId",
      "name images address"
    );

    if (!cart) {
      cart = await Cart.create({ userId, items: [], totalAmount: 0 });
    }

    res.json({
      success: true,
      cart
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// REMOVE FROM CART
// ============================================
export const removeFromCart = async (req, res) => {
  try {
    const { userId, itemId } = req.params;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    cart.items = cart.items.filter((item) => item._id.toString() !== itemId);

    // Update total
    cart.totalAmount = cart.items.reduce((sum, item) => sum + item.subtotal, 0);

    await cart.save();

    res.json({
      success: true,
      message: "Item removed from cart",
      cart
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// CLEAR CART
// ============================================
export const clearCart = async (req, res) => {
  try {
    const { userId } = req.params;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    cart.items = [];
    cart.totalAmount = 0;

    await cart.save();

    res.json({
      success: true,
      message: "Cart cleared successfully",
      cart
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// UPDATE CART ITEM (FEES)
// ============================================
export const updateCartItem = async (req, res) => {
  try {
    const { userId, itemId } = req.params;
    const { cleaningFee, serviceFee } = req.body;

    const cart = await Cart.findOne({ userId });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const item = cart.items.id(itemId);
    if (!item) {
      return res.status(404).json({ message: "Item not found in cart" });
    }

    if (cleaningFee !== undefined) item.cleaningFee = cleaningFee;
    if (serviceFee !== undefined) item.serviceFee = serviceFee;

    item.subtotal = item.farmhouseFee + item.cleaningFee + item.serviceFee;

    // Update total
    cart.totalAmount = cart.items.reduce((sum, item) => sum + item.subtotal, 0);

    await cart.save();

    res.json({
      success: true,
      message: "Cart item updated successfully",
      cart
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};