// Zenith Fitness — unified service worker.
//
// One SW at scope `/` handles both PWA caching AND Firebase Cloud Messaging
// background pushes. Previously we registered /sw.js (this file) and
// /firebase-messaging-sw.js separately, both at scope `/`. Two SWs on the
// same scope race each other and FCM's getToken() bails out with
// "AbortError: Registration failed - push service error". Merging them
// removes the conflict.

const CACHE_NAME = 'zenith-fitness-v3';
const urlsToCache = ['/', '/index.html', '/manifest.json'];

// ---------- Firebase Cloud Messaging ----------
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBUuyPSwfCVm98ArAY1wCZioBXn2mqFCrs',
  authDomain: 'zenith-fitness-18e2a.firebaseapp.com',
  projectId: 'zenith-fitness-18e2a',
  storageBucket: 'zenith-fitness-18e2a.firebasestorage.app',
  messagingSenderId: '263741998199',
  appId: '1:263741998199:web:997b62caecb7d65e83f272',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Zenith Fitness';
  const body = payload.notification?.body || '';
  self.registration.showNotification(title, {
    body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: payload.data || {},
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // FCM notifications from api/push.ts carry a `data` object: { chatId,
  // type, fromUid, fromName } for chat pushes. We forward it to the
  // foreground client (warm-start) via postMessage, or encode it into the
  // URL query when cold-starting a new window.
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsList) {
      if ('focus' in c) {
        try { c.postMessage({ type: 'zenith-push-tap', data }); } catch { /* ignore */ }
        c.focus();
        return;
      }
    }
    if (self.clients.openWindow) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string') params.append(k, v);
      }
      const target = params.toString() ? '/?' + params.toString() : '/';
      await self.clients.openWindow(target);
    }
  })());
});

// ---------- PWA lifecycle + cache ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Purge old caches.
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
    );
    // Unregister the legacy firebase-messaging-sw.js if it's still around
    // from an older version of the app (pre-3.14.10). Two SWs at the same
    // scope are what caused the original push registration failure.
    try {
      const regs = await self.registration.navigationPreload
        ? await (self.registration.constructor).prototype.getRegistrations?.call?.(self)
        : null;
      // registration.getRegistrations() isn't available inside a SW; the
      // cleanup below is driven by the page via main.tsx instead.
      void regs;
    } catch { /* best-effort */ }
    await self.clients.claim();
  })());
});

// Fetch handler constraints:
//  1. Cache API's put() only accepts GET — skip POST/PUT/DELETE.
//  2. Don't intercept cross-origin (Firestore long-polling, FCM, Vercel).
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
            .catch(() => { /* partial / opaque — ignore */ });
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
