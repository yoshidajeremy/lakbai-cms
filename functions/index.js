const path = require('path');

const express = require('express');
const filesRouter = require('./files');
const httpsV2 = require('firebase-functions/v2/https');
const cors = require('cors');
const { loadSecret } = require('./secrets');

// allowed origins (comma‑separated). For prod add your Render URL.
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,https://lakbai-cms.onrender.com')
  .split(',').map(s => s.trim()).filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl/postman
    return cb(null, ALLOWED.includes(origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
};

const app = express();
app.set('trust proxy', 1);
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// mount for both local (no hosting rewrite) and prod (rewritten to /api)
app.use(['/files', '/api/files'], filesRouter);

// Export as https function
exports.api = httpsV2.onRequest({ cpu: 2, memory: '512MiB', timeoutSeconds: 60 }, app);

// preload secret at cold start (non-blocking)
loadSecret('GITHUB_TOKEN').then(tok => {
  if (tok && !process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = tok;
}).catch(() => {});

// use GITHUB_TOKEN, GITHUB_OWNER, etc. in your GitHub API calls
