// Simple in-memory cache for page data with TTL
const cache = new Map();
const TTL = 30000; // 30s

export const pageCache = {
  has(key) {
    const entry = cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expires) { cache.delete(key); return false; }
    return true;
  },
  get(key) {
    const entry = cache.get(key);
    if (!entry || Date.now() > entry.expires) return null;
    return entry.data;
  },
  set(key, data) {
    cache.set(key, { data, expires: Date.now() + TTL });
  },
  invalidate(key) {
    cache.delete(key);
  },
  invalidatePrefix(prefix) {
    for (const k of cache.keys()) {
      if (k.startsWith(prefix)) cache.delete(k);
    }
  },
};
