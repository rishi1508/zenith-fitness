const CACHE_NAME = 'zenith-fitness-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch handler. Two important constraints:
//  1. Cache API's put() only supports GET. Anything else (POST to the
//     Vercel push endpoint, Firestore long-polling, FCM, etc.) MUST be
//     passed through without caching — otherwise the browser throws
//     "Failed to execute 'put' on 'Cache': Request method 'POST' is
//     unsupported".
//  2. Cross-origin responses shouldn't be cached: some are opaque,
//     and we don't want to intercept Firestore/Vercel traffic.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(event.request, responseToCache))
            .catch(() => { /* partial / opaque response — ignore */ });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
