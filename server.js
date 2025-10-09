const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
const path = require("path");

c// In server.js (Ensure this constant is defined near the top)
const WORKER_URL = 'https://beanoshubordersheet.zaheerkundgol29.workers.dev'; 

// --------------------------------------------------------------------
// ✅ SECURE ROUTE: Cloudflare Worker Proxy
// --------------------------------------------------------------------
app.post('/api/proxy-worker', async (req, res) => {
    // 1. Get the target endpoint, method, body, and required secret level from the client
    // Client sends instructions: where to go (endpoint), what to do (method), and the required security level.
    const { endpoint, method, body, secretLevel } = req.body;
    
    // 2. Determine which secret to use from the server's environment variables
    let appSecret;
    switch (secretLevel) {
        case 'read':
            appSecret = process.env.DB_READ_SECRET;
            break;
        case 'write':
            appSecret = process.env.DB_WRITE_SECRET;
            break;
        case 'admin':
            appSecret = processs.env.DB_ADMIN_SECRET;
            break;
        default:
            return res.status(400).json({ success: false, error: 'Invalid secret level requested.' });
    }

    if (!appSecret) {
        // This fails if the server cannot read the secrets (e.g., .env file missing/bad deployment)
        console.error(`ERROR: Secret for level '${secretLevel}' not found.`);
        return res.status(500).json({ success: false, error: 'Server configuration error: Missing required secret.' });
    }
    
    // 3. Construct the full URL and request options
    const fullWorkerUrl = `${WORKER_URL}${endpoint}`;
    
    const fetchOptions = {
        method: method, 
        headers: {
            // Forward the Content-Type
            'Content-Type': 'application/json',
            // Inject the sensitive secret here, safely hidden from the browser
            'X-App-Secret': appSecret 
        }
    };
    
    // Only attach body payload for requests that require one (POST, PUT, etc.)
    if (method !== 'GET' && body) {
        fetchOptions.body = JSON.stringify(body);
    }
    
    try {
        // 4. Forward the request to the Cloudflare Worker
        const workerResponse = await fetch(fullWorkerUrl, fetchOptions);

        // 5. Send the Worker's response back to the client
        const workerData = await workerResponse.json();
        res.status(workerResponse.status).json(workerData);

    } catch (error) {
        console.error('Worker Proxy Error:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error forwarding request.' });
    }
});
// --------------------------------------------------------------------
// fallback: open admin.html when hitting /admin
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ✅ Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


app.post("/api/auth", (req, res) => {
  const { pin } = req.body;
  
  // Check if PIN matches environment variable
  if (pin === process.env.ADMINPIN) {
    // Return success with admin secret for API calls
    res.json({
      success: true,
      // ⚠️ Key Change: Send the DB_ADMIN_SECRET back for the client to use.
      adminSecret: process.env.DB_ADMIN_SECRET 
    });
  } else {
    res.json({
      success: false,
      message: "Invalid PIN"
    });
  }
});

// Add a route to serve booking-admin.html
app.get("/booking-admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "booking-admin.html"));
});

const upload = multer();

// ✅ API route: Get latest theatre images
app.get("/api/images", async (req, res) => {
  try {
    const folders = ["birthday", "couple", "private"];
    const urls = {};

    for (let folder of folders) {
      const result = await cloudinary.search
        .expression(`folder:theatres/${folder}`)
        .sort_by("uploaded_at", "desc")
        .max_results(1)
        .execute();

      urls[folder] =
        result.resources.length > 0
          ? result.resources[0].secure_url
          : `https://via.placeholder.com/600x400?text=${folder}`;
    }

    res.json(urls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch images" });
  }
});

// ✅ API route: Upload theatre image (with PIN)
app.post("/upload/:theatre", upload.single("image"), async (req, res) => {
  try {
    const theatre = req.params.theatre;
    const pin = req.body.pin;

    if (pin !== process.env.ADMINPIN) {
      return res.status(403).json({ message: "Invalid PIN" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Upload to Cloudinary in subfolder
    const result = await new Promise((resolve, reject) => {
      let cldUploadStream = cloudinary.uploader.upload_stream(
        { folder: `theatres/${theatre}`, overwrite: true, public_id: "default" },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
      streamifier.createReadStream(req.file.buffer).pipe(cldUploadStream);
    });

    res.json({ message: "Upload successful", url: result.secure_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// ✅ Export the app for Vercel serverless
module.exports = app;