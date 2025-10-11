const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());
const path = require("path");

const WORKER_URL = 'https://beanoshubordersheet.zaheerkundgol29.workers.dev';

// JWT Secret Keys (ensure these are in .env)
const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_TOKEN_SECRET || "your_access_token_secret";
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_TOKEN_SECRET || "your_refresh_token_secret";

// Store refresh tokens in memory (in production, use a database)
let refreshTokens = [];

// Middleware to verify access token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>
  if (!token) return res.status(401).json({ success: false, error: 'Access token required' });

  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Invalid or expired access token' });
    req.user = user;
    next();
  });
}

// --------------------------------------------------------------------
// ✅ SECURE ROUTE: Cloudflare Worker Proxy
// --------------------------------------------------------------------
app.post('/api/proxy-worker', authenticateToken, async (req, res) => {
  const { endpoint, method, body, secretLevel } = req.body;

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
    console.error(`ERROR: Secret for level '${secretLevel}' not found.`);
    return res.status(500).json({ success: false, error: 'Server configuration error: Missing required secret.' });
  }

  const fullWorkerUrl = `${WORKER_URL}${endpoint}`;

  const fetchOptions = {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Secret': appSecret
    }
  };

  if (method !== 'GET' && body) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const workerResponse = await fetch(fullWorkerUrl, fetchOptions);
    const workerData = await workerResponse.json();
    res.status(workerResponse.status).json(workerData);
  } catch (error) {
    console.error('Worker Proxy Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error forwarding request.' });
  }
});

// Function to securely URL-encode parameters
function urlEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// ✅ NEW ROUTE: Fetch UPI recipient details (VPA and name)
app.get('/api/upi-details', (req, res) => {
  res.json({
    vpa: 'BHARATPE2S0K0E0M3O64927@unitype',
    name: 'Mr RAJU Y BASAPUR'
  });
});

// ✅ NEW ROUTE FOR UPI REDIRECT
app.get('/api/pay-upi', (req, res) => {
  const bookingId = req.query.bookingId || 'NO_BOOKING_ID';
  const amount = parseFloat(req.query.amount).toFixed(2) || '0.00';
  const uniqueOrderId = `BOOKING-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const payeeVPA = 'BHARATPE2S0K0E0M3O64927@unitype';
  const payeeName = 'Mr RAJU Y BASAPUR';
  const transactionNote = `Payment for ${bookingId}`;

  const upiLink = `upi://pay?` +
    `pa=${urlEncode(payeeVPA)}` +
    `&pn=${urlEncode(payeeName)}` +
    `&am=${amount}` +
    `&cu=INR` +
    `&tn=${urlEncode(transactionNote)}` +
    `&tr=${urlEncode(uniqueOrderId)}`;

  res.redirect(302, upiLink);
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

// Auth route to issue JWT tokens
app.post("/api/auth", async (req, res) => {
  const { pin } = req.body;

  if (pin !== process.env.ADMINPIN) {
    return res.status(401).json({
      success: false,
      message: "Invalid PIN"
    });
  }

  // Generate tokens
  const user = { role: 'admin' };
  const accessToken = jwt.sign(user, ACCESS_TOKEN_SECRET, { expiresIn: '30m' });
  const refreshToken = jwt.sign(user, REFRESH_TOKEN_SECRET, { expiresIn: '30d' });

  // Store refresh token
  refreshTokens.push(refreshToken);

  res.json({
    success: true,
    accessToken,
    refreshToken
  });
});

// Refresh token endpoint
app.post("/api/refresh-token", (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken || !refreshTokens.includes(refreshToken)) {
    return res.status(403).json({ success: false, error: 'Invalid or expired refresh token' });
  }

  jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Invalid refresh token' });

    const accessToken = jwt.sign({ role: 'admin' }, ACCESS_TOKEN_SECRET, { expiresIn: '30m' });
    res.json({ success: true, accessToken });
  });
});

// Add a route to serve booking-admin.html
app.get("/booking-admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "booking-admin.html"));
});

const upload = multer();

// ✅ API route: Get latest theatre images
app.get("/api/images", authenticateToken, async (req, res) => {
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
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch images" });
  }
});

// ✅ API route: Upload theatre image (with JWT)
app.post("/upload/:theatre", authenticateToken, upload.single("image"), async (req, res) => {
  try {
    const theatre = req.params.theatre;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

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
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Upload failed" });
  }
});

// ✅ Export the app for Vercel serverless
module.exports = app;