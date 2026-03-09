const CACHE_NAME = "tm-rental-v2";

self.addEventListener("install", (e) => {
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

  // Network-first: zkus síť, pokud selže, použij cache
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Ulož novou verzi do cache
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return response;
      })
      .catch(() => {
        // Offline — použij cache
        return caches.match(e.request);
      })
  );
});
