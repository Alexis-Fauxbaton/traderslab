const CACHE = new Map();
const CACHE_TTL = 30_000; // 30s

function cacheGet(url) {
  const entry = CACHE.get(url);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  CACHE.delete(url);
  return null;
}

function cacheSet(url, data) {
  CACHE.set(url, { data, ts: Date.now() });
}

async function handleRes(res) {
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.statusText); }
  return res.json();
}

const API = {
  async get(url) {
    const cached = cacheGet(url);
    if (cached) return cached;
    const data = await handleRes(await fetch(url));
    cacheSet(url, data);
    return data;
  },
  async post(url, data) {
    const result = await handleRes(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
    CACHE.clear(); // mutations invalident le cache
    return result;
  },
  async put(url, data) {
    const result = await handleRes(await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
    CACHE.clear();
    return result;
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.statusText); }
    CACHE.clear();
  },
  async upload(url, formData) {
    const result = await handleRes(await fetch(url, { method: 'POST', body: formData }));
    CACHE.clear();
    return result;
  },
  invalidate(url) { if (url) CACHE.delete(url); else CACHE.clear(); },
};

export default API;
