const path = require('path');

const express = require('express');
const httpsV2 = require('firebase-functions/v2/https');
const cors = require('cors');
const filesRouter = require('./files');
const { loadSecret } = require('./secrets');

const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://lakbai-cms.onrender.com,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: false,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Accept'], // <- add Accept
};

const app = express();
app.set('trust proxy', 1);
app.use(cors(corsOptions));
// Parse JSON (supports base64 payloads for uploads)
app.use(express.json({ limit: '25mb' }));
app.options('*', cors(corsOptions));

// mount for both local and prod
app.use(['/files', '/api/files'], filesRouter);

// simple health
app.get('/', (req, res) => res.json({ ok: true }));

exports.api = httpsV2.onRequest({ cpu: 2, memory: '512MiB', timeoutSeconds: 60 }, app);

// preload secret only in Cloud Run/Functions (avoids ADC error during local deploy)
if (process.env.K_SERVICE) {
  loadSecret('GITHUB_TOKEN').then(tok => {
    if (tok && !process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = tok;
  }).catch(() => {});
}
