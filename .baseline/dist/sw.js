self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('urlf-up-v1').then((cache) => cache.addAll(['./', './manifest.json'])));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((response) => response || fetch(e.request)));
});