// Service worker for Firebase Cloud Messaging background pushes.
// Keep this file at /firebase-messaging-sw.js (root of the web host)
// so firebase.js can find it automatically.

/* eslint-disable no-undef */
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

// Background push → show a system notification.
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

// Click → focus the app if open, else open it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsList) {
      if ('focus' in c) { c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow('/');
  })());
});
