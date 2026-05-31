const PRECACHE_URLS = ["/assets/db-B1yNvOyE.js","/assets/dialogs-C8pXuQ48.js","/assets/e2e_core-D_9vyewO.js","/assets/e2e_core-DlIKFwdC.js","/assets/e2e_core_bg-B1xls2O6.wasm","/assets/gossip-DLRLzjZC.js","/assets/index-BcNEYsQr.js","/assets/index-CNh5uWQ-.css","/assets/map-DVGrs5b1.js","/assets/media-worker-DCXgtr1S.js","/assets/relay-BACxq_kz.js","/assets/rolldown-runtime-S-ySWqyJ.js","/assets/state-CgoyYCYF.js","/assets/video-compress-7-wl32Fj.js","/bgm.mp3","/globe.svg","/icon-192.png","/icon-512.png","/index.html","/leaflet/MarkerCluster.Default.css","/leaflet/MarkerCluster.css","/leaflet/images/layers-2x.png","/leaflet/images/layers.png","/leaflet/images/marker-icon-2x.png","/leaflet/images/marker-icon.png","/leaflet/images/marker-shadow.png","/leaflet/images/spritesheet-2x.png","/leaflet/images/spritesheet.png","/leaflet/images/spritesheet.svg","/leaflet/leaflet.css","/leaflet/leaflet.draw.css","/leaflet/leaflet.draw.js","/leaflet/leaflet.js","/leaflet/leaflet.markercluster.js","/manifest.json"];
const APP_CACHE = "pins-app-ea30b9d1";
const TILE_CACHE = "pins-tiles-__VERSION__";
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
          .filter((k) => k !== APP_CACHE && !k.startsWith("pins-tiles"))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isTileHost(hostname) {
  return hostname === "tile.openstreetmap.org"
    || hostname.endsWith(".tile.openstreetmap.org")
    || hostname === "server.arcgisonline.com";
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  if (e.request.method !== "GET") return;

  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok && res.type !== "opaqueredirect") {
            const clone = res.clone();
            clone.text().then((body) => {
              if (body.length < 5_000_000) {
                caches.open(APP_CACHE).then((c) => c.put(e.request, new Response(body, { headers: res.headers })));
              }
            });
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then((r) => r || caches.match("/index.html"))
        )
    );
    return;
  }

  if (isTileHost(url.hostname)) {
    e.respondWith(handleTileRequest(e.request));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".wasm")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
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
