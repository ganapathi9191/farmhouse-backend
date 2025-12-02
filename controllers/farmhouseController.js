import { Farmhouse } from "../models/farmhouseModel.js";
import cloudinary from "../config/cloudinary.js";
import { User } from "../models/User.js";

// ----------------------------------------------
// CREATE FARMHOUSE
// ----------------------------------------------
export const createFarmhouse = async (req, res) => {
  try {
    const {
      name,
      address,
      description,
      amenities,
      price,
      rating,
      feedbackSummary,
      bookingFor,
      lat,
      lng
    } = req.body;

    if (!name || !address || !price)
      return res.status(400).json({ message: "Name, Address & Price required" });

    if (!lat || !lng)
      return res.status(400).json({ message: "Lat & Lng required" });

    let imageUrls = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const uploaded = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              folder: "farmhouses",
              resource_type: "auto"
            },
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          ).end(file.buffer);
        });
        imageUrls.push(uploaded.secure_url);
      }
    }

    const farmhouse = await Farmhouse.create({
      name,
      images: imageUrls,
      address,
      description,
      amenities: amenities ? amenities.split(",") : [],
      price,
      rating,
      feedbackSummary,
      bookingFor,
      location: {
        type: "Point",
        coordinates: [lng, lat]
      }
    });

    res.json({
      success: true,
      message: "Farmhouse created successfully",
      farmhouse
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ----------------------------------------------
// GET ALL FARMHOUSES
// ----------------------------------------------
export const getAllFarmhouses = async (req, res) => {
  try {
    const farmhouses = await Farmhouse.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      farmhouses
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ----------------------------------------------
// GET FARMHOUSE BY ID
// ----------------------------------------------
export const getFarmhouseById = async (req, res) => {
  try {
    const farmhouse = await Farmhouse.findById(req.params.farmhouseId);

    if (!farmhouse)
      return res.status(404).json({ message: "Farmhouse not found" });

    res.json({ success: true, farmhouse });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ----------------------------------------------
// UPDATE FARMHOUSE
// ----------------------------------------------
export const updateFarmhouse = async (req, res) => {
  try {
    const farmhouse = await Farmhouse.findById(req.params.farmhouseId);
    if (!farmhouse)
      return res.status(404).json({ message: "Farmhouse not found" });

    let newImages = farmhouse.images;

    if (req.files && req.files.length > 0) {
      // delete old images
      for (const img of farmhouse.images) {
        const publicId = img.split("/").pop().split(".")[0];
        cloudinary.uploader.destroy(`farmhouses/${publicId}`);
      }

      newImages = [];

      for (const file of req.files) {
        const uploaded = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            { folder: "farmhouses", resource_type: "auto" },
            (err, result) => err ? reject(err) : resolve(result)
          ).end(file.buffer);
        });
        newImages.push(uploaded.secure_url);
      }
    }

    const updated = await Farmhouse.findByIdAndUpdate(
      req.params.farmhouseId,
      {
        ...req.body,
        images: newImages
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "Farmhouse updated",
      farmhouse: updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ----------------------------------------------
// DELETE FARMHOUSE
// ----------------------------------------------
export const deleteFarmhouse = async (req, res) => {
  try {
    const farmhouse = await Farmhouse.findById(req.params.farmhouseId);
    if (!farmhouse)
      return res.status(404).json({ message: "Farmhouse not found" });

    for (const img of farmhouse.images) {
      const publicId = img.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(`farmhouses/${publicId}`);
    }

    await Farmhouse.findByIdAndDelete(req.params.farmhouseId);

    res.json({
      success: true,
      message: "Farmhouse deleted successfully"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ----------------------------------------------
// ADD / REMOVE WISHLIST
// ----------------------------------------------
export const toggleWishlist = async (req, res) => {
  try {
    const { farmhouseId, userId } = req.params;

    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse)
      return res.status(404).json({ message: "Farmhouse not found" });

    const exists = farmhouse.wishlist.includes(userId);

    if (exists) {
      farmhouse.wishlist.pull(userId);
      await farmhouse.save();
      return res.json({ success: true, message: "Removed from wishlist" });
    } else {
      farmhouse.wishlist.push(userId);
      await farmhouse.save();
      return res.json({ success: true, message: "Added to wishlist" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ----------------------------------------------
// NEARBY FARMHOUSES
// ----------------------------------------------
export const getNearbyFarmhouses = async (req, res) => {
  try {
    const { userId } = req.params;

    // 1. Fetch user
    const user = await User.findById(userId);

    if (!user)
      return res.status(404).json({ message: "User not found" });

    // 2. Extract coordinates
    const [lng, lat] = user.liveLocation?.coordinates || [];

    if (!lat || !lng)
      return res.status(400).json({
        message: "User location missing. Please update live location first."
      });

    // 3. Nearby search (default: 5 km)
    const farmhouses = await Farmhouse.find({
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: 5000
        }
      }
    });

    res.json({
      success: true,
      userLocation: { lat, lng },
      count: farmhouses.length,
      farmhouses
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};