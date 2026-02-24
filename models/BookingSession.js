// models/BookingSession.js
import mongoose from "mongoose";

const bookingSessionSchema = new mongoose.Schema({
  sessionId: { 
    type: String, 
    required: true, 
    unique: true 
  },
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
  slotId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true 
  },
  date: { 
    type: Date, 
    required: true 
  },
  label: { 
    type: String, 
    required: true 
  },
  timing: { 
    type: String, 
    required: true 
  },
  price: { 
    type: Number, 
    required: true 
  },
  expiresAt: { 
    type: Date, 
    required: true,
    index: { expires: '30m' } // Auto delete after 30 minutes
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

export const BookingSession = mongoose.model("BookingSession", bookingSessionSchema);