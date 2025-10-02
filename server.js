const express = require('express');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'db1abgogb',
  api_key: '748814157685678',
  api_secret: 'D6t5O6Z-fsLtCS1ISDLgWtEmCDg'
});

// Setup multer-storage-cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: req.body.theatre, // birthday/couple/theatre
      public_id: file.originalname.split('.')[0], // keep original name without extension
    };
  },
});

const parser = multer({ storage });

// Upload endpoint
app.post('/upload', parser.single('image'), (req, res) => {
  res.json({ status: 'ok', url: req.file.path });
});

// Serve admin page
app.get('/admin', (req, res) => res.sendFile(__dirname + '/admin.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
