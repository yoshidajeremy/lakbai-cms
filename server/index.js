const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Mount Cloudinary routes
app.use('/api', require('./cloudinaryRoutes'));

// Configure Cloudinary with your credentials
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.post('/api/cloudinary/delete', async (req, res) => {
    const { publicId } = req.body;
        if (!publicId) return res.status(400).json({ error: 'Missing publicId' });
        try {
        await cloudinary.uploader.destroy(publicId, { invalidate: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete image' });
    }
});

const updateDestImage = require('./update-dest-image');

const PORT = process.env.PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Admin API listening on http://localhost:${PORT}`);
});
