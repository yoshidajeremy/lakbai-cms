const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
console.log('Cloudinary config:', cloudinary.config());

router.post('/api/cloudinary/delete', async (req, res) => {
  const { publicId } = req.body;
  if (!publicId) return res.status(400).json({ error: 'Missing publicId' });
  try {
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Ensure cloudinary is configured in your start sequence (index.js) or here:
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });

// Add endpoint: GET /api/cloudinary-images
router.get('/cloudinary-images', async (req, res) => {
  try {
    // adjust options (prefix, max_results) if you need filtering/paging
    const result = await cloudinary.api.resources({ type: 'upload', max_results: 500 });
    return res.json({ resources: result.resources || [] });
  } catch (err) {
    console.error('cloudinary-images error', err?.response?.data || err.message || err);
    return res.status(500).json({ error: err.message || 'Cloudinary error' });
  }
});

module.exports = router;
