// index.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

// 🩺 Health check route (fixes "Cannot GET /")
app.get('/', (req, res) => {
  res.send('✅ Lakbai CMS Server is running successfully on Render.');
});

// 🧩 Cloudinary configuration

// 🧠 Import routes
const cloudinaryRoutes = require('./cloudinaryRoutes');
app.use('/api', cloudinaryRoutes);

// 🗑️ Delete image from Cloudinary
app.post('/api/cloudinary/delete', async (req, res) => {
  const { publicId } = req.body;
  if (!publicId) return res.status(400).json({ error: 'Missing publicId' });

  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete failed:', err.message);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// 📦 List all uploaded Cloudinary images
app.get('/api/cloudinary-images', async (req, res) => {
  try {
    const result = await cloudinary.api.resources({ type: 'upload', max_results: 500 });
    return res.json({ resources: result.resources || [] });
  } catch (err) {
    console.error('cloudinary-images error', err?.response?.data || err.message || err);
    return res.status(500).json({ error: err.message || 'Cloudinary error' });
  }
});

// 🖼️ Optional: serve a local "uploads" folder (if you use local uploads)
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath));

// 🚀 Start server — use Render’s provided PORT
const PORT = process.env.PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Lakbai CMS Server running on port ${PORT}`);
});
