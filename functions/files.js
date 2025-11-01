const express = require('express');
const router = express.Router();
const { loadSecret } = require('./secrets');

// config
const OWNER  = process.env.GITHUB_OWNER  || 'IATIA224';
const REPO   = process.env.GITHUB_REPO   || 'lakbai';
const BRANCH = process.env.GITHUB_BRANCH || 'soriano';

// GitHub fetch helper (Node 20 has global fetch)
async function gh(path, init = {}) {
  let token = process.env.GITHUB_TOKEN;
  if (!token) {
    try { token = await loadSecret('GITHUB_TOKEN'); } catch { token = ''; }
  }
  token = String(token || '').trim();
  if (/^(null|undefined|false)$/i.test(token)) token = '';

  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'lakbai-cms',
    ...(init.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`; // allow public access without token
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
  return res;
}

function guessMime(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    csv: 'text/csv; charset=utf-8',
    json: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    html: 'text/html; charset=utf-8'
  })[ext] || 'application/octet-stream';
}

// Try GitHub Contents API; optionally fall back to raw for public repos
async function getContent(path) {
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const r = await gh(`/repos/${OWNER}/${REPO}/contents/${enc}?ref=${encodeURIComponent(BRANCH)}`);
  if (r.ok) {
    const data = await r.json();
    return { ok: true, data };
  }

  // Fallback for read operations if token is missing/insufficient
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${encodeURIComponent(BRANCH)}/${enc}`;
      const rawRes = await fetch(rawUrl); // no auth; works for public repos
      if (rawRes.ok) {
        const buf = Buffer.from(await rawRes.arrayBuffer());
        return {
          ok: true,
          data: {
            type: 'file',
            sha: '', // unknown in raw mode
            content: buf.toString('base64'),
          },
        };
      }
    } catch (_) {}
  }

  return { ok:false, status:r.status, body: await r.text() };
}

async function ensureSha(path) {
  const res = await getContent(path);
  if (res.ok && res.data && res.data.type === 'file') return res.data.sha;
  return '';
}

async function listRecursive(dirPath, acc = []) {
  const enc = dirPath.split('/').map(encodeURIComponent).join('/');
  const r = await gh(`/repos/${OWNER}/${REPO}/contents/${enc}?ref=${encodeURIComponent(BRANCH)}`);
  if (!r.ok) return acc;
  const items = await r.json();
  for (const it of Array.isArray(items) ? items : []) {
    if (it.type === 'dir') {
      await listRecursive(it.path, acc);
    } else if (it.type === 'file') {
      acc.push(it.path);
    }
  }
  return acc;
}

async function putFile(path, contentBase64, message, shaOpt) {
  // Guard: writing requires a valid token
  let token = String(process.env.GITHUB_TOKEN || '').trim();
  if (!token) try { token = await loadSecret('GITHUB_TOKEN'); } catch {}
  if (!token || /^(null|undefined|false)$/i.test(token)) {
    return new Response(null, { status: 403, statusText: 'Missing or invalid GITHUB_TOKEN for write' });
  }

  const enc = path.split('/').map(encodeURIComponent).join('/');
  const body = {
    message: message || `Update ${path}`,
    content: (contentBase64 || '').replace(/\n/g, ''),
    branch: BRANCH,
  };
  if (shaOpt) body.sha = shaOpt;
  const r = await gh(`/repos/${OWNER}/${REPO}/contents/${enc}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r;
}

async function deleteFile(path, message) {
  // Guard: writing requires a valid token
  let token = String(process.env.GITHUB_TOKEN || '').trim();
  if (!token) try { token = await loadSecret('GITHUB_TOKEN'); } catch {}
  if (!token || /^(null|undefined|false)$/i.test(token)) {
    return { ok:false, status:403, body:'Missing or invalid GITHUB_TOKEN for write' };
  }

  const sha = await ensureSha(path);
  if (!sha) return { ok:false, status:404, body:'Not found' };
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const r = await gh(`/repos/${OWNER}/${REPO}/contents/${enc}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message || `Delete ${path}`, sha, branch: BRANCH }),
  });
  return r;
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

