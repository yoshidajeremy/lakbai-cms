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

const BASE_PORT = parseInt(process.env.PORT, 10) || 3002;
const MAX_ATTEMPTS = 10; // try BASE_PORT .. BASE_PORT + MAX_ATTEMPTS - 1

function startServer(port, attemptsLeft) {
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`Admin API listening on http://localhost:${port}`);
    });

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.warn(`Port ${port} in use.`);
            if (attemptsLeft > 1) {
                startServer(port + 1, attemptsLeft - 1);
            } else {
                console.error(`No available ports (${BASE_PORT}-${BASE_PORT + MAX_ATTEMPTS - 1}). Exiting.`);
                process.exit(1);
            }
        } else {
            console.error('Server error', err);
            process.exit(1);
        }
    });
}

startServer(BASE_PORT, MAX_ATTEMPTS);
