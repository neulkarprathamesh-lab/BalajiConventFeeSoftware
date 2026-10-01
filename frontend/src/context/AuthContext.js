import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '@/lib/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLockedState] = useState(false);

  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem('bc_token');
      if (!token) { setLoading(false); return; }
      try {
        const { data } = await api.get('/auth/me');
        setUser(data);
        localStorage.setItem('bc_user_cache', JSON.stringify(data));
        if (localStorage.getItem('bc_locked') === '1') setLockedState(true);
      } catch (e) {
        if (e.response) {
          // A real rejection (401/403 - token genuinely invalid, expired, or
          // revoked) - the existing behavior of signing the user out locally.
          localStorage.removeItem('bc_token');
          localStorage.removeItem('bc_user_cache');
        } else {
          // Server unreachable, not a real auth rejection - the Client must
          // still open into the last-known-authenticated session (offline
          // student search / fee viewing / receipt queuing all depend on
          // this) rather than bouncing to Login just because it briefly
          // cannot re-verify the token over the network.
          try {
            const cached = JSON.parse(localStorage.getItem('bc_user_cache') || 'null');
            if (cached) setUser(cached);
            if (localStorage.getItem('bc_locked') === '1') setLockedState(true);
          } catch (_) { /* no usable cached session - falls through to Login as before */ }
        }
      }
      setLoading(false);
    };
    load();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('bc_token', data.token);
    localStorage.setItem('bc_user_cache', JSON.stringify(data.user));
    localStorage.removeItem('bc_locked');
    setLockedState(false);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch (e) {}
    localStorage.removeItem('bc_token');
    localStorage.removeItem('bc_user_cache');
    localStorage.removeItem('bc_locked');
    setLockedState(false);
    setUser(null);
  };

  const lock = () => { localStorage.setItem('bc_locked', '1'); setLockedState(true); };
  const unlock = () => { localStorage.removeItem('bc_locked'); setLockedState(false); };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser, locked, lock, unlock }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
