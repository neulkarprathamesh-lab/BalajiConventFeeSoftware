import axios from 'axios';
import { API_BASE, isDesktop } from './runtime';
import { isOnline, readCachedGet } from './syncEngine';
import { isRequestAllowedOffline } from './syncPolicy';

/**
 * Balaji FeeHub - API client.
 *
 * Web deployment: the API base comes from the page address (unchanged).
 * Desktop client: the API base comes from the AppData server config
 * (runtime.js). Nothing is loaded from the server, so the same code works
 * with the Main Server switched off.
 *
 * Authentication is purely the Authorization: Bearer header (from localStorage),
 * never cookies. See the note on withCredentials below.
 */
const API = `${API_BASE}/api`;

// Safe boot log - never leaks credentials or tokens.
try {
  // eslint-disable-next-line no-console
  console.info('[BalajiFeeHub] api base =>', API_BASE, '(desktop:', isDesktop() + ')');
} catch (_) {}

// withCredentials is intentionally OFF: this app authenticates purely via
// the Authorization: Bearer <token> header. Turning it on forces the browser
// to treat every cross-origin call as a "credentialed" CORS request, and the
// backend's wildcard Access-Control-Allow-Origin is then rejected before the
// app sees the response body.
const api = axios.create({ baseURL: API, withCredentials: false });

/** Offline in this build = the desktop client cannot reach the Main Server right now. */
export function isOfflineNow() {
  return isDesktop() && !isOnline();
}

function offlineBlockedError() {
  const e = new Error('This change needs the Main Server, which cannot be reached right now. Connect to the Main Server and try again.');
  e.offlineBlocked = true;
  return e;
}

// Navigation to the sign-in screen. The desktop client uses hash routing (file://),
// so it sets the hash and reloads; the web app keeps its normal path.
export function navigateToLogin() {
  if (isDesktop()) {
    window.location.hash = '#/login';
    window.location.reload();
  } else {
    window.location.href = '/login';
  }
}

function onLoginPage() {
  return isDesktop() ? window.location.hash.startsWith('#/login') : window.location.pathname === '/login';
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('bc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (isDesktop() && !isRequestAllowedOffline(config.method, config.url) && !isOnline()) {
    // Server-only write while the Main Server is unreachable: refused here,
    // before it leaves the PC. Offline CREATEs use the pending queue instead.
    return Promise.reject(offlineBlockedError());
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const config = err && err.config;
    const isGet = config && String(config.method || 'get').toLowerCase() === 'get';
    if (isDesktop() && isGet && !(err && err.response)) {
      // Main Server unreachable: serve the read from the last synced snapshot,
      // if the snapshot has it. The UI shows "as of last sync" (see OfflineBanner).
      const cached = await readCachedGet(config.url, config.params).catch(() => ({ found: false }));
      if (cached.found) {
        return { data: cached.data, status: 200, statusText: 'OK (offline cache)', headers: {}, config, request: null, fromCache: true };
      }
    }
    if (err?.response?.status === 401 && !onLoginPage()) {
      localStorage.removeItem('bc_token');
      navigateToLogin();
    }
    return Promise.reject(err);
  }
);

export default api;
export { API, API_BASE };
