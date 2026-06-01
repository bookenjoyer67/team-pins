const PRECACHE_URLS = ["/assets/db-8O_s-WYM.js","/assets/dialogs-DSx-XCR_.js","/assets/e2e_core-D_9vyewO.js","/assets/e2e_core-DlIKFwdC.js","/assets/e2e_core_bg-B1xls2O6.wasm","/assets/gossip-O4fmqtLA.js","/assets/index-D5Rq8eWm.css","/assets/index-DT5tM0kI.js","/assets/map-dA54UDmf.js","/assets/media-worker-DCXgtr1S.js","/assets/relay-DGRQTenR.js","/assets/rolldown-runtime-S-ySWqyJ.js","/assets/state-DapcEymk.js","/assets/video-compress-7-wl32Fj.js","/bgm.mp3","/globe.svg","/icon-192.png","/icon-512.png","/index.html","/leaflet/MarkerCluster.Default.css","/leaflet/MarkerCluster.css","/leaflet/images/layers-2x.png","/leaflet/images/layers.png","/leaflet/images/marker-icon-2x.png","/leaflet/images/marker-icon.png","/leaflet/images/marker-shadow.png","/leaflet/images/spritesheet-2x.png","/leaflet/images/spritesheet.png","/leaflet/images/spritesheet.svg","/leaflet/leaflet.css","/leaflet/leaflet.draw.css","/leaflet/leaflet.draw.js","/leaflet/leaflet.js","/leaflet/leaflet.markercluster.js","/manifest.json"];
const APP_CACHE = "pins-app-1986631e";
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

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data?.json() || {}; } catch (_) {}
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "piggpin-default",
    data: { url: data.url || "/" },
  };
  e.waitUntil(self.registration.showNotification(data.title || "piggPin", options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
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
