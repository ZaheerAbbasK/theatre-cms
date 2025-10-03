require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

// Cloudinary config from .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Serve static files (admin.html, css, js, etc.)
app.use(express.static(path.join(__dirname)));

// Multer storage with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const theatre = req.params.theatre; // e.g., "birthday"
    return {
      folder: "theatres",
      public_id: theatre, // overwrite same theatre image each time
      resource_type: "image",
    };
  },
});

const upload = multer({ storage });

// Upload route
app.post("/upload/:theatre", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }
  res.json({
    message: "Upload successful",
    url: req.file.path,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`👉 Open http://localhost:${PORT}/admin.html to test`);
});
