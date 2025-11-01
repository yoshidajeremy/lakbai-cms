const path = require('path');

const express = require('express');
const filesRouter = require('./files');
const httpsV2 = require('firebase-functions/v2/https');
const { loadSecret } = require('./secrets');

// load local .env for dev only
if (process.env.NODE_ENV !== 'production') {
  // install dotenv in functions: npm install --save dotenv
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

// prefer environment variables, fallback to functions.config() if present
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'IATIA224';
const GITHUB_REPO  = process.env.GITHUB_REPO  || 'lakbai';
const GITHUB_BRANCH= process.env.GITHUB_BRANCH|| 'soriano';

const app = express();
app.use('/files', filesRouter);

// Export as https function: /api/files/*
exports.api = httpsV2.onRequest({ cpu: 2, memory: '512MiB', timeoutSeconds: 60 }, app);

// preload secret at cold start (non-blocking)
loadSecret('GITHUB_TOKEN').then(tok => {
  if (tok && !process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = tok;
}).catch(() => {});

// use GITHUB_TOKEN, GITHUB_OWNER, etc. in your GitHub API calls
