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

// JWT Secret Keys
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "your_access_token_secret";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "your_refresh_token_secret";

// Store refresh tokens in memory (use a database like Redis in production)
let refreshTokens = [];

// Middleware to verify JWT access token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired access token' });
    }
    req.user = user;
    next();
  });
};

// Cloudflare Worker Proxy
app.post('/api/proxy-worker', async (req, res) => {
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

// URL encode utility
function urlEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// Fetch UPI recipient details
app.get('/api/upi-details', (req, res) => {
  res.json({
    vpa: 'BHARATPE2S0K0E0M3O64927@unitype',
    name: 'Mr RAJU Y BASAPUR'
  });
});

// UPI redirect
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

  console.log(`Redirecting to: ${upiLink}`);
  res.redirect(302, upiLink);
});

// Serve admin panel
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "booking-admin.html"));
});

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Auth route
app.post("/api/auth", (req, res) => {
  const { pin } = req.body;

  if (pin === process.env.ADMINPIN) {
    const accessToken = jwt.sign({ role: 'admin' }, ACCESS_TOKEN_SECRET, { expiresIn: '30m' });
    const refreshToken = jwt.sign({ role: 'admin' }, REFRESH_TOKEN_SECRET, { expiresIn: '30d' });
    refreshTokens.push(refreshToken);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      adminSecret: process.env.DB_ADMIN_SECRET
    });
  } else {
    res.status(401).json({
      success: false,
      message: "Invalid PIN"
    });
  }
});

// Refresh access token
app.post("/api/refresh-token", (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken || !refreshTokens.includes(refreshToken)) {
    return res.status(403).json({ success: false, error: 'Invalid or expired refresh token' });
  }

  jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired refresh token' });
    }
    const newAccessToken = jwt.sign({ role: 'admin' }, ACCESS_TOKEN_SECRET, { expiresIn: '30m' });
    res.json({ success: true, accessToken: newAccessToken });
  });
});

const upload = multer();

// Get latest theatre images
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
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch images" });
  }
});

// Upload theatre image
app.post("/upload/:theatre", verifyToken, upload.single("image"), async (req, res) => {
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

// Export for Vercel
module.exports = app;