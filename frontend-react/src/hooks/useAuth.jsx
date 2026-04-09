import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import API from '../lib/api';
import { pageCache } from '../lib/pageCache';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) { setLoading(false); return; }
    // Verify token is still valid
    fetch((import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(u => { setUser(u); localStorage.setItem('user', JSON.stringify(u)); })
      .catch(() => { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await API.post('/auth/login', { email, password });
    localStorage.setItem('token', res.access_token);
    localStorage.setItem('user', JSON.stringify(res.user));
    localStorage.removeItem('strategyOrder');
    API.invalidate();
    pageCache.clear();
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(async (email, username, password) => {
    const res = await API.post('/auth/register', { email, username, password });
    localStorage.setItem('token', res.access_token);
    localStorage.setItem('user', JSON.stringify(res.user));
    localStorage.removeItem('strategyOrder');
    API.invalidate();
    pageCache.clear();
    setUser(res.user);
    return res.user;
  }, []);

  const oauthLogin = useCallback(async (provider, idToken) => {
    const res = await API.post(`/auth/${provider}`, { id_token: idToken });
    localStorage.setItem('token', res.access_token);
    localStorage.setItem('user', JSON.stringify(res.user));
    localStorage.removeItem('strategyOrder');
    API.invalidate();
    pageCache.clear();
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('strategyOrder');
    setUser(null);
    API.invalidate();
    pageCache.clear();
    window.location.hash = '#/login';
  }, []);

  const updateUser = useCallback(async (fields) => {
    const updated = await API.patch('/auth/me', fields);
    setUser(updated);
    localStorage.setItem('user', JSON.stringify(updated));
    return updated;
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, register, oauthLogin, logout, updateUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
