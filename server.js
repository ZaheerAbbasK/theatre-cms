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

// Parse form-data
app.use(express.urlencoded({ extended: true }));

// Multer storage for Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    const theatre = req.params.theatre;
    return {
      folder: "theatres",
      public_id: theatre,
      resource_type: "image",
    };
  },
});
const upload = multer({ storage });

// Upload route with PIN
app.post("/upload/:theatre", upload.single("image"), (req, res) => {
  const pin = req.body.pin;
  const validPin = process.env.ADMINPIN;

  if (pin !== validPin) {
    return res.status(401).json({ message: "Invalid PIN!" });
  }

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded!" });
  }

  res.json({ message: "✅ Upload successful!", url: req.file.path });
});

// Serve the admin page directly
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Theatre Admin Panel</title>
<style>
body { font-family:sans-serif; background:#f0f2f5; display:flex; flex-direction:column; align-items:center; min-height:100vh; margin:0; }
h1 { margin:30px 0; }
.card { background:#fff; padding:20px; border-radius:12px; box-shadow:0 8px 20px rgba(0,0,0,0.1); margin-bottom:25px; width:90%; max-width:400px; }
label { display:block; margin-bottom:6px; font-weight:600; }
input[type=file], input[type=password] { width:100%; padding:8px 10px; margin-bottom:12px; border-radius:6px; border:1px solid #ccc; }
button { width:100%; padding:12px; border:none; border-radius:8px; background:#007bff; color:#fff; cursor:pointer; }
button:hover { background:#0056d2; }
.message { margin-top:10px; font-size:14px; text-align:center; display:none; }
.success { color:#28a745; }
.error { color:#dc3545; }
.loading { text-align:center; display:none; margin-top:8px; color:#555; }
</style>
</head>
<body>
<h1>Theatre Image Admin Panel</h1>

${["birthday","couple","main"].map(theatre => `
<div class="card">
<h2>${theatre.charAt(0).toUpperCase()+theatre.slice(1)} Theatre</h2>
<form id="${theatre}Form">
<label>Upload Image:</label>
<input type="file" name="image" accept="image/*" required>
<label>Admin PIN:</label>
<input type="password" name="pin" placeholder="Enter PIN" required>
<button type="submit">Upload</button>
<div class="loading" id="${theatre}Loading">Uploading...</div>
<div class="message success" id="${theatre}Success">✅ Uploaded Successfully!</div>
<div class="message error" id="${theatre}Error">❌ Upload Failed!</div>
</form>
</div>
`).join('')}

<script>
${["birthday","couple","main"].map(theatre => `
document.getElementById("${theatre}Form").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const form = e.target;
  const file = form.querySelector("input[type=file]").files[0];
  const pin = form.querySelector("input[name=pin]").value;
  const loading = document.getElementById("${theatre}Loading");
  const success = document.getElementById("${theatre}Success");
  const error = document.getElementById("${theatre}Error");
  loading.style.display="block"; success.style.display="none"; error.style.display="none";
  const formData = new FormData();
  formData.append("image", file);
  formData.append("pin", pin);
  try{
    const res = await fetch("/upload/${theatre}", {method:"POST", body:formData});
    const data = await res.json();
    loading.style.display="none";
    if(res.ok){ success.style.display="block"; } else { error.textContent="❌ "+(data.message||"Upload Failed!"); error.style.display="block"; }
  }catch(err){ loading.style.display="none"; error.style.display="block"; }
});
`).join('')}
</script>
</body>
</html>
  `);
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
