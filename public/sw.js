const CACHE_NAME = "tm-rental-v1";
const ASSETS = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // API požadavky vždy posílej na síť
  if (e.request.url.includes("/api/")) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Ostatní — nejdřív cache, pak síť
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});
