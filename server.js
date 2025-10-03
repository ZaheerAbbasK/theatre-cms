require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();
const PORT = process.env.PORT || 5000;

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const theatre = req.params.theatre; // birthday, couple, private
    return {
      folder: `theatres/${theatre}`,
      public_id: "default",
      resource_type: "image",
      overwrite: true,
    };
  },
});
const upload = multer({ storage });

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public")); // serve static files like HTML, CSS

// Upload endpoint
app.post("/upload/:theatre", upload.single("image"), async (req, res) => {
  const pin = req.body.pin;
  if (pin !== process.env.ADMINPIN) return res.status(401).json({ message: "Invalid PIN!" });
  if (!req.file) return res.status(400).json({ message: "No file uploaded!" });

  res.json({ message: "Upload successful!", url: req.file.path });
});

// Helper: fetch latest image URL from Cloudinary
async function getLatestImageUrl(folder) {
  try {
    const result = await cloudinary.search
      .expression(`folder:theatres/${folder}`)
      .sort_by("uploaded_at", "desc")
      .max_results(1)
      .execute();

    if (result.resources.length === 0)
      return "https://via.placeholder.com/400x300?text=No+Image";

    const file = result.resources[0];
    return cloudinary.url(file.public_id + "." + file.format, { width: 400, height: 300, crop: "fill", secure: true });
  } catch (err) {
    console.error(err);
    return "https://via.placeholder.com/400x300?text=Error";
  }
}

// API endpoint to fetch current images
app.get("/api/images", async (req, res) => {
  const images = {
    birthday: await getLatestImageUrl("birthday"),
    couple: await getLatestImageUrl("couple"),
    private: await getLatestImageUrl("private"),
  };
  res.json(images);
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
