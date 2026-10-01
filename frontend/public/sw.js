/**
 * Balaji FeeHub - minimal offline app-shell cache.
 *
 * Purpose: let the Client (Electron shell) open the real app UI even when
 * the Main Server is completely unreachable at the moment of launch, as
 * long as this browser profile has loaded the app at least once before.
 * This is ONLY an app-shell (HTML/JS/CSS) cache - it never touches /api/
 * requests, which must always go straight to the network so the existing
 * sync engine (lib/syncEngine.js) sees real failures and drives its own
 * Offline/Online status correctly. No business logic lives here.
 *
 * Strategy for same-origin GET requests (except /api/*): network-first,
 * falling back to the last-cached copy on failure, and always refreshing
 * the cache from a successful network response so the offline copy never
 * gets far out of date.
 */
const CACHE_NAME = 'feehub-shell-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Navigation fallback: if the exact URL was never cached but the
          // app shell itself was (e.g. first visit to a deep link), still
          // serve the cached shell instead of a hard failure.
          if (req.mode === 'navigate') return caches.match('/');
          return Promise.reject(new Error('offline and not cached'));
        })
      )
  );
});
