import { User, Banner } from "../models/User.js";
import bcrypt from "bcryptjs";
import { generateToken, verifyToken } from "../utils/jwt.js";
import cloudinary from "../config/cloudinary.js";
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();


export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, phoneNumber, password, confirmPassword } = req.body;

    if (!firstName || !lastName || !email || !phoneNumber || !password || !confirmPassword)
      return res.status(400).json({ message: "All fields required" });

    if (password !== confirmPassword)
      return res.status(400).json({ message: "Passwords do not match" });

    const exists = await User.findOne({ phoneNumber });
    if (exists)
      return res.status(400).json({ message: "Phone number already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      email,
      phoneNumber,
      password: hashedPassword
    });

    const otp = "1234";

    const token = generateToken(
      { id: user._id, phoneNumber, otp, type: "register" },
      "10m"
    );

    res.json({
      success: true,
      message: "Registration successful. OTP sent!",
      otp,
      token,
      user
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// -----------------------------
// VERIFY OTP (REGISTER / LOGIN / FORGOT)
// -----------------------------
export const verifyOtp = async (req, res) => {
  try {
    const { token, otp } = req.body;

    if (!token || !otp)
      return res.status(400).json({ message: "Token & OTP required" });

    const decoded = verifyToken(token);

    if (decoded.otp !== otp)
      return res.status(400).json({ message: "Invalid OTP" });

    // CASE 1: Registration / Login → final auth token
    if (decoded.type === "register" || decoded.type === "login") {
      const finalToken = generateToken(
        { id: decoded.id, phoneNumber: decoded.phoneNumber },
        "7d"
      );

      return res.json({
        success: true,
        message: "OTP Verified Successfully",
        token: finalToken
      });
    }

    // CASE 2: Forgot password → return reset-password token
    if (decoded.type === "forgot") {
      const resetToken = generateToken(
        { phoneNumber: decoded.phoneNumber, type: "reset" },
        "15m"
      );

      return res.json({
        success: true,
        message: "OTP Verified. You may now reset your password.",
        token: resetToken
      });
    }

    res.status(400).json({ message: "Invalid OTP flow" });

  } catch (err) {
    res.status(500).json({ message: "Invalid or expired token" });
  }
};


// -----------------------------
// LOGIN
// -----------------------------
export const login = async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user)
      return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: "Invalid password" });

    const otp = "1234";

    const otpToken = generateToken(
      { id: user._id, phoneNumber, otp, type: "login" },
      "10m"
    );

    res.json({
      success: true,
      message: "Login successful. OTP sent!",
      otp,
      token: otpToken,
      user
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// -----------------------------
// FORGOT PASSWORD
// -----------------------------
export const forgotPassword = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user)
      return res.status(400).json({ message: "Phone number not registered" });

    const otp = "1234";

    const otpToken = generateToken(
      { phoneNumber, otp, type: "forgot" },
      "10m"
    );

    res.json({
      success: true,
      message: "OTP sent for password reset",
      otp,
      token: otpToken
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// -----------------------------
// RESET PASSWORD
// -----------------------------
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmNewPassword } = req.body;

    if (newPassword !== confirmNewPassword)
      return res.status(400).json({ message: "Passwords do not match" });

    const decoded = verifyToken(token);

    if (decoded.type !== "reset")
      return res.status(400).json({ message: "Invalid reset token" });

    const hashed = await bcrypt.hash(newPassword, 10);

    await User.findOneAndUpdate(
      { phoneNumber: decoded.phoneNumber },
      { password: hashed }
    );

    res.json({
      success: true,
      message: "Password reset successful"
    });

  } catch (err) {
    res.status(500).json({ message: "Invalid or expired token" });
  }
};


