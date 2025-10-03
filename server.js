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

// Multer + Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const theatre = req.params.theatre; // birthday, couple, private
    return {
      folder: `theatres/${theatre}`,
      public_id: "default", // overwrite existing default image
      resource_type: "image",
      overwrite: true,
    };
  },
});
const upload = multer({ storage });

// Middleware
app.use(express.urlencoded({ extended: true }));

// Upload route
app.post("/upload/:theatre", upload.single("image"), async (req, res) => {
  const pin = req.body.pin;
  if (pin !== process.env.ADMINPIN)
    return res.status(401).json({ message: "Invalid PIN!" });

  if (!req.file) return res.status(400).json({ message: "No file uploaded!" });

  res.json({ message: "Upload successful!", url: req.file.path });
});

// Serve admin panel
app.get("/", async (req, res) => {
  // Fetch current images from Cloudinary
  const images = {
    birthday: cloudinary.url("theatres/birthday/default.jpg", { width: 400, height: 300, crop: "fill", secure: true }),
    couple: cloudinary.url("theatres/couple/default.jpg", { width: 400, height: 300, crop: "fill", secure: true }),
    private: cloudinary.url("theatres/private/default.jpg", { width: 400, height: 300, crop: "fill", secure: true }),
  };

  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Beano's Hub Admin Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#fff7f0,#ffe6d4);min-height:100vh;display:flex;flex-direction:column;align-items:center;padding-bottom:40px;}
h1{margin:40px 0 20px;font-size:2.2rem;color:#5a3e36;text-align:center;}
.card-container{display:flex;flex-wrap:wrap;justify-content:center;gap:25px;width:95%;max-width:1000px;}
.card{background:#fff1eb;border-radius:20px;padding:25px;width:300px;box-shadow:0 10px 25px rgba(0,0,0,0.08);display:flex;flex-direction:column;align-items:center;transition:transform 0.3s ease,box-shadow 0.3s ease;}
.card:hover{transform:translateY(-5px);box-shadow:0 15px 35px rgba(0,0,0,0.12);}
.card h2{margin-bottom:15px;font-size:1.5rem;color:#4b2e25;}
.image-box{width:100%;height:180px;background:#f5d1c1;border-radius:12px;margin-bottom:15px;display:flex;justify-content:center;align-items:center;color:#7a4a3c;font-weight:600;font-size:1rem;}
input[type=file],input[type=password]{width:100%;padding:10px;border-radius:10px;border:none;margin-bottom:12px;font-size:14px;outline:none;}
input[type=file]{cursor:pointer;} input[type=password]{display:none;}
button{width:100%;padding:12px;border-radius:12px;border:none;font-weight:600;font-size:15px;color:#fff;background:#ff6b35;cursor:pointer;transition:background 0.3s ease;}
button:hover{background:#e55a2b;}
@media(max-width:600px){.card{width:90%;padding:20px;}}
</style>
</head>
<body>
<h1>Beano's Hub Admin Panel</h1>

<div class="card-container">

<div class="card">
<h2>Birthday Theatre</h2>
<div class="image-box" id="birthdayImageBox"><img src="${images.birthday}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;"></div>
<input type="file" id="birthdayFile">
<input type="password" placeholder="Enter PIN" id="birthdayPin">
<button id="birthdayBtn">Upload</button>
</div>

<div class="card">
<h2>Couple Theatre</h2>
<div class="image-box" id="coupleImageBox"><img src="${images.couple}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;"></div>
<input type="file" id="coupleFile">
<input type="password" placeholder="Enter PIN" id="couplePin">
<button id="coupleBtn">Upload</button>
</div>

<div class="card">
<h2>Private Theatre</h2>
<div class="image-box" id="privateImageBox"><img src="${images.private}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;"></div>
<input type="file" id="privateFile">
<input type="password" placeholder="Enter PIN" id="privatePin">
<button id="privateBtn">Upload</button>
</div>

</div>

<script>
const setups = [
  {fileId:'birthdayFile', pinId:'birthdayPin', boxId:'birthdayImageBox', btnId:'birthdayBtn'},
  {fileId:'coupleFile', pinId:'couplePin', boxId:'coupleImageBox', btnId:'coupleBtn'},
  {fileId:'privateFile', pinId:'privatePin', boxId:'privateImageBox', btnId:'privateBtn'}
];

setups.forEach(({fileId,pinId,boxId,btnId})=>{
  const fileInput = document.getElementById(fileId);
  const pinInput = document.getElementById(pinId);
  const btn = document.getElementById(btnId);
  const imgBox = document.getElementById(boxId);

  fileInput.addEventListener("change", e=>{
    const file = e.target.files[0];
    if(file){
      const reader = new FileReader();
      reader.onload = () => {
        imgBox.innerHTML = '<img src="'+reader.result+'" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">';
      }
      reader.readAsDataURL(file);
      pinInput.style.display="block";
    }
  });

  btn.addEventListener("click", async ()=>{
    const file = fileInput.files[0];
    const pin = pinInput.value;
    if(!file || !pin){ alert("Select image and enter PIN"); return; }

    const formData = new FormData();
    formData.append("image", file);
    formData.append("pin", pin);

    try{
      const res = await fetch("/upload/"+fileId.replace("File",""), {method:"POST", body:formData});
      const data = await res.json();
      alert(data.message);
    }catch(err){
      alert("Upload failed!");
    }
  });
});
</script>

</body>
</html>
  `);
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
