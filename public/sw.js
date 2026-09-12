/* SANTARA — Service Worker (PWA offline shell + push notification) */
const VERSION = 'santara-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/map.js',
  './js/core.js',
  './js/screens.js',
  './js/app.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/marker-icon.png',
  './vendor/leaflet/marker-shadow.png',
  './assets/logo.png',
  './assets/hero-ride.jpg',
  './assets/logo-mark.png',
  './assets/fonts/Poppins-700.ttf',
  './assets/fonts/Poppins-900.ttf',
  './assets/fonts/Orbitron-900.ttf',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-64.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL).catch(() => null)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API & realtime: selalu jaringan
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
  // pihak ketiga (tile peta, google maps): hanya jaringan
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'SANTARA' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'SANTARA', {
    body: d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/favicon-64.png',
    vibrate: [120, 60, 120],
    data: d.data || {}
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.focus(); c.postMessage({ t: 'notificationclick', orderId: e.notification.data && e.notification.data.orderId }); return; }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.t === 'notify' && self.registration.showNotification) {
    self.registration.showNotification(e.data.title, {
      body: e.data.body, icon: './icons/icon-192.png', badge: './icons/favicon-64.png',
      vibrate: [120, 60, 120], data: e.data.data || {}
    });
  }
});
