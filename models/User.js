import mongoose from "mongoose";

const addressSchema = new mongoose.Schema({
  street: { type: String, required: true },
  city: { type: String, required: true },
  state: { type: String, required: true },
  country: { type: String, required: true, default: "India" },
  pinCode: { type: String, required: true, match: /^[0-9]{6}$/ }, // 6-digit Indian pin code
  addressType: { 
    type: String, 
    enum: ["home", "work", "other"], 
    default: "home" 
  },
  lat: Number,
  lng: Number,
  fullAddress: String,
  landmark: String, // Optional landmark
  isDefault: { type: Boolean, default: false }
}, { _id: true });

const notificationSchema = new mongoose.Schema({
  title: String,
  message: String,
  type: { 
    type: String, 
    enum: ["booking", "payment", "cancellation", "general", "promotion"],
    default: "general"
  },
  read: { type: Boolean, default: false },
  relatedId: mongoose.Schema.Types.ObjectId, // Reference to booking/order
  createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  fullName: String,
  username: String,
  gender: { type: String, enum: ["male", "female", "other"], default: "other" },

    deleteToken: {
    type: String,
  },
  deleteTokenExpiration: {
    type: Date,
  },

  email: { type: String, unique: true },
  phoneNumber: { type: String, unique: true },
  profileImage: String,
  password: String,
  
  liveLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number],
      default: [0.0, 0.0]
    }
  },
  
  addresses: [addressSchema],
  notifications: [notificationSchema],
  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: "Farmhouse" }]
}, { timestamps: true });

userSchema.index({ liveLocation: "2dsphere" });

const bannerSchema = new mongoose.Schema({
  images: [String],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model("User", userSchema);
export const Banner = mongoose.model("Banner", bannerSchema);