const CACHE = 'hesabat-v1';
const ASSETS = ['/', '/pos.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first — always fresh data
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