// ------------------------
// UPDATE PROFILE
// ------------------------
export const updateProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    
    console.log("📝 Update Profile Request:");
    console.log("UserID:", userId);
    console.log("Body:", req.body);
    console.log("File:", req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : "No file");

    // Validate userId
    if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    const { fullName, username, gender } = req.body;

    if (!fullName) {
      return res.status(400).json({ message: "Full Name is required" });
    }

    // Split full name
    const nameParts = fullName.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "";

    let updateData = {
      fullName,
      firstName,
      lastName,
    };

    if (username) updateData.username = username;
    if (gender) updateData.gender = gender;

    // Handle image upload to Cloudinary
    if (req.file) {
      try {
        console.log("☁️ Uploading to Cloudinary...");
        console.log("Environment check:", {
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET ? "present" : "missing"
        });

        // Re-configure cloudinary to ensure credentials are set
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
          secure: true
        });

        const uploadedImage = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: "profile_images",
              resource_type: "auto",
              transformation: [
                { width: 500, height: 500, crop: "limit" }
              ]
            },
            (error, result) => {
              if (error) {
                console.error("❌ Cloudinary error:", error);
                reject(error);
              } else {
                console.log("✅ Cloudinary success:", result.secure_url);
                resolve(result);
              }
            }
          );

          uploadStream.end(req.file.buffer);
        });

        updateData.profileImage = uploadedImage.secure_url;

      } catch (uploadError) {
        console.error("❌ Upload error:", uploadError);
        return res.status(500).json({
          message: "Image upload failed",
          error: uploadError.message,
          details: uploadError.http_code ? `Cloudinary error ${uploadError.http_code}` : "Unknown error"
        });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      {
        new: true,
        runValidators: true
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      profile: updatedUser,
    });

  } catch (err) {
    console.error("❌ Update profile error:", err);
    res.status(500).json({
      message: "Error updating profile",
      error: err.message
    });
  }
};

// ------------------------
// GET PROFILE
// ------------------------
export const getProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      profile: user,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ------------------------
// DELETE PROFILE IMAGE
// ------------------------
export const deleteProfileImage = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user || !user.profileImage)
      return res.status(404).json({ message: "No image found" });

    const publicId = user.profileImage.split("/").pop().split(".")[0];

    await cloudinary.uploader.destroy(`profile_images/${publicId}`);

    user.profileImage = null;
    await user.save();

    res.json({
      success: true,
      message: "Profile image deleted successfully",
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ------------------------
// DELETE ACCOUNT
// ------------------------
// export const deleteUserAccount = async (req, res) => {
//    try {
//     const { userId } = req.params;

//     await User.findByIdAndDelete(userId);

//     res.json({
//       success: true,
//       message: "Account deleted successfully",
//     });

//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// };


// ------------------------
// GET ALL USERS
// ------------------------
export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select("-password") // exclude password for security
      .sort({ createdAt: -1 }); // latest users first

    res.json({
      success: true,
      count: users.length,
      users,
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: err.message,
    });
  }
};

// ------------------------
// GET USER BY ID
// ------------------------
export const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate user ID format
    if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        message: "Invalid user ID format" 
      });
    }

    const user = await User.findById(userId)
      .select('-password -deleteToken -deleteTokenExpiration'); // Exclude sensitive fields

    if (!user) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }

    res.json({
      success: true,
      user: user
    });

  } catch (err) {
    console.error("❌ Get user by ID error:", err);
    res.status(500).json({ 
      message: "Error fetching user",
      error: err.message 
    });
  }
};

// ------------------------
// DELETE USER BY ID (SIMPLE)
// ------------------------
export const deleteUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Basic validation
    if (!userId) {
      return res.status(400).json({ 
        message: "User ID is required" 
      });
    }

    // Find and delete user
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
      userId: userId
    });

  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ 
      message: "Error deleting user",
      error: err.message 
    });
  }
};

