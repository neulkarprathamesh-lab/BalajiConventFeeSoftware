import axios from 'axios';

/**
 * Balaji FeeHub - final production login architecture.
 *
 * The compiled bundle MUST NOT contain any reference to a build-time
 * REACT_APP_BACKEND_URL. Everything is resolved at RUNTIME from
 * `window.location`, guaranteeing:
 *
 *   - Main Server PC:  http://127.0.0.1:3000   ->  http://127.0.0.1:8001/api
 *   - Client PC (LAN): http://192.168.x.y:3000 ->  http://192.168.x.y:8001/api
 *   - Emergent preview: https://*.preview.emergentagent.com  ->  same-origin /api
 *
 * There is NO fallback string containing the developer's preview URL.
 */
function detectApiBase() {
  if (typeof window === 'undefined' || !window.location) return '';
  const loc = window.location;
  // Emergent preview / dev environment: ingress routes /api on same origin.
  if (loc.hostname && /(^|\.)emergentagent\.com$/i.test(loc.hostname)) {
    return loc.origin;
  }
  // Production LAN pattern: frontend on :3000, backend on :8001, same host.
  // Covers Main Server and every Client PC without any hard-coded IP.
  return `${loc.protocol}//${loc.hostname || '127.0.0.1'}:8001`;
}

function detectSource() {
  if (typeof window === 'undefined' || !window.location) return 'no-window';
  if (/(^|\.)emergentagent\.com$/i.test(window.location.hostname || '')) return 'emergent-preview';
  return 'lan-runtime';
}

const API_BASE = detectApiBase();
const API = `${API_BASE}/api`;

// Safe boot log - never leaks credentials or tokens.
try {
  // eslint-disable-next-line no-console
  console.info('[BalajiFeeHub] api base =>', API_BASE, '(source:', detectSource() + ')');
} catch (_) {}

// withCredentials is intentionally OFF: this app authenticates purely via
// the Authorization: Bearer <token> header (set by the interceptor below,
// from localStorage) - never via cookies. Turning it on forces the browser
// to treat every cross-port call (frontend :3000 -> backend :8001, which
// are different origins even on 127.0.0.1) as a "credentialed" CORS
// request. Since the login endpoint's cookie is Secure=true and is never
// actually stored by the browser over plain http://, the request never
// carries a Cookie header, so the backend's CORS_ORIGINS=* response is
// never upgraded to a specific-origin match - and browsers reject a
// wildcard Access-Control-Allow-Origin on a credentialed request outright,
// before the app ever sees the response body. curl/Postman never enforce
// CORS, so this failure is invisible outside a real browser.
const api = axios.create({ baseURL: API, withCredentials: false });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('bc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('bc_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
export { API, API_BASE };
