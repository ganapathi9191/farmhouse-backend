import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  fullName: String,      // auto combine
  username: String,
  gender: { type: String, enum: ["male", "female", "other"], default: "other" },

  email: { type: String, unique: true },       // from registration (cannot update)
  phoneNumber: { type: String, unique: true }, // login number (cannot update)

  profileImage: { type: String }, // cloudinary URL

  password: String,
});

export default mongoose.model("User", userSchema);
