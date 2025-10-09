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

const WORKER_URL = 'https://beanoshubordersheet.zaheerkundgol29.workers.dev';

// serve files from the "public" folder
app.use(express.static(path.join(__dirname, "public")));

app.post('/api/proxy-worker', async (req, res) => {
    // 1. Get the target endpoint and required secret level from the client request body
    const { endpoint, method, body, secretLevel } = req.body;
    
    // 2. Determine which secret to use based on the required level
    let appSecret;
    switch (secretLevel) {
        case 'read':
            appSecret = process.env.DB_READ_SECRET;
            break;
        case 'write':
            appSecret = process.env.DB_WRITE_SECRET;
            break;
        case 'admin':
            appSecret = process.env.DB_ADMIN_SECRET;
            break;
        default:
            return res.status(400).json({ success: false, error: 'Invalid secret level requested.' });
    }

    if (!appSecret) {
        console.error(`ERROR: Secret for level '${secretLevel}' not found in environment variables.`);
        return res.status(500).json({ success: false, error: 'Server configuration error.' });
    }

    try {
        // 3. Forward the request to the Cloudflare Worker
        const workerResponse = await fetch(`${WORKER_URL}${endpoint}`, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                // 4. Attach the sensitive secret securely from the server's environment
                'X-App-Secret': appSecret 
            },
            // Include body for POST/PUT requests
            body: body ? JSON.stringify(body) : undefined 
        });

        // 5. Send the Worker's response back to the client
        const workerData = await workerResponse.json();
        res.status(workerResponse.status).json(workerData);

    } catch (error) {
        console.error('Worker Proxy Error:', error);
        res.status(500).json({ success: false, error: 'Internal Server Error forwarding request.' });
    }
});

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