const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const Razorpay = require('razorpay');
const crypto = require('crypto'); // <-- Already imported, which is good



const app = express();
app.use(cors());
app.use(express.json());
const path = require("path");

const WORKER_URL = 'https://beanoshubordersheet.zaheerkundgol29.workers.dev';

const API_KEY = process.env.API_KEY;

// JWT Secret Keys
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;


const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// --- HELPER: WORKER PROXY (FIXED) ---
async function callWorker(endpoint, method, secretLevel, body) {
    // 1. Select the correct secret
    let appSecret;
    switch (secretLevel) {
        case 'read': appSecret = process.env.DB_READ_SECRET; break;
        case 'write': appSecret = process.env.DB_WRITE_SECRET; break;
        case 'admin': appSecret = process.env.DB_ADMIN_SECRET; break;
        default: throw new Error(`Invalid secret level: ${secretLevel}`);
    }

    try {
        // 2. Fetch with CORRECT URL + Endpoint
        const response = await fetch(WORKER_URL + endpoint, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'X-App-Secret': appSecret
            },
            // 3. Send body DIRECTLY (Fixed the "Russian Doll" bug)
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Worker responded with ${response.status}: ${errorText}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Worker Call Failed:', error);
        throw error;
    }
}
// Store refresh tokens in memory (use a database like Redis in production)
let refreshTokens = [];

// --- NEW HELPER FUNCTION: ID REGENERATOR ---
function generateBookingId() {
  // Generates a random 10-character hex string for the ID.
  // We use `crypto.randomBytes(5)` to get 10 hex characters.
  const randomHex = crypto.randomBytes(5).toString('hex').toUpperCase();
  const part1 = randomHex.substring(0, 5);
  const part2 = randomHex.substring(5);
  // Matches the common BH-XXXXX-XXXXX format
  return `BH-${part1}-${part2}`;
}
// --- END NEW HELPER FUNCTION ---


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

app.post('/create-order', async (req, res) => {
  const { amount, bookingId } = req.body; // Amount in rupees, convert to paise
  try {
    const options = {
      amount: amount * 100, // Convert to paise
      currency: 'INR',
      receipt: bookingId || `receipt_${Date.now()}`
    };
    const order = await razorpay.orders.create(options);
    res.json({ success: true, order });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

// --- HELPER: SERVER-SIDE TELEGRAM NOTIFICATION ---
async function sendTelegramNotification(data) {
    const token = "8064961587:AAEecTCeZ6OZTKMLHSmnoItXe1NnI3djSCk";
    const chatId = 7458651817;

    if (!token || !chatId) {
        console.error("Telegram credentials missing.");
        return { success: false, error: "Credentials missing" };
    }

    // Format the message nicely
    const message = `
✅ *NEW PAYMENT RECEIVED*
--------------------------------
👤 *Customer:* ${data.customer_name || 'N/A'}
📱 *Phone:* ${data.customer_phone || 'N/A'}
📅 *Date:* ${data.event_date || 'N/A'}
⏰ *Time:* ${data.time_slot || 'N/A'}
🏛 *Venue:* ${data.venue_name || 'N/A'}
💰 *Amount:* ₹${data.grand_total || '0'}
💳 *Payment ID:* ${data.payment_id || 'N/A'}
📝 *Booking ID:* ${data.booking_id || 'N/A'}
--------------------------------
_System: Backend Auto-Alert_
    `;

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        const result = await response.json();
        if (!result.ok) {
            console.error("Telegram API Error:", result);
        } else {
            console.log("Telegram notification sent successfully.");
        }
        return result;
    } catch (error) {
        console.error("Failed to send Telegram message:", error);
        return { success: false, error: error.message };
    }
}

// Cloudflare Worker Proxy
app.post('/api/proxy-worker', async (req, res) => {

  // 1. Retrieve the allowed origins list and convert it to an array
  const allowedOriginString = process.env.ALLOWED_ORIGIN;
  const allowedOrigins = allowedOriginString ? allowedOriginString.split(',').map(s => s.trim()) : [];

  // 2. Get the origin from the request headers
  const requestOrigin = req.headers['origin'];

  // 3. Check if the incoming request origin is in the allowed list
  let isOriginAllowed = false;
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    isOriginAllowed = true;
  }

  // As a fallback, check the referer (less reliable, but good for some same-origin navigations)
  if (!isOriginAllowed) {
    const referer = req.headers['referer'];
    if (referer) {
      // Check if the referer starts with any of the allowed origins
      isOriginAllowed = allowedOrigins.some(origin => referer.startsWith(origin));
    }
  }

  if (!isOriginAllowed) {
    console.warn(`Blocked request from unauthorized origin: ${requestOrigin || req.headers['referer']}`);
    // Terminate the request with a Forbidden status
    return res.status(403).json({ success: false, error: 'Unauthorized origin' });
  }

  // The request is now authenticated and verified to come from an allowed domain.

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

app.get('/api/telegram-credentials', (req, res) => {
  // Retrieve the allowed origins list and convert it to an array
  const allowedOriginString = process.env.ALLOWED_ORIGIN;
  const allowedOrigins = allowedOriginString ? allowedOriginString.split(',').map(s => s.trim()) : [];

  // Get the origin from the request headers
  const requestOrigin = req.headers['origin'];
  

  // Check if the incoming request origin is in the allowed list
  let isOriginAllowed = false;
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    isOriginAllowed = true;
  }

  // As a fallback, check the referer
  if (!isOriginAllowed) {
    const referer = req.headers['referer'];
    if (referer) {
      isOriginAllowed = allowedOrigins.some(origin => referer.startsWith(origin));
    }
  }

  if (!isOriginAllowed) {
    console.warn(`Blocked Telegram credentials request from unauthorized origin: ${requestOrigin || req.headers['referer']}`);
    return res.status(403).json({ success: false, error: 'Unauthorized origin' });
  }

  // Return the credentials if origin is allowed
  if (!process.env.TELEGRAM_CHAT_ID || !process.env.TELEGRAM_BOT_TOKEN) {
    console.error('Missing Telegram configuration in environment variables');
    return res.status(500).json({ success: false, error: 'Server configuration error' });
  }

  res.json({
    success: true,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    TELEGRAM_ACCESS_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  });
});

// UPI redirect


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

// --- TEMPORARY TEST ROUTE ---
app.get('/test-db-save', async (req, res) => {
    // 1. Create Dummy Data
    const dummyBooking = {
        booking_id: "TEST-" + Math.floor(10000 + Math.random() * 90000),
        customer_name: "Test Robot",
        customer_phone: "9999999999",
        customer_email: "test@beanoshub.com",
        event_date: "01-01-2030", // Future date to avoid confusion
        time_slot: "10:00 AM - 11:00 AM",
        venue_name: "Debug Venue",
        venue_address: "123 Cloudflare St",
        venue_price: 100,
        addon_total: 0,
        cake_total: 0,
        grand_total: 100,
        status: "CONFIRMED"
    };

    try {
        // 2. Attempt to save using the FIXED callWorker function
        // We use 'write' permission, just like the real payment flow
        console.log("Attempting to save test booking:", dummyBooking.booking_id);
        
        const result = await callWorker('/booking/save-secure', 'POST', 'write', dummyBooking);
        
        // 3. Output the result
        res.json({
            status: "Test Execution Complete",
            worker_response: result,
            check_db: "If 'success' is true above, check your D1 database/AppSheet for this record."
        });
    } catch (error) {
        res.status(500).json({ 
            status: "Test Failed", 
            error: error.message,
            stack: error.stack 
        });
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

// Verify Payment and Save Booking
// --- ROUTE: VERIFY PAYMENT (UPDATED) ---
app.post('/verify-payment', async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            bookingData 
        } = req.body;

        // 1. Verify Signature
        const generated_signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');

        if (generated_signature !== razorpay_signature) {
            return res.status(400).json({ success: false, error: 'Invalid signature' });
        }

        console.log('Payment verified. Processing post-payment actions...');

        // 2. Enrich Booking Data
        if (bookingData) {
            bookingData.status = 'CONFIRMED';
            bookingData.payment_id = razorpay_payment_id;
        }

        // 3. PARALLEL EXECUTION: Save to DB & Send Telegram
        // We run them together so one slow process doesn't block the other
        const [workerResponse, telegramResponse] = await Promise.allSettled([
            callWorker('/booking/save-secure', 'POST', 'write', bookingData),
            sendTelegramNotification(bookingData)
        ]);

        // 4. Analyze Results
        const saveSuccess = workerResponse.status === 'fulfilled' && workerResponse.value.success;
        const telegramSuccess = telegramResponse.status === 'fulfilled' && telegramResponse.value.ok;

        if (!saveSuccess) {
            console.error("CRITICAL: DB Save Failed in Verify Payment", workerResponse.reason || workerResponse.value);
            // Optional: You could send a separate "URGENT FAILURE" telegram here if you wanted
        }

        // 5. Respond to Client
        // We return success=true because the PAYMENT worked. 
        // We include 'saved' status for debugging/logging on client if needed.
        return res.json({
            success: true,
            saved: saveSuccess,
            telegram_sent: telegramSuccess,
            message: "Payment verified"
        });

    } catch (error) {
        console.error('Verify Payment Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- ROUTE: TEST FULL FLOW (RUN THIS TO TEST) ---
app.get('/test-full-flow', async (req, res) => {
    const dummyData = {
        booking_id: "TEST-SYS-" + Math.floor(Math.random() * 10000),
        customer_name: "System Tester",
        customer_phone: "0000000000",
        event_date: "01-01-2030",
        time_slot: "12:00 PM - 01:00 PM",
        venue_name: "Backend Test Venue",
        venue_price: 100,
        grand_total: 100,
        payment_id: "pay_test_" + Date.now(),
        status: "CONFIRMED"
    };

    console.log("Starting Full Flow Test...");

    try {
        // 1. Test Telegram
        console.log("1. Testing Telegram...");
        const telegramRes = await sendTelegramNotification(dummyData);

        // 2. Test DB Save
        console.log("2. Testing DB Save...");
        const dbRes = await callWorker('/booking/save-secure', 'POST', 'write', dummyData);

        res.json({
            status: "Test Complete",
            telegram_result: telegramRes,
            database_result: dbRes,
            message: "Check your Telegram app and your Database/AppSheet now."
        });
    } catch (error) {
        res.status(500).json({ error: error.message, stack: error.stack });
    }
});


// Export for Vercel
module.exports = app;