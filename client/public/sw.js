/* Offline-first service worker.
 *
 *  - App shell + built assets: cache-first (they are content-hashed).
 *  - GET /api/...            : network-first, falling back to the last good
 *                              response so the till keeps showing the catalog.
 *  - POST /api/sales         : if the network fails, the page itself queues the
 *                              sale in IndexedDB; the SW just reports failure so
 *                              the app can take over. Background Sync then pings
 *                              the page to flush the queue.
 */
const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

// API GETs worth keeping a copy of for offline use
const CACHEABLE_API = [
  '/api/sync/snapshot',
  '/api/auth/me',
  '/api/settings',
  '/api/locations',
  '/api/products',
  '/api/catalog',
  '/api/customers',
  '/api/registers',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isCacheableApi(url) {
  return CACHEABLE_API.some((p) => url.pathname.startsWith(p));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method !== 'GET') return; // writes are handled by the app's queue

  if (url.pathname.startsWith('/api/')) {
    if (!isCacheableApi(url)) return;
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) {
            const body = await cached.json().catch(() => ({}));
            return new Response(JSON.stringify({ ...body, _offline: true }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ error: 'Offline and nothing cached yet', _offline: true }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
          });
        })
    );
    return;
  }

  // App shell / assets: cache-first, then network, then the shell for navigations.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || SHELL_URLS.includes(url.pathname))) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => (request.mode === 'navigate' ? caches.match('/index.html') : Response.error()));
    })
  );
});

// Background Sync: wake the page so it can replay the offline sale queue.
self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-sales') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'FLUSH_QUEUE' }));
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
