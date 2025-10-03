require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Serve static files (admin.html, css, js)
app.use(express.static(path.join(__dirname)));

// Parse form-data (for PIN)
app.use(express.urlencoded({ extended: true }));

// Multer storage with Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const theatre = req.params.theatre; // birthday, couple, main
    return {
      folder: "theatres",
      public_id: theatre, // overwrite existing image
      resource_type: "image",
    };
  },
});

const upload = multer({ storage });

// Upload route with PIN check
app.post("/upload/:theatre", upload.single("image"), (req, res) => {
  const pin = req.body.pin;
  const validPin = process.env.ADMINPIN; // 5-digit PIN from .env

  if (pin !== validPin) {
    return res.status(401).json({ message: "Invalid PIN!" });
  }

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded!" });
  }

  res.json({
    message: "Upload successful!",
    url: req.file.path,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`👉 Open http://localhost:${PORT}/admin.html to test`);
});
