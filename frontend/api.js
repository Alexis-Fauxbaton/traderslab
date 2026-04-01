const _CACHE = new Map();
const _CACHE_TTL = 30000; // 30s

function _cacheGet(url) {
  const e = _CACHE.get(url);
  if (e && Date.now() - e.ts < _CACHE_TTL) return e.data;
  _CACHE.delete(url);
  return null;
}

const API = {
  async get(url) {
    const cached = _cacheGet(url);
    if (cached) return cached;
    const res = await fetch(url);
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.statusText); }
    const data = await res.json();
    _CACHE.set(url, { data, ts: Date.now() });
    return data;
  },
  async post(url, data) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.statusText); }
    _CACHE.clear();
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.statusText); }
    _CACHE.clear();
    return res.json();
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.statusText); }
    _CACHE.clear();
  },
  async upload(url, formData) {
    const res = await fetch(url, { method: 'POST', body: formData });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || res.statusText); }
    _CACHE.clear();
    return res.json();
  },
  invalidate(url) { if (url) _CACHE.delete(url); else _CACHE.clear(); },
};
