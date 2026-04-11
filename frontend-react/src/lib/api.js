const CACHE = new Map();
const CACHE_TTL = 30_000; // 30s

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function withBase(url) {
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE}${url}`;
}

function getToken() {
  return localStorage.getItem('token');
}

function authHeaders(extra = {}) {
  const token = getToken();
  const headers = { ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

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
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.hash = '#/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(e.detail || res.statusText);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const API = {
  async get(url) {
    const fullUrl = withBase(url);
    const cached = cacheGet(fullUrl);
    if (cached) return cached;
    const data = await handleRes(await fetch(fullUrl, { headers: authHeaders() }));
    cacheSet(fullUrl, data);
    return data;
  },
  async post(url, data) {
    const result = await handleRes(
      await fetch(withBase(url), {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data),
      })
    );
    CACHE.clear();
    return result;
  },
  async put(url, data) {
    const result = await handleRes(
      await fetch(withBase(url), {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data),
      })
    );
    CACHE.clear();
    return result;
  },
  async patch(url, data) {
    const result = await handleRes(
      await fetch(withBase(url), {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data),
      })
    );
    CACHE.clear();
    return result;
  },
  async del(url) {
    const res = await fetch(withBase(url), { method: 'DELETE', headers: authHeaders() });
    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.hash = '#/login';
      throw new Error('Session expired');
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const err = new Error(e.detail || res.statusText);
      err.status = res.status;
      throw err;
    }
    CACHE.clear();
  },
  async upload(url, formData) {
    const result = await handleRes(
      await fetch(withBase(url), {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      })
    );
    CACHE.clear();
    return result;
  },
  invalidate(url) {
    if (url) CACHE.delete(withBase(url));
    else CACHE.clear();
  },
};

export default API;