// GET /get?path=
router.get('/get', async (req, res) => {
  try {
    const path = String(req.query.path || '').replace(/^\/+/, '');
    if (!path) return res.status(400).json({ error: 'Missing path' });

    const out = await getContent(path);
    if (!out.ok) return res.status(out.status).json({ error: out.body || 'Fetch failed' });

    const data = out.data; // { content, encoding, sha, type }
    if (data.type !== 'file') return res.status(400).json({ error: 'Not a file' });

    res.json({
      path,
      sha: data.sha,
      contentBase64: String(data.content || '').replace(/\n/g, ''),
      mediaType: guessMime(path),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

// POST /upload  { path, contentBase64, message }
router.post('/upload', async (req, res) => {
  try {
    const { path, contentBase64, message } = req.body || {};
    if (!path || !contentBase64) return res.status(400).json({ error: 'Missing path or content' });

    // If file exists, include sha to update; otherwise create
    const sha = await ensureSha(path);
    const r = await putFile(path, contentBase64, message, sha || undefined);
    if (!r.ok) return res.status(r.status).json({ error: await r.text() || r.statusText });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

// POST /mkdir { path, message }
router.post('/mkdir', async (req, res) => {
  try {
    let { path, message } = req.body || {};
    path = String(path || '').replace(/^\/+|\/+$/g, '');
    if (!path) return res.status(400).json({ error: 'Missing path' });

    // If dir already exists, return OK
    const enc = path.split('/').map(encodeURIComponent).join('/');
    const check = await gh(`/repos/${OWNER}/${REPO}/contents/${enc}?ref=${encodeURIComponent(BRANCH)}`);
    if (check.ok) return res.json({ ok: true });

    // Create .gitkeep to materialize folder
    const keepPath = `${path}/.gitkeep`;
    const r = await putFile(keepPath, Buffer.from('').toString('base64'), message || `Create folder ${path}`);
    if (!r.ok) return res.status(r.status).json({ error: await r.text() || r.statusText });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

// POST /rename { fromPath, toPath, message }
router.post('/rename', async (req, res) => {
  try {
    const { fromPath, toPath, message } = req.body || {};
    const src = String(fromPath || '').replace(/^\/+/, '');
    const dst = String(toPath || '').replace(/^\/+/, '');
    if (!src || !dst) return res.status(400).json({ error: 'Missing fromPath/toPath' });

    // Is source a dir?
    const enc = src.split('/').map(encodeURIComponent).join('/');
    const head = await gh(`/repos/${OWNER}/${REPO}/contents/${enc}?ref=${encodeURIComponent(BRANCH)}`);
    if (head.status === 404) return res.status(404).json({ error: 'Not found' });

    if (head.ok) {
      const data = await head.json();
      // Dir -> copy all files then delete originals (simple, multi-commit)
      if (Array.isArray(data)) {
        const files = await listRecursive(src);
        for (const f of files) {
          const gc = await getContent(f);
          if (!gc.ok) return res.status(gc.status).json({ error: gc.body || `Read failed: ${f}` });
          const newPath = f.replace(new RegExp(`^${src}(/|$)`), `${dst}$1`);
          const put = await putFile(newPath, String(gc.data.content || '').replace(/\n/g, ''), message || `Move ${src} -> ${dst}`);
          if (!put.ok) return res.status(put.status).json({ error: await put.text() || put.statusText });
        }
        // delete originals
        for (const f of files.reverse()) {
          const del = await deleteFile(f, message || `Remove ${f} (moved)`);
          if (!del.ok) return res.status(del.status).json({ error: await del.text() || del.statusText });
        }
        return res.json({ ok: true, moved: files.length });
      }
      // File
      const gc = await getContent(src);
      if (!gc.ok) return res.status(gc.status).json({ error: gc.body || 'Read failed' });
      const put = await putFile(dst, String(gc.data.content || '').replace(/\n/g, ''), message || `Rename ${src} -> ${dst}`);
      if (!put.ok) return res.status(put.status).json({ error: await put.text() || put.statusText });
      const del = await deleteFile(src, message || `Remove ${src} (renamed)`);
      if (!del.ok) return res.status(del.status).json({ error: await del.text() || del.statusText });
      return res.json({ ok: true, moved: 1 });
    }

    return res.status(head.status).json({ error: await head.text() || 'Fetch failed' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

// POST /delete { path, message }
router.post('/delete', async (req, res) => {
  try {
    const { path, message } = req.body || {};
    const src = String(path || '').replace(/^\/+/, '');
    if (!src) return res.status(400).json({ error: 'Missing path' });

    const enc = src.split('/').map(encodeURIComponent).join('/');
    const head = await gh(`/repos/${OWNER}/${REPO}/contents/${enc}?ref=${encodeURIComponent(BRANCH)}`);
    if (head.status === 404) return res.json({ ok: true, deleted: 0 });

    if (head.ok) {
      const data = await head.json();
      if (Array.isArray(data)) {
        // dir: delete all files recursively
        const files = await listRecursive(src);
        let count = 0;
        for (const f of files) {
          const del = await deleteFile(f, message || `Delete ${f}`);
          if (!del.ok) return res.status(del.status).json({ error: await del.text() || del.statusText });
          count++;
        }
        return res.json({ ok: true, deleted: count });
      } else {
        const del = await deleteFile(src, message || `Delete ${src}`);
        if (!del.ok) return res.status(del.status).json({ error: await del.text() || del.statusText });
        return res.json({ ok: true, deleted: 1 });
      }
    }
    return res.status(head.status).json({ error: await head.text() || 'Fetch failed' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal error' });
  }
});

module.exports = router;