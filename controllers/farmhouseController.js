import { Farmhouse } from "../models/farmhouseModel.js";
import cloudinary from "../config/cloudinary.js";
import { User } from "../models/User.js";
import { calculateCheckTimes } from "../utils/timeHelper.js";

// ============================================
// CREATE FARMHOUSE
// ============================================
export const createFarmhouse = async (req, res) => {
  try {
    const {
      name,
      address,
      description,
      amenities,
      pricePerHour,
      pricePerDay,
      rating,
      feedbackSummary,
      bookingFor,
      lat,
      lng,
      timePrices
    } = req.body;

    if (!name || !address) {
      return res.status(400).json({ message: "Name & Address required" });
    }

    if (!lat || !lng) {
      return res.status(400).json({ message: "Lat & Lng required" });
    }

    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const uploaded = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            { folder: "farmhouses", resource_type: "auto" },
            (err, result) => (err ? reject(err) : resolve(result))
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
      pricePerHour,
      pricePerDay,
      rating,
      feedbackSummary,
      bookingFor,
      timePrices: timePrices ? JSON.parse(timePrices) : [],
      location: {
        type: "Point",
        coordinates: [lng, lat]
      }
    });

    res.status(201).json({
      success: true,
      message: "Farmhouse created successfully",
      farmhouse
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// GET ALL FARMHOUSES
// ============================================
export const getAllFarmhouses = async (req, res) => {
  try {
    const farmhouses = await Farmhouse.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      count: farmhouses.length,
      farmhouses
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// GET SINGLE FARMHOUSE BY ID
// ============================================
export const getFarmhouseById = async (req, res) => {
  try {
    const farmhouse = await Farmhouse.findById(req.params.farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }
    res.json({
      success: true,
      farmhouse
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// UPDATE FARMHOUSE
// ============================================
export const updateFarmhouse = async (req, res) => {
  try {
    const farmhouse = await Farmhouse.findById(req.params.farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    let newImages = farmhouse.images;

    // If new images uploaded, replace old ones
    if (req.files && req.files.length > 0) {
      // Delete old images from cloudinary
      for (const img of farmhouse.images) {
        const publicId = img.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(`farmhouses/${publicId}`);
      }

      newImages = [];
      for (const file of req.files) {
        const uploaded = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            { folder: "farmhouses", resource_type: "auto" },
            (err, result) => (err ? reject(err) : resolve(result))
          ).end(file.buffer);
        });
        newImages.push(uploaded.secure_url);
      }
    }

    const updateData = { ...req.body, images: newImages };
    
    if (req.body.timePrices) {
      updateData.timePrices = JSON.parse(req.body.timePrices);
    }
    if (req.body.amenities) {
      updateData.amenities = req.body.amenities.split(",");
    }

    const updated = await Farmhouse.findByIdAndUpdate(
      req.params.farmhouseId,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: "Farmhouse updated successfully",
      farmhouse: updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// DELETE FARMHOUSE
// ============================================
export const deleteFarmhouse = async (req, res) => {
  try {
    const farmhouse = await Farmhouse.findById(req.params.farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    // Delete images from cloudinary
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

// ============================================
// TOGGLE WISHLIST
// ============================================
export const toggleWishlist = async (req, res) => {
  try {
    const { farmhouseId, userId } = req.params;

    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    const exists = farmhouse.wishlist.includes(userId);

    if (exists) {
      farmhouse.wishlist.pull(userId);
      await farmhouse.save();
      return res.json({
        success: true,
        message: "Removed from wishlist"
      });
    } else {
      farmhouse.wishlist.push(userId);
      await farmhouse.save();
      return res.json({
        success: true,
        message: "Added to wishlist"
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// Get all farmhouses that a user has wishlisted
export const getUserWishlists = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const wishlistedFarmhouses = await Farmhouse.find({
      wishlist: userId
    });
    
    res.json({
      success: true,
      count: wishlistedFarmhouses.length,
      data: wishlistedFarmhouses
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// ============================================
// GET NEARBY FARMHOUSES
// ============================================
export const getNearbyFarmhouses = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const [lng, lat] = user.liveLocation?.coordinates || [];
    if (!lat || !lng) {
      return res.status(400).json({
        message: "User location missing. Please update live location first."
      });
    }

    const farmhouses = await Farmhouse.find({
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [lng, lat] },
          $maxDistance: 5000 // 5km
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

// ============================================
// GET AVAILABLE SLOTS (DEBUG VERSION)
// ============================================
export const getAvailableSlots = async (req, res) => {
  try {
    const { farmhouseId } = req.params;
    const { date } = req.query;

    console.log("📅 Getting available slots for:", { farmhouseId, date });

    if (!date) {
      return res.status(400).json({ 
        success: false,
        message: "date is required" 
      });
    }

    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ 
        success: false,
        message: "Farmhouse not found" 
      });
    }

    console.log("🏠 Farmhouse found:", farmhouse.name);
    console.log("📊 Time prices:", farmhouse.timePrices);
    console.log("📅 Booked slots:", farmhouse.bookedSlots);
    console.log("📆 Requested date:", date);

    const slots = [];

    // If no timePrices defined, return empty slots
    if (!farmhouse.timePrices || farmhouse.timePrices.length === 0) {
      return res.json({
        success: true,
        date,
        message: "No slots defined for this farmhouse",
        slots: []
      });
    }

    for (const tp of farmhouse.timePrices) {
      if (!tp.timing) {
        console.log("⚠️ Skipping slot with no timing:", tp);
        continue;
      }

      // Normalize timing
      const timing = String(tp.timing)
        .trim()
        .replace(/\s+/g, "")
        .replace("–", "-")
        .toLowerCase();

      console.log(`Processing slot: ${tp.label} - ${timing}`);

      try {
        const { checkIn, checkOut } = calculateCheckTimes(date, timing);
        
        console.log(`Calculated times: ${checkIn} to ${checkOut}`);

        // Check if slot is booked
        const blocked = farmhouse.bookedSlots.some(
          (slot) => {
            const isOverlap = checkIn < slot.checkOut && checkOut > slot.checkIn;
            console.log(`Checking overlap with booked slot ${slot.label}: ${isOverlap}`);
            return isOverlap;
          }
        );

        slots.push({
          label: tp.label,
          timing: timing,
          price: tp.price || 0,
          available: !blocked,
          checkIn,
          checkOut
        });

        console.log(`Slot ${tp.label}: ${blocked ? 'Booked' : 'Available'}`);

      } catch (err) {
        console.error("❌ Error calculating times for slot:", tp.timing, err.message);
        // Skip invalid slot
      }
    }

    console.log("✅ Final slots:", slots);

    return res.json({
      success: true,
      date,
      slots
    });
  } catch (err) {
    console.error("❌ Error in getAvailableSlots:", err);
    return res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};




// ============================================
// CHECK AVAILABILITY BY DATE RANGE (DEBUG VERSION)
// ============================================
export const checkAvailabilityByRange = async (req, res) => {
  try {
    const { farmhouseId, date, timing } = req.query;

    if (!farmhouseId || !date || !timing) {
      return res.status(400).json({
        success: false,
        message: "farmhouseId, date and timing are required"
      });
    }

    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({
        success: false,
        message: "Farmhouse not found"
      });
    }

    // Build slot time
    const { checkIn, checkOut } = calculateCheckTimes(date, timing);

    const now = new Date();

    /* ❌ PAST TIME CHECK */
    if (checkIn <= now) {
      return res.json({
        success: true,
        available: false,
        reason: "Selected date & time is already passed",
        now,
        checkIn
      });
    }

    /* ❌ OVERLAP CHECK */
    const isBooked = farmhouse.bookedSlots.some(
      slot => checkIn < slot.checkOut && checkOut > slot.checkIn
    );

    if (isBooked) {
      return res.json({
        success: true,
        available: false,
        reason: "Slot already booked",
        checkIn,
        checkOut
      });
    }

    /* ✅ AVAILABLE */
    return res.json({
      success: true,
      available: true,
      checkIn,
      checkOut,
      message: "Slot is available"
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};
// ============================================
// BOOK SLOT
// ============================================
export const bookSlot = async (req, res) => {
  try {
    const { farmhouseId } = req.params;
    const { userId, date, label, timing } = req.body;

    if (!userId || !date || !label || !timing) {
      return res.status(400).json({
        message: "userId, date, label and timing are required"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    const { checkIn, checkOut } = calculateCheckTimes(date, timing);

    // Check if slot is already booked (overlap)
    const overlap = farmhouse.bookedSlots.some(
      (b) => checkIn < b.checkOut && checkOut > b.checkIn
    );

    if (overlap) {
      return res.status(400).json({
        message: "Selected slot is not available"
      });
    }

    // Check if same user already booked this slot
    const userBooked = farmhouse.bookedSlots.some(
      (b) =>
        b.userId && b.userId.toString() === userId &&
        checkIn < b.checkOut &&
        checkOut > b.checkIn
    );

    if (userBooked) {
      return res.status(400).json({
        message: "You have already booked this slot"
      });
    }

    farmhouse.bookedSlots.push({
      userId,
      checkIn,
      checkOut,
      label,
      timing
    });

    await farmhouse.save();

    res.json({
      success: true,
      message: "Slot booked successfully",
      booking: {
        userId,
        checkIn,
        checkOut,
        label,
        timing
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// CANCEL BOOKING
// ============================================
export const cancelBooking = async (req, res) => {
  try {
    const { farmhouseId } = req.params;
    const { userId, checkIn } = req.body;

    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    const before = farmhouse.bookedSlots.length;

    farmhouse.bookedSlots = farmhouse.bookedSlots.filter(
      (b) =>
        !(
          b.userId &&
          b.userId.toString() === userId &&
          b.checkIn.toISOString() === checkIn
        )
    );

    if (before === farmhouse.bookedSlots.length) {
      return res.status(404).json({ message: "Booking not found" });
    }

    await farmhouse.save();

    res.json({
      success: true,
      message: "Booking cancelled successfully"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// GET USER BOOKINGS
// ============================================
export const getUserBookings = async (req, res) => {
  try {
    const { userId } = req.params;

    const farmhouses = await Farmhouse.find({
      "bookedSlots.userId": userId
    });

    let bookings = [];

    farmhouses.forEach((farmhouse) => {
      farmhouse.bookedSlots.forEach((slot) => {
        if (slot.userId && slot.userId.toString() === userId) {
          bookings.push({
            farmhouseId: farmhouse._id,
            farmhouseName: farmhouse.name,
            farmhouseAddress: farmhouse.address,
            checkIn: slot.checkIn,
            checkOut: slot.checkOut,
            label: slot.label,
            timing: slot.timing,
            bookedAt: slot.bookedAt
          });
        }
      });
    });

    res.json({
      success: true,
      count: bookings.length,
      bookings
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// GET USER BOOKING HISTORY (PAST & UPCOMING)
// ============================================
export const getUserBookingHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const now = new Date();

    const farmhouses = await Farmhouse.find({
      "bookedSlots.userId": userId
    });

    let upcoming = [];
    let past = [];

    farmhouses.forEach((farmhouse) => {
      farmhouse.bookedSlots.forEach((slot) => {
        if (slot.userId && slot.userId.toString() === userId) {
          const booking = {
            farmhouseId: farmhouse._id,
            farmhouseName: farmhouse.name,
            farmhouseAddress: farmhouse.address,
            checkIn: slot.checkIn,
            checkOut: slot.checkOut,
            label: slot.label,
            timing: slot.timing,
            bookedAt: slot.bookedAt
          };

          if (slot.checkOut > now) {
            upcoming.push(booking);
          } else {
            past.push(booking);
          }
        }
      });
    });

    res.json({
      success: true,
      upcoming,
      past
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// CREATE REVIEW
// ============================================
export const createReview = async (req, res) => {
  try {
    const { farmhouseId } = req.params;
    const { userId, rating, content } = req.body;

    const farmhouse = await Farmhouse.findById(farmhouseId);
    const user = await User.findById(userId);

    if (!farmhouse || !user) {
      return res.status(404).json({ message: "Invalid data" });
    }

    farmhouse.reviews.push({
      userId,
      name: user.name,
      image: user.profileImage,
      rating,
      content
    });

    await farmhouse.save();

    res.json({
      success: true,
      message: "Review added successfully"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// GET FARMHOUSE BOOKINGS (ADMIN)
// ============================================
export const getFarmhouseBookings = async (req, res) => {
  try {
    const { farmhouseId } = req.params;

    const farmhouse = await Farmhouse.findById(farmhouseId).populate(
      "bookedSlots.userId",
      "name email"
    );

    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    res.json({
      success: true,
      farmhouse: farmhouse.name,
      bookings: farmhouse.bookedSlots
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN BLOCK SLOT
// ============================================
export const adminBlockSlot = async (req, res) => {
  try {
    const { farmhouseId } = req.params;
    const { startDate, endDate, reason } = req.body;

    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    farmhouse.bookedSlots.push({
      userId: null,
      checkIn: new Date(startDate),
      checkOut: new Date(endDate),
      label: "Blocked",
      timing: reason || "Admin Block"
    });

    await farmhouse.save();

    res.json({
      success: true,
      message: "Slot blocked successfully"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// ADMIN UNBLOCK SLOT
// ============================================
export const adminUnblockSlot = async (req, res) => {
  try {
    const { farmhouseId, checkIn } = req.body;

    const farmhouse = await Farmhouse.findById(farmhouseId);
    if (!farmhouse) {
      return res.status(404).json({ message: "Farmhouse not found" });
    }

    farmhouse.bookedSlots = farmhouse.bookedSlots.filter(
      (b) => b.checkIn.toISOString() !== checkIn
    );

    await farmhouse.save();

    res.json({
      success: true,
      message: "Slot unblocked successfully"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// SEARCH FARMHOUSE
// ============================================

export const searchFarmhouse = async (req, res) => {
  try {
    const { query, minPrice, maxPrice, amenities, date } = req.query;

    let andConditions = [];

    /* 🔍 TEXT SEARCH */
    if (query) {
      andConditions.push({
        $or: [
          { name: { $regex: query, $options: "i" } },
          { address: { $regex: query, $options: "i" } },
          { description: { $regex: query, $options: "i" } }
        ]
      });
    }

    /* 💰 PRICE FILTER */
    if (minPrice || maxPrice) {
      let priceFilter = {};
      if (minPrice) priceFilter.$gte = Number(minPrice);
      if (maxPrice) priceFilter.$lte = Number(maxPrice);

      andConditions.push({
        pricePerHour: priceFilter
      });
    }

    /* 🏊 AMENITIES FILTER */
    if (amenities) {
      const amenityList = amenities.split(",");
      andConditions.push({
        amenities: { $all: amenityList }
      });
    }

    /* 📅 DATE AVAILABILITY FILTER */
    if (date) {
      const selectedDate = new Date(date);
      if (isNaN(selectedDate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format"
        });
      }

      const nextDay = new Date(selectedDate);
      nextDay.setDate(nextDay.getDate() + 1);

      andConditions.push({
        bookedSlots: {
          $not: {
            $elemMatch: {
              checkIn: { $lt: nextDay },
              checkOut: { $gt: selectedDate }
            }
          }
        }
      });
    }

    // Final filter
    const filter =
      andConditions.length > 0 ? { $and: andConditions } : {};

    const farmhouses = await Farmhouse.find(filter).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: farmhouses.length,
      farmhouses
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};


export const filterFarmhouses = async (req, res) => {
  try {
    const {
      search,
      minPrice,
      maxPrice,
      amenities,
      date,
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      order = "desc"
    } = req.query;

    let filter = {};

    /* 🔍 SEARCH */
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { address: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
    }

    /* 💰 PRICE FILTER */
    if (minPrice || maxPrice) {
      filter.pricePerHour = {};
      if (minPrice) filter.pricePerHour.$gte = Number(minPrice);
      if (maxPrice) filter.pricePerHour.$lte = Number(maxPrice);
    }

    /* 🏊 AMENITIES FILTER */
    if (amenities) {
      const amenitiesArray = amenities.split(",");
      filter.amenities = { $all: amenitiesArray };
    }

    /* 📅 DATE AVAILABILITY FILTER */
    if (date) {
      const selectedDate = new Date(date);
      const nextDay = new Date(selectedDate);
      nextDay.setDate(nextDay.getDate() + 1);

      filter.bookedSlots = {
        $not: {
          $elemMatch: {
            checkIn: { $lt: nextDay },
            checkOut: { $gt: selectedDate }
          }
        }
      };
    }

    /* 📊 SORT */
    const sortOrder = order === "asc" ? 1 : -1;

    const farmhouses = await Farmhouse.find(filter)
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Farmhouse.countDocuments(filter);

    res.json({
      success: true,
      total,
      page: Number(page),
      limit: Number(limit),
      farmhouses
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};


// ============================================
// DATE FILTER FOR FARMHOUSE AVAILABILITY
// ============================================
export const getFarmhousesByDate = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: "Date is required" });
    }

    const selectedDate = new Date(date);
    const nextDay = new Date(selectedDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const farmhouses = await Farmhouse.find({
      bookedSlots: {
        $not: {
          $elemMatch: {
            checkIn: { $lt: nextDay },
            checkOut: { $gt: selectedDate }
          }
        }
      }
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      count: farmhouses.length,
      date: selectedDate,
      farmhouses
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// ============================================
// GET NOTIFICATIONS
// ============================================
export const getNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      notifications: user.notifications.sort((a, b) => b.createdAt - a.createdAt)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// MARK NOTIFICATION AS READ
// ============================================
export const markNotificationAsRead = async (req, res) => {
  try {
    const { userId, notificationId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const notification = user.notifications.id(notificationId);
    if (!notification) return res.status(404).json({ message: "Notification not found" });

    notification.read = true;
    await user.save();

    res.json({
      success: true,
      message: "Notification marked as read"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============================================
// CLEAR ALL NOTIFICATIONS
// ============================================
export const clearAllNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.notifications = [];
    await user.save();

    res.json({
      success: true,
      message: "All notifications cleared"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};