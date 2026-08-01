
var _cacheName = 'qrrec-v3-cimbar-send-2026-07-13T0523';
var _cacheFiles = [
  './',
  './index.html',
  './index.html?ww=1',
  './cimbar_js.2026-07-13T0523.js',
  './cimbar_js.2026-07-13T0523.wasm',
  './favicon.ico',
  './icon-192x192.png',
  './icon-512x512.png',
  './main.2026-07-13T0523.js',
  './pwa.2026-07-13T0523.json'
];

// fetch files
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(_cacheName).then(function (cache) {
      return cache.addAll(_cacheFiles);
    })
  );
  self.skipWaiting();
});

// serve from cache
self.addEventListener('fetch', function (e) {
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (response) {
      return response || fetch(e.request);
    })
  );
});

// clean old caches
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.map(function (cn) {
          if (cn.startsWith('qrrec-v3-cimbar-send-') && cn !== _cacheName) {
            return caches.delete(cn);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});
