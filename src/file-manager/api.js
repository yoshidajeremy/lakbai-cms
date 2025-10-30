// Simple client for the Files API (Cloud Function HTTP endpoints)

// Pick API base depending on environment.
// - Production: rely on Hosting rewrite -> "/api/files"
// - Development: set REACT_APP_FUNCTIONS_ORIGIN to emulator or deployed origin to bypass CRA proxy.
const origin =
  process.env.REACT_APP_FUNCTIONS_ORIGIN &&
  process.env.REACT_APP_FUNCTIONS_ORIGIN.replace(/\/+$/,''); // e.g. http://localhost:5001/<projectId>/us-central1 or https://us-central1-<projectId>.cloudfunctions.net

const BASE = origin ? `${origin}/api/files` : '/api/files';

async function json(res) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const filesApi = {
  list: async (path = 'public') => {
    const res = await fetch(`${BASE}/list?path=${encodeURIComponent(path)}`, { credentials: 'include' });
    return json(res);
  },
  get: async (path) => {
    const res = await fetch(`${BASE}/get?path=${encodeURIComponent(path)}`, { credentials: 'include' });
    return json(res);
  },
  upload: async ({ path, contentBase64, message }) => {
    const res = await fetch(`${BASE}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ path, contentBase64, message }),
    });
    return json(res);
  },
  mkdir: async ({ path, message }) => {
    const res = await fetch(`${BASE}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ path, message }),
    });
    return json(res);
  },
  rename: async ({ fromPath, toPath, message }) => {
    const res = await fetch(`${BASE}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ fromPath, toPath, message }),
    });
    return json(res);
  },
  delete: async ({ path, message }) => {
    const res = await fetch(`${BASE}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ path, message }),
    });
    return json(res);
  },
};