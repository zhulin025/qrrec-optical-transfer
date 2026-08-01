const CACHE = "qrrec-v3-color-v1";
const FILES = [
  "./", "./index.html", "./recv.html",
  "./cimbar_js.2026-07-13T0523.js", "./cimbar_js.2026-07-13T0523.wasm",
  "./main.2026-07-13T0523.js", "./send.2026-07-13T0523.js",
  "./send-worker.2026-07-13T0523.js", "./recv.2026-07-13T0523.js",
  "./recv-worker.2026-07-13T0523.js", "./zstd.2026-07-13T0523.js",
  "./pwa.2026-07-13T0523.json", "./pwa-recv.2026-07-13T0523.json",
  "./icon-192x192.png", "./icon-512x512.png", "./favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("qrrec-v3-color-") && key !== CACHE).map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(
    (cached) => cached || fetch(event.request),
  ));
});
