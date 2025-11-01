const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const path = require('path');

// load local .env in development (install dotenv in functions: npm i --save dotenv)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

const functions = (() => {
  try { return require('firebase-functions'); } catch (e) { return {}; }
})();

// fallback config (functions.config may not exist on Render)
const cfg = (functions && functions.config) ? functions.config() : {};
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN  || (cfg.github && cfg.github.token)  || '';
const GITHUB_OWNER  = process.env.GITHUB_OWNER  || (cfg.github && cfg.github.owner)  || 'IATIA224';
const GITHUB_REPO   = process.env.GITHUB_REPO   || (cfg.github && cfg.github.repo)   || 'lakbai';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || (cfg.github && cfg.github.branch) || 'soriano';

const router = express.Router();
router.use(cors({
  origin: true,
  credentials: true,
}));
router.use(express.json({ limit: '25mb' }));
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

function getEnv() {
  const {
    github: { token, owner, repo, branch } = {},
  } = process.env.FUNCTIONS_EMULATOR ? {
    github: {
      token: process.env.GITHUB_TOKEN,
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      branch: process.env.GITHUB_BRANCH || 'main',
    },
  } : require('firebase-functions').config();

  if (!token || !owner || !repo) {
    throw new Error('Missing GitHub config. Set via firebase functions:config:set github.token="..." github.owner="..." github.repo="..." github.branch="main"');
  }
  return { token, owner, repo, branch: branch || 'main' };
}

function asItem(entry) {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type === 'dir' ? 'dir' : 'file',
    size: entry.size ?? null,
  };
}

// GET /list?path=public[/sub]
router.get('/list', async (req, res) => {
  console.log('GET /list', req.query);
  try {
    const { token, owner, repo, branch } = getEnv();
    const path = req.query.path || 'public';
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(data)) {
      return res.json(data.map(asItem));
    }
    // Single file
    return res.json([asItem(data)]);
  } catch (e) {
    res.status(400).send(e.message || 'list failed');
  }
});

// GET /get?path=public/foo.png
router.get('/get', async (req, res) => {
  try {
    const { token, owner, repo, branch } = getEnv();
    const path = req.query.path;
    if (!path) throw new Error('path required');
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(data)) return res.status(400).send('path is a directory');

    res.json({
      path: data.path,
      mediaType: data.type === 'file' ? (data.content && data.encoding === 'base64' ? (data.name.match(/\.(\w+)$/)?.[1] || '') : '') : '',
      contentBase64: data.content, // base64
      sha: data.sha,
    });
  } catch (e) {
    res.status(400).send(e.message || 'get failed');
  }
});

// POST /upload { path, contentBase64, message }
router.post('/upload', async (req, res) => {
  try {
    const { token, owner, repo, branch } = getEnv();
    const { path, contentBase64, message } = req.body || {};
    if (!path || !contentBase64) throw new Error('path and contentBase64 required');

    const octokit = new Octokit({ auth: token });

    // Check if exists to send SHA for update
    let sha = null;
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
      if (!Array.isArray(data)) sha = data.sha;
    } catch { /* not found -> create */ }

    const rsp = await octokit.repos.createOrUpdateFileContents({
      owner, repo, path, message: message || `Update ${path}`, content: contentBase64, branch, sha: sha || undefined,
    });

    res.json({ ok: true, path, sha: rsp.data.content?.sha });
  } catch (e) {
    res.status(400).send(e.message || 'upload failed');
  }
});

// POST /mkdir { path, message }
router.post('/mkdir', async (req, res) => {
  try {
    const { token, owner, repo, branch } = getEnv();
    const { path, message } = req.body || {};
    if (!path) throw new Error('path required');
    const octokit = new Octokit({ auth: token });
    const filePath = `${path.replace(/\/+$/,'')}/.gitkeep`;

    const rsp = await octokit.repos.createOrUpdateFileContents({
      owner, repo, path: filePath, message: message || `Create folder ${path}`, content: Buffer.from('').toString('base64'), branch,
    });
    res.json({ ok: true, path });
  } catch (e) {
    res.status(400).send(e.message || 'mkdir failed');
  }
});

// POST /rename { fromPath, toPath, message }
router.post('/rename', async (req, res) => {
  try {
    const { token, owner, repo, branch } = getEnv();
    const { fromPath, toPath, message } = req.body || {};
    if (!fromPath || !toPath) throw new Error('fromPath and toPath required');

    const octokit = new Octokit({ auth: token });

    // If directory, we move by recreating the tree (simple approach via list/get)
    const src = await octokit.repos.getContent({ owner, repo, path: fromPath, ref: branch });
    if (Array.isArray(src.data)) {
      // Folder: recurse list and copy files under new folder, then delete old
      const queue = [fromPath];
      while (queue.length) {
        const cur = queue.pop();
        const { data } = await octokit.repos.getContent({ owner, repo, path: cur, ref: branch });
        for (const entry of data) {
          if (entry.type === 'dir') queue.push(entry.path);
          else {
            const file = await octokit.repos.getContent({ owner, repo, path: entry.path, ref: branch });
            const to = entry.path.replace(fromPath, toPath);
            await octokit.repos.createOrUpdateFileContents({
              owner, repo, path: to, message: message || `Move ${fromPath} -> ${toPath}`,
              content: file.data.content, branch,
            });
          }
        }
      }
      // delete original directory by deleting files (GitHub auto-removes empty dirs)
      const delQueue = [fromPath];
      while (delQueue.length) {
        const cur = delQueue.pop();
        const { data } = await octokit.repos.getContent({ owner, repo, path: cur, ref: branch });
        for (const entry of data) {
          if (entry.type === 'dir') delQueue.push(entry.path);
          else {
            await octokit.repos.deleteFile({ owner, repo, path: entry.path, message: `Delete ${entry.path} (moved)`, sha: entry.sha, branch });
          }
        }
      }
      return res.json({ ok: true });
    } else {
      // File: copy new then delete old
      const file = src.data; // has content base64 and sha
      await octokit.repos.createOrUpdateFileContents({
        owner, repo, path: toPath, message: message || `Rename ${fromPath} -> ${toPath}`,
        content: file.content, branch,
      });
      await octokit.repos.deleteFile({ owner, repo, path: fromPath, message: `Delete ${fromPath} (renamed)`, sha: file.sha, branch });
      return res.json({ ok: true });
    }
  } catch (e) {
    res.status(400).send(e.message || 'rename failed');
  }
});

// POST /delete { path, message }
router.post('/delete', async (req, res) => {
  try {
    const { token, owner, repo, branch } = getEnv();
    const { path, message } = req.body || {};
    if (!path) throw new Error('path required');
    const octokit = new Octokit({ auth: token });

    const resp = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (Array.isArray(resp.data)) {
      // Delete folder by deleting all files
      const stack = [path];
      while (stack.length) {
        const cur = stack.pop();
        const { data } = await octokit.repos.getContent({ owner, repo, path: cur, ref: branch });
        for (const entry of data) {
          if (entry.type === 'dir') stack.push(entry.path);
          else {
            await octokit.repos.deleteFile({ owner, repo, path: entry.path, sha: entry.sha, branch, message: message || `Delete ${entry.path}` });
          }
        }
      }
      return res.json({ ok: true });
    } else {
      await octokit.repos.deleteFile({ owner, repo, path, sha: resp.data.sha, branch, message: message || `Delete ${path}` });
      return res.json({ ok: true });
    }
  } catch (e) {
    res.status(400).send(e.message || 'delete failed');
  }
});

module.exports = router;