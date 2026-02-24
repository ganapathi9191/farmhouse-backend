import mongoose from "mongoose";

/* SLOT DEFINITIONS */
const timePriceSchema = new mongoose.Schema({
  label: String,
  timing: String, // "9am - 8pm"
  price: Number,
  inactiveDates: [{  // Add this array to track dates when this slot is inactive
    date: { type: Date, required: true },
    reason: String,
    createdAt: { type: Date, default: Date.now }
  }],
  isActive: { type: Boolean, default: true } // Overall active status for this slot
});


/* BOOKED SLOTS */
const bookedSlotSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User",
    required: true 
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking"
  },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
    date: { type: Date }, // ✅ ADD THIS FIELD
  label: { type: String, required: true },
  timing: { type: String, required: true },
  bookedAt: { type: Date, default: Date.now }
});

/* INACTIVE DATES */
const inactiveDateSchema = new mongoose.Schema({
  date: { type: Date, required: true }, // Specific date when farmhouse is inactive
  reason: String, // Optional reason for being inactive
  createdAt: { type: Date, default: Date.now }
});

/* REVIEWS */
const reviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name: String,
  image: String,
  rating: { type: Number, min: 1, max: 5 },
  content: String,
  createdAt: { type: Date, default: Date.now }
});

/* FARMHOUSE SCHEMA */
const farmhouseSchema = new mongoose.Schema({
  name: { type: String, required: true },
  images: [String],
  address: String,
  description: String,
  amenities: [String],
  bookingFor: String,

  pricePerHour: Number,
  pricePerDay: Number,

  timePrices: [timePriceSchema], // Available slots
  
  bookedSlots: [bookedSlotSchema], // Booked slots
  
  reviews: { type: [reviewSchema], default: [] },
  inactiveDates: [inactiveDateSchema],

  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: [0.0, 0.0] }
  },

  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

  rating: { type: Number, default: 0 },
  feedbackSummary: String,
  active: { type: Boolean, default: true }, // Overall active status

  createdAt: { type: Date, default: Date.now }
});

farmhouseSchema.index({ location: "2dsphere" });

export const Farmhouse = mongoose.model("Farmhouse", farmhouseSchema);