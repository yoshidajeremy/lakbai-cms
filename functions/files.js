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
    const err = new Error('GITHUB_TOKEN is not configured');
    err.status = 500;
    throw err;
  }
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'lakbai-cms',
    'Authorization': `token ${token}`,
    ...(init.headers || {}),
  };
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
  return res;
}

// GET /files/list?path=<path>
router.get('/list', async (req, res) => {
  try {
    const qPath = String(req.query.path || '').replace(/^\/+/, '');
    // encode each segment to keep slashes
    const encPath = qPath.split('/').map(encodeURIComponent).join('/');
    const url = `/repos/${OWNER}/${REPO}/contents/${encPath}?ref=${encodeURIComponent(BRANCH)}`;

    const ghRes = await gh(url);
    if (ghRes.status === 404) return res.json([]);

    if (!ghRes.ok) {
      const txt = await ghRes.text();
      return res.status(ghRes.status).json({ error: txt || ghRes.statusText });
    }

    const data = await ghRes.json();
    const items = Array.isArray(data) ? data : [];
    const list = items.map(it => ({
      name: it.name,
      type: it.type,           // 'dir' | 'file'
      size: it.size || 0,
      path: it.path,
      sha: it.sha,
      download_url: it.download_url || null,
    }));
    res.json(list);
  } catch (e) {
    console.warn('list failed:', e.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Internal error' });
  }
});

module.exports = router;