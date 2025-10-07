const fs = require("fs");
const path = require("path");
const axios = require("axios");

// ensure env is loaded when this script runs during prestart
require('dotenv').config({ path: require('path').resolve(process.cwd(), '.env') });

const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = "destinations";
const OUTPUT_FILE = path.join(__dirname, "../src/dest-images.json");

async function fetchCloudinaryImages() {
const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image`;
let nextCursor = undefined;
let allImages = [];

do {
    const params = {
    prefix: `${FOLDER}/`,
    max_results: 100,
    ...(nextCursor && { next_cursor: nextCursor }),
    };

    const response = await axios.get(url, {
    params,
    auth: { username: API_KEY, password: API_SECRET },
    });

    allImages = allImages.concat(response.data.resources);
    nextCursor = response.data.next_cursor;
} while (nextCursor);

return allImages;
}

function normalizeName(publicId) {
// Extracts the file name without folder and extension
const nameWithExt = publicId.split("/").pop();
// Remove last 6 chars if needed (e.g., "_fak9t3")
const baseName = nameWithExt.replace(/\.[^/.]+$/, "");
return baseName.replace(/_/g, " ");
}

async function main() {
  try {
    // include required type param and a max_results
    const resp = await cloudinary.api.resources({ type: 'upload', max_results: 500 });
    const json = resp.resources.map(img => ({
    name: normalizeName(img.public_id),
    url: img.secure_url,
    }));

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(json, null, 2));
    console.log(`Updated ${OUTPUT_FILE} with ${json.length} images.`);
  } catch (err) {
    console.error('Failed to sync Cloudinary images:', err?.response?.data || err.message || err);
    // do not fail the whole deploy — allow server to start and debug later
    process.exit(0);
  }
}

main();