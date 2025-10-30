const functions = require('firebase-functions');
const express = require('express');
const filesRouter = require('./files');

const app = express();
app.use('/files', filesRouter);

// Export as https function: /api/files/*
exports.api = functions.region('us-central1').https.onRequest(app);