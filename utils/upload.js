import multer from "multer";

const storage = multer.memoryStorage(); // BUFFER

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

export default upload;