// ------------------------------------------------------------
// UPLOAD MULTIPLE IMAGES (CREATE BANNER)
// ------------------------------------------------------------
export const createBanner = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "At least 1 image required" });
    }

    const urls = [];

    for (const file of req.files) {
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "banner_images",
            resource_type: "auto"
          },
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
        stream.end(file.buffer);
      });

      urls.push(uploaded.secure_url);
    }

    const banner = await Banner.create({ images: urls });

    res.json({
      success: true,
      message: "Banner created successfully",
      banner
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// ------------------------------------------------------------
// GET ALL BANNERS
// ------------------------------------------------------------
export const getAllBanners = async (req, res) => {
  try {
    const banners = await Banner.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      banners
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// ------------------------------------------------------------
// GET SINGLE BANNER
// ------------------------------------------------------------
export const getBanner = async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.bannerId);

    if (!banner) return res.status(404).json({ message: "Banner not found" });

    res.json({
      success: true,
      banner
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// ------------------------------------------------------------
// UPDATE BANNER (REPLACE ALL IMAGES)
// ------------------------------------------------------------
export const updateBanner = async (req, res) => {
  try {
    const { bannerId } = req.params;

    const banner = await Banner.findById(bannerId);
    if (!banner) return res.status(404).json({ message: "Banner not found" });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "Images are required" });
    }

    // Delete existing images from Cloudinary
    for (const img of banner.images) {
      const publicId = img.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(`banner_images/${publicId}`);
    }

    // Upload new images
    const newUrls = [];
    for (const file of req.files) {
      const uploaded = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "banner_images",
            resource_type: "auto"
          },
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
        stream.end(file.buffer);
      });

      newUrls.push(uploaded.secure_url);
    }

    banner.images = newUrls;
    await banner.save();

    res.json({
      success: true,
      message: "Banner updated successfully",
      banner
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// ------------------------------------------------------------
// DELETE BANNER + CLOUDINARY IMAGES
// ------------------------------------------------------------
export const deleteBanner = async (req, res) => {
  try {
    const { bannerId } = req.params;

    const banner = await Banner.findById(bannerId);

    if (!banner) return res.status(404).json({ message: "Banner not found" });

    // Delete images from Cloudinary
    for (const img of banner.images) {
      const publicId = img.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(`banner_images/${publicId}`);
    }

    await Banner.findByIdAndDelete(bannerId);

    res.json({
      success: true,
      message: "Banner deleted successfully"
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


//live location

export const saveLiveLocation = async (req, res) => {
  try {
    const { userId } = req.params;
    const { lat, lng } = req.body;

    if (!lat || !lng)
      return res.status(400).json({ message: "Lat & Lng required" });

    const user = await User.findByIdAndUpdate(
      userId,
      {
        liveLocation: {
          type: "Point",
          coordinates: [lng, lat]
        }
      },
      { new: true }
    );

    if (!user)
      return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      message: "Live location saved successfully",
      liveLocation: user.liveLocation
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getLiveLocation = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);

    if (!user)
      return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      liveLocation: user.liveLocation
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteLiveLocation = async (req, res) => {
  try {
    const { userId } = req.params;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        liveLocation: {
          type: "Point",
          coordinates: [0.0, 0.0]
        }
      },
      { new: true }
    );

    if (!updatedUser)
      return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      message: "Live location deleted",
      liveLocation: updatedUser.liveLocation
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const addAddress = async (req, res) => {
  try {
    const { userId } = req.params;

    const {
      street, city, state, country,
      postalCode, addressType, lat, lng
    } = req.body;

    if (!street || !city || !state || !country || !postalCode)
      return res.status(400).json({ message: "All fields required" });

    const fullAddress =
      `${street}, ${city}, ${state}, ${postalCode}, ${country}`;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          addresses: {
            street, city, state, country,
            postalCode, addressType, lat, lng, fullAddress
          }
        }
      },
      { new: true }
    );

    res.json({
      success: true,
      message: "Address added successfully",
      addresses: user.addresses
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllAddresses = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ message: "User not found" });

    res.json({
      success: true,
      addresses: user.addresses
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


export const updateAddress = async (req, res) => {
  try {
    const { userId, addressIndex } = req.params;
    const data = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Auto update fullAddress if any part updated
    if (
      data.street || data.city || data.state ||
      data.country || data.postalCode
    ) {
      data.fullAddress =
        `${data.street || user.addresses[addressIndex].street}, 
         ${data.city || user.addresses[addressIndex].city}, 
         ${data.state || user.addresses[addressIndex].state}, 
         ${data.postalCode || user.addresses[addressIndex].postalCode}, 
         ${data.country || user.addresses[addressIndex].country}`.replace(/\s+/g, " ");
    }

    user.addresses[addressIndex] = {
      ...user.addresses[addressIndex],
      ...data
    };

    await user.save();

    res.json({
      success: true,
      message: "Address updated",
      addresses: user.addresses
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const deleteAddress = async (req, res) => {
  try {
    const { userId, addressIndex } = req.params;

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ message: "User not found" });

    user.addresses.splice(addressIndex, 1);
    await user.save();

    res.json({
      success: true,
      message: "Address deleted",
      addresses: user.addresses
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};



// export const deleteUserAccount = async (req, res) => {
//   try {
//     const { userId } = req.params;

//     // Check user exists
//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     // Delete all forms submitted by this user
//     await Form.deleteMany({ student: userId });

//     // Delete user
//     await User.findByIdAndDelete(userId);

//     return res.status(200).json({
//       message: 'Account deleted successfully'
//     });
//   } catch (error) {
//     console.error('Error deleting account:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

// ------------------------
// DELETE ACCOUNT WITHOUT CONFIRMATION (DIRECT DELETE)
// ------------------------
export const deleteUserAccount = async (req, res) => {
  try {
    const { userId } = req.params;

    // Basic validation
    if (!userId) {
      return res.status(400).json({ 
        message: "User ID is required" 
      });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        message: "User not found" 
      });
    }

    // Delete user
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: "Account deleted successfully"
    });

  } catch (err) {
    console.error("Delete account error:", err);
    res.status(500).json({ 
      message: "Error deleting account",
      error: err.message 
    });
  }
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "pms226803@gmail.com",
    pass: "nrasbifqxsxzurrm",
  },
});



// ------------------------
// NOTIFICATIONS FEATURES
// ------------------------
export const getNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      notifications: user.notifications
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


export const markNotificationAsRead = async (req, res) => {
  try {
    const { userId, notificationId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const notification = user.notifications.id(notificationId);
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

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

export const clearNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

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

// ------------------------
// CREATE NOTIFICATION (INTERNAL USE)
// ------------------------
export const createNotification = async (userId, message, type = "info") => {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    user.notifications.push({
      message,
      type,
      read: false
    });

    await user.save();
  } catch (err) {
    console.error("Error creating notification:", err);
  }
};

// ------------------------
// RATINGS FEATURES
// ------------------------
export const submitRating = async (req, res) => {
  try {
    const { userId } = req.params;
    const { farmhouseId, rating, review } = req.body;

    if (!farmhouseId || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        message: "Valid farmhouse ID and rating (1-5) are required"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user has already rated this farmhouse
    const existingRating = user.ratingsGiven.find(
      r => r.farmhouseId.toString() === farmhouseId
    );

    if (existingRating) {
      // Update existing rating
      existingRating.rating = rating;
      existingRating.review = review || existingRating.review;
    } else {
      // Add new rating
      user.ratingsGiven.push({
        farmhouseId,
        rating,
        review: review || ""
      });
    }

    await user.save();

    res.json({
      success: true,
      message: "Rating submitted successfully",
      ratingsGiven: user.ratingsGiven
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getUserRatings = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).populate({
      path: 'ratingsGiven.farmhouseId',
      select: 'name images address'
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // KEEPING YOUR SAME RESPONSE
    res.json({
      success: true,
      ratingsGiven: user.ratingsGiven
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};





export const deleteAccount = async (req, res) => {
  const { email, reason } = req.body;

  if (!email || !reason) {
    return res.status(400).json({
      message: "Email and deletion reason are required",
    });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // Generate token
    const token = crypto.randomBytes(20).toString("hex");
    const deleteLink = `${process.env.BASE_URL}/confirm-delete-account/${token}`;

    // Save token & expiry
    user.deleteToken = token;
    user.deleteTokenExpiration = Date.now() + 60 * 60 * 1000;
    await user.save();

    // Send email
    const mailOptions = {
      from: "pms226803@gmail.com",
      to: email,
      subject: "Confirm Account Deletion",
      text: `Hi ${user.fullName || "User"},

We received your account deletion request.

To confirm deletion, click the link below:
${deleteLink}

Reason:
${reason}

If you did not request this, please ignore this email.

Regards,
Your Team`,
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      message: "Account deletion link sent successfully. Please check your email.",
    });

  } catch (error) {
    console.error("Delete user request error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};



export const confirmDeleteAccount = async (req, res) => {
  const { token } = req.params;

  try {
    const user = await User.findOne({
      deleteToken: token,
      deleteTokenExpiration: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(404).json({ message: "Invalid or expired token" });
    }

    // Optional: delete user's forms also
    // await Form.deleteMany({ student: user._id });

    await User.findByIdAndDelete(user._id);

    return res.status(200).json({
      message: "Your account has been deleted successfully",
    });

  } catch (error) {
    console.error("Confirm delete user error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// ------------------------
// ADMIN UPDATE USER
// ------------------------
export const adminUpdateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log("📝 Admin Update User Request:");
    console.log("UserID:", userId);
    console.log("Body:", req.body);

    // Validate userId
    if (!userId || !userId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false,
        message: "Invalid user ID format" 
      });
    }

    const { firstName, lastName, email, phoneNumber, gender, username } = req.body;

    // Build update data
    let updateData = {};

    // Update name fields if provided
    if (firstName || lastName) {
      const currentUser = await User.findById(userId);
      if (!currentUser) {
        return res.status(404).json({ 
          success: false,
          message: "User not found" 
        });
      }

      const newFirstName = firstName || currentUser.firstName;
      const newLastName = lastName || currentUser.lastName;
      
      updateData.firstName = newFirstName;
      updateData.lastName = newLastName;
      updateData.fullName = `${newFirstName} ${newLastName}`.trim();
    }

    // Add other fields if provided
    if (email) updateData.email = email;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (gender) updateData.gender = gender;
    if (username !== undefined) updateData.username = username;

    // Check if phone number is already taken by another user
    if (phoneNumber) {
      const existingUser = await User.findOne({ 
        phoneNumber, 
        _id: { $ne: userId } 
      });
      if (existingUser) {
        return res.status(400).json({ 
          success: false,
          message: "Phone number already registered by another user" 
        });
      }
    }

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await User.findOne({ 
        email, 
        _id: { $ne: userId } 
      });
      if (existingUser) {
        return res.status(400).json({ 
          success: false,
          message: "Email already registered by another user" 
        });
      }
    }

    // Update the user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      {
        new: true,
        runValidators: true,
        select: '-password -deleteToken -deleteTokenExpiration' // Exclude sensitive fields
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false,
        message: "User not found" 
      });
    }

    // Create notification for the user about profile update
    await createNotification(
      userId,
      "Your profile was updated by an administrator",
      "info"
    );

    res.json({
      success: true,
      message: "User updated successfully by admin",
      user: updatedUser
    });

  } catch (err) {
    console.error("❌ Admin update user error:", err);
    
    // Handle validation errors
    if (err.name === 'ValidationError') {
      const errors = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ 
        success: false,
        message: "Validation error",
        errors: errors 
      });
    }

    res.status(500).json({ 
      success: false,
      message: "Error updating user",
      error: err.message 
    });
  }
};