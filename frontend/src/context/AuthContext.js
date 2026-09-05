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
        if (localStorage.getItem('bc_locked') === '1') setLockedState(true);
      } catch (e) { localStorage.removeItem('bc_token'); }
      setLoading(false);
    };
    load();
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('bc_token', data.token);
    localStorage.removeItem('bc_locked');
    setLockedState(false);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch (e) {}
    localStorage.removeItem('bc_token');
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
