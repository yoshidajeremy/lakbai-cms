const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const app = express();
app.use(express.json());
app.use(cors());

const DEST_IMAGES_PATH = path.join(__dirname, "../src/dest-images.json");
const appendDestImages = require('../src/api/appendDestImages');

app.post("/api/update-dest-image", (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: "Missing name or url" });

  const jsonPath = path.join(__dirname, '../src/dest-images.json');
  let current = [];
  try {
      current = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {}
  if (!current.some(img => img.url === url)) {
      current.push({ name, url });
      fs.writeFileSync(jsonPath, JSON.stringify(current, null, 2), 'utf8');
  }

  let images = [];
  if (fs.existsSync(DEST_IMAGES_PATH)) {
    images = JSON.parse(fs.readFileSync(DEST_IMAGES_PATH, "utf8"));
  }
  // Remove existing entry with same name
  images = images.filter(img => img.name !== name);
  images.push({ name, url });

  fs.writeFileSync(DEST_IMAGES_PATH, JSON.stringify(images, null, 2));
  res.json({ success: true });
});

app.post("/api/appendDestImages", (req, res) => {
  const images = req.body;
  if (!Array.isArray(images)) return res.status(400).json({ error: "Payload must be an array" });
  try {
    appendDestImages(images);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/delete-dest-image", (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });

    const jsonPath = path.join(__dirname, '../src/dest-images.json');
    let current = [];
    try {
        current = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {}
    // Remove entry with matching name (case-insensitive, trimmed)
    const updated = current.filter(
        imgEntry => imgEntry.name?.trim().toLowerCase() !== name.trim().toLowerCase()
    );
    fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2), 'utf8');
    res.json({ success: true });
});

const BASE_PORT = parseInt(process.env.PORT, 10) || 4001; // base port to try
const MAX_ATTEMPTS = 10; // try BASE_PORT .. BASE_PORT + MAX_ATTEMPTS - 1

function startServer(port, attemptsLeft) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Update dest-image API running on port ${port}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use.`);
      // try next port if available
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
