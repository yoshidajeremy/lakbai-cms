const express = require('express');
const router = express.Router();
const path = require('path');
if (process.env.NODE_ENV !== 'production') require('dotenv').config({ path: path.join(__dirname, '.env') });

const { loadSecret } = require('./secrets');

async function getGithubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return await loadSecret('GITHUB_TOKEN');
}

// Example route that needs the token
router.get('/list', async (req, res) => {
  const token = await getGithubToken();
  if (!token) return res.status(500).send('Server not configured');
  // use token in Authorization header for GitHub API calls
  // ...existing code that calls GitHub...
  res.json({ ok: true });
});

module.exports = router;