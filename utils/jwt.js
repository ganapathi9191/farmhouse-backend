import jwt from "jsonwebtoken";

export const generateToken = (data, expiresIn = "10m") => {
  return jwt.sign(data, process.env.JWT_SECRET, { expiresIn });
};

export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};