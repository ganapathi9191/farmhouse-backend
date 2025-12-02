import express from "express";
import http from "http";
import mongoose from "mongoose";
import cors from "cors";   // ✅ ADD THIS IMPORT
import authRoutes from "./routes/authRoutes.js";
import farmhouse from "./routes/farmhouseRoutes.js"
import dotenv from "dotenv";
dotenv.config(); // MUST be first

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());  // ✅ Now cors is defined
app.use(express.json());


// Debug line
console.log("JWT_SECRET loaded:", process.env.JWT_SECRET ? "✅ Yes" : "❌ No");

//Route
app.use("/api/auth", authRoutes);
app.use("/api",farmhouse);

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected");
  })
  .catch((err) => console.error("Mongo Error:", err.message));

// Routes
app.get("/", (req, res) => {
  res.send("Server Running Successfully 🚀");
});

// Server
const PORT = process.env.PORT || 5124;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
