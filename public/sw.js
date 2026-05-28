const PRECACHE_URLS = __PRECACHE_URLS__;
const APP_CACHE = "pins-app-__VERSION__";
const TILE_CACHE = "pins-tiles-v1";
const TILE_MAX = 200;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(APP_CACHE).then((cache) => {
      const valid = PRECACHE_URLS.filter((u) => u && u !== "__PRECACHE_URLS__");
      if (!valid.length) return;
      return cache.addAll(valid).catch((err) => {
        console.warn("[sw] precache addAll error:", err.message);
      });
    })
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== "GET") return;

  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok && res.type !== "opaqueredirect") {
            const clone = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then((r) => r || caches.match("/index.html"))
        )
    );
    return;
  }

  if (
    url.hostname.includes("tile.openstreetmap.org") ||
    url.hostname.includes("server.arcgisonline.com")
  ) {
    e.respondWith(handleTileRequest(e.request));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".wasm")) {
    e.respondWith(
      caches.match(e.request).then((r) => {
        if (r) return r;
        return fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(APP_CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((r) => r || caches.match("/index.html"))
      )
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function handleTileRequest(request) {
  return caches.open(TILE_CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          cache.put(request, res.clone());
          cache.keys().then((keys) => {
            if (keys.length > TILE_MAX) {
              for (let i = 0; i < keys.length - TILE_MAX; i++) {
                cache.delete(keys[i]);
              }
            }
          });
        }
        return res;
      });
    })
  );
}
