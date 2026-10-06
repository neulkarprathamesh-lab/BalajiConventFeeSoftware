import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '@/lib/api';
import { isDesktop } from '@/lib/runtime';
import { kickSync } from '@/lib/syncEngine';
import {
  saveOfflineVerifier, forgetOfflineVerifier, verifyOfflineCredentials,
  startOfflineSession, restoreOfflineSession, clearOfflineSession,
} from '@/lib/offlineAuth';

const AuthContext = createContext(null);

const OFFLINE_REASON_TEXT = {
  no_record: 'Offline sign-in is only available for users who have signed in on this PC before. Connect to the Main Server to sign in.',
  expired: 'This PC has not reached the Main Server for a long time, so offline sign-in is turned off. Connect to the Main Server to sign in.',
  bad_password: 'Incorrect password. The Main Server cannot be reached, so this was checked against this PC\'s saved sign-in.',
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLockedState] = useState(false);
  // True when this session was started without the Main Server (offline sign-in).
  const [offlineSession, setOfflineSession] = useState(false);

  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem('bc_token');
      if (!token) {
        // Signed in offline earlier in this client session: restore it while
        // the Main Server is still unreachable. The user signs in online later.
        const offlineUser = isDesktop() ? await restoreOfflineSession() : null;
        if (offlineUser) {
          setUser(offlineUser);
          setOfflineSession(true);
        }
        setLoading(false);
        return;
      }
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
            if (cached) {
              setUser(cached);
              setOfflineSession(true);
            }
            if (localStorage.getItem('bc_locked') === '1') setLockedState(true);
          } catch (_) { /* no usable cached session - falls through to Login as before */ }
        }
      }
      setLoading(false);
    };
    load();
  }, []);

  const login = async (email, password) => {
    let data;
    try {
      ({ data } = await api.post('/auth/login', { email, password }));
    } catch (e) {
      if (isDesktop() && !e.response) {
        // Main Server unreachable: offline sign-in for a user who signed in on this PC before.
        const result = await verifyOfflineCredentials(email, password);
        if (!result.ok) {
          const err = new Error(OFFLINE_REASON_TEXT[result.reason] || 'Offline sign-in failed.');
          err.offlineMessage = err.message;
          throw err;
        }
        await startOfflineSession(result.user);
        localStorage.removeItem('bc_locked');
        setLockedState(false);
        setOfflineSession(true);
        setUser(result.user);
        return result.user;
      }
      if (isDesktop() && e.response && e.response.status === 403) {
        // The server refused the account outright (e.g. deactivated): drop the offline verifier.
        await forgetOfflineVerifier(email);
      }
      throw e;
    }
    localStorage.setItem('bc_token', data.token);
    localStorage.setItem('bc_user_cache', JSON.stringify(data.user));
    localStorage.removeItem('bc_locked');
    if (isDesktop()) {
      await clearOfflineSession();
      // Refresh this PC's offline sign-in verifier from the successful online check.
      saveOfflineVerifier({ email, password, user: data.user }).catch(() => {});
    }
    setOfflineSession(false);
    setLockedState(false);
    setUser(data.user);
    // A fresh online sign-in lets queued work go out at once (no waiting for the next pass).
    kickSync();
    return data.user;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch (e) {}
    localStorage.removeItem('bc_token');
    localStorage.removeItem('bc_user_cache');
    localStorage.removeItem('bc_locked');
    await clearOfflineSession();
    setOfflineSession(false);
    setLockedState(false);
    setUser(null);
  };

  const lock = () => { localStorage.setItem('bc_locked', '1'); setLockedState(true); };
  const unlock = () => { localStorage.removeItem('bc_locked'); setLockedState(false); };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser, locked, lock, unlock, offlineSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
