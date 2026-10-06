/**
 * Where this UI is running.
 *
 *  - Desktop client (BalajiFeeHub.exe): the UI is bundled inside the Electron
 *    package and the Main Server is only a sync/API dependency. The server
 *    address comes from the AppData config and is handed to us synchronously by
 *    preload.js as window.feehubRuntime.
 *  - Web deployment: the same code served by the Main Server, unchanged. The
 *    API base is derived from the page address, exactly as before.
 *
 * Build flag: REACT_APP_DESKTOP=1 selects HashRouter (file:// has no path
 * routing). The runtime bridge, not the build flag, decides desktop behaviour.
 */
export const DESKTOP_BUILD = process.env.REACT_APP_DESKTOP === '1';

let cachedRuntime;

function readBridge() {
  try {
    const bridge = typeof window !== 'undefined' ? window.feehubRuntime : null;
    if (bridge && bridge.isDesktop && typeof bridge.getConfig === 'function') {
      return { isDesktop: true, ...bridge.getConfig() };
    }
  } catch (_) {
    // Not running inside the desktop client - fall through to web mode.
  }
  return null;
}

/** { isDesktop, appVersion, serverHost, serverPort, serverBase, frontendBase } or null on the web. */
export function getRuntime() {
  if (cachedRuntime === undefined) cachedRuntime = readBridge();
  return cachedRuntime;
}

export function isDesktop() {
  return getRuntime() !== null;
}

// Desktop: the installed client version (package.json of the Electron app).
// Web: the frontend build version.
export function appVersion() {
  const r = getRuntime();
  return (r && r.appVersion) || process.env.REACT_APP_VERSION || '1.0';
}

function detectWebApiBase() {
  if (typeof window === 'undefined' || !window.location) return '';
  const loc = window.location;
  // Emergent preview / dev environment: ingress routes /api on same origin.
  if (loc.hostname && /(^|\.)emergentagent\.com$/i.test(loc.hostname)) {
    return loc.origin;
  }
  // Production LAN pattern: frontend on :3000, backend on :8001, same host.
  // Covers Main Server and every web Client PC without any hard-coded IP.
  return `${loc.protocol}//${loc.hostname || '127.0.0.1'}:8001`;
}

// Server base WITHOUT the trailing /api. Desktop: from the AppData config.
export const API_BASE = (() => {
  const r = getRuntime();
  return r ? r.serverBase : detectWebApiBase();
})();

// Origin for links that must open on the school's web pages (receipt QR codes,
// parent lookup links, kiosk poster). The desktop client itself has no origin
// of its own that other devices could open, so it uses the Main Server's web
// address from the same config.
export function appOrigin() {
  const r = getRuntime();
  if (r) return r.frontendBase;
  return typeof window !== 'undefined' && window.location ? window.location.origin : '';
}
