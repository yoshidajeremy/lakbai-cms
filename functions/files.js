const express = require('express');
const router = express.Router();
const { loadSecret } = require('./secrets');

// config
const OWNER  = process.env.GITHUB_OWNER  || 'IATIA224';
const REPO   = process.env.GITHUB_REPO   || 'lakbai';
const BRANCH = process.env.GITHUB_BRANCH || 'soriano';

// GitHub fetch helper (Node 20 has global fetch)
async function gh(path, init = {}) {
  const token = process.env.GITHUB_TOKEN || await loadSecret('GITHUB_TOKEN');
  if (!token) {
    const err = new Error('GITHUB_TOKEN not configured');
    err.status = 500;
    throw err;
  }
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'lakbai-cms',
    'Authorization': `token ${token}`,
    ...(init.headers || {}),
  };
  return fetch(`https://api.github.com${path}`, { ...init, headers });
}

// GET /list?path=
router.get('/list', async (req, res) => {
  try {
    const qPath = String(req.query.path || '').replace(/^\/+/, '');
    const enc = qPath.split('/').map(encodeURIComponent).join('/');
    const url = `/repos/${OWNER}/${REPO}/contents/${enc}?ref=${encodeURIComponent(BRANCH)}`;

    const r = await gh(url);
    if (r.status === 404) return res.json([]);
    if (!r.ok) return res.status(r.status).json({ error: await r.text() || r.statusText });

    const data = await r.json();
    const items = Array.isArray(data) ? data : [];
    res.json(items.map(it => ({
      name: it.name,
      type: it.type,
      size: it.size || 0,
      path: it.path,
      sha: it.sha,
      download_url: it.download_url || null,
    })));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Internal error' });
  }
});

module.exports = router;