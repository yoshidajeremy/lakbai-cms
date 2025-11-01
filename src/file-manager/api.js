// Simple client for the Files API (Cloud Function HTTP endpoints)
//
// Pick API base depending on environment.
// - Production: rely on Hosting rewrite -> "/api"
// - Development: set REACT_APP_FUNCTIONS_ORIGIN to emulator or deployed origin.
const origin =
  process.env.REACT_APP_FUNCTIONS_ORIGIN &&
  process.env.REACT_APP_FUNCTIONS_ORIGIN.replace(/\/+$/,'');

const BASE = origin ? `${origin}/api` : `/api`;

async function req(path, { method = 'GET', body } = {}) {
  const headers = { 'Accept': 'application/json' };
  const init = { method, headers, credentials: 'omit', mode: 'cors' }; // explicit CORS remove if error
  if (body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.error) || (typeof data === 'string' ? data : res.statusText);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data;
}

function normalizeList(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.items)) return res.items;
  return [];
}

export const filesApi = {
  async list(path) {
    const res = await req(`/files/list?path=${encodeURIComponent(path)}`);
    return normalizeList(res);
  },
  get(path) {
    return req(`/files/get?path=${encodeURIComponent(path)}`);
  },
  upload(payload) {
    return req(`/files/upload`, { method: 'POST', body: payload });
  },
  mkdir(payload) {
    return req(`/files/mkdir`, { method: 'POST', body: payload });
  },
  rename(payload) {
    return req(`/files/rename`, { method: 'POST', body: payload });
  },
  delete(payload) {
    return req(`/files/delete`, { method: 'POST', body: payload });
  },
};