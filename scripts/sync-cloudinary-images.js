const fs = require("fs");
const path = require("path");
const axios = require("axios");

const CLOUD_NAME = "dcv3eqmde";
const API_KEY = "213199444474897";
const API_SECRET = "z0qptwMS1KxJiYb_Z5ssZy39aSo";
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
    const images = await fetchCloudinaryImages();
    const json = images.map(img => ({
    name: normalizeName(img.public_id),
    url: img.secure_url,
    }));

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(json, null, 2));
    console.log(`Updated ${OUTPUT_FILE} with ${json.length} images.`);
} catch (err) {
    console.error('Failed to sync Cloudinary images:', err.response?.data || err.message || err);
    // allow deploy to continue while you debug
    process.exit(0);
}
}

main();