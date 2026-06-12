const PRECACHE_URLS = ["/_app/immutable/assets/0.DexzoIBG.css","/_app/immutable/assets/2.DV2hPiWQ.css","/_app/immutable/assets/e2e_core_bg.B1xls2O6.wasm","/_app/immutable/assets/spatial.DxgiBsj4.wasm","/_app/immutable/chunks/5HGvD4mC.js","/_app/immutable/chunks/B1MKqRyd.js","/_app/immutable/chunks/B3Co8RKf.js","/_app/immutable/chunks/BcgnSMxp.js","/_app/immutable/chunks/Ben4RzYs.js","/_app/immutable/chunks/BsNJBVWV.js","/_app/immutable/chunks/Bse9PeMV.js","/_app/immutable/chunks/By9qoAPx.js","/_app/immutable/chunks/ByPWl-Qi.js","/_app/immutable/chunks/CDh-FXPk.js","/_app/immutable/chunks/CH2yYhPT.js","/_app/immutable/chunks/CHYlLPFS.js","/_app/immutable/chunks/CcsEjxt5.js","/_app/immutable/chunks/Cfcd-euX.js","/_app/immutable/chunks/CrySnDhn.js","/_app/immutable/chunks/CzoXcWn6.js","/_app/immutable/chunks/D3pZvi_n.js","/_app/immutable/chunks/DCWE6aTN.js","/_app/immutable/chunks/DEpgfowR.js","/_app/immutable/chunks/DLrj19aL.js","/_app/immutable/chunks/DTRZRE9N.js","/_app/immutable/chunks/DWkzy1pr.js","/_app/immutable/chunks/DXLwiZ0H.js","/_app/immutable/chunks/DfN8ju9M.js","/_app/immutable/chunks/Du55-6hi.js","/_app/immutable/chunks/PIQn-V7q.js","/_app/immutable/chunks/Ts0_UT6m.js","/_app/immutable/chunks/YsMhJ9Yf.js","/_app/immutable/chunks/c4SXZ9H0.js","/_app/immutable/chunks/mpwl69JD.js","/_app/immutable/chunks/zrEGtcD9.js","/_app/immutable/entry/app.uZaoYNd2.js","/_app/immutable/entry/start.6fh-XOuK.js","/_app/immutable/nodes/0.CX-5cxdY.js","/_app/immutable/nodes/1.Dig3RP3K.js","/_app/immutable/nodes/2.PWdStv7C.js","/_app/immutable/workers/media-worker-DUY193N4.js","/_app/immutable/workers/video-compress-Dq4L46gL.js","/_app/version.json","/bgm.mp3","/globe.svg","/icon-192.png","/icon-512.png","/index.html","/leaflet/MarkerCluster.Default.css","/leaflet/MarkerCluster.css","/leaflet/images/layers-2x.png","/leaflet/images/layers.png","/leaflet/images/marker-icon-2x.png","/leaflet/images/marker-icon.png","/leaflet/images/marker-shadow.png","/leaflet/images/spritesheet-2x.png","/leaflet/images/spritesheet.png","/leaflet/images/spritesheet.svg","/leaflet/leaflet-maplibre-gl.js","/leaflet/leaflet.css","/leaflet/leaflet.draw.css","/leaflet/leaflet.draw.js","/leaflet/leaflet.js","/leaflet/leaflet.markercluster.js","/manifest.json"];
const APP_CACHE = "pins-app-d6672d63";
const TILE_CACHE = "pins-tiles-d6672d63";
const TILE_MAX = 5000;

// LRU tracking: URL string → last-access timestamp
let _tileAccess = new Map();

self.addEventListener("install", (e) => {
  self.skipWaiting();
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

  // Pass through range requests for PMTiles without caching
  if (e.request.headers.has("Range")) return;

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
  const reqKey = request.url;

  return caches.open(TILE_CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      if (cached) {
        _tileAccess.set(reqKey, Date.now());
        return cached;
      }
      return fetch(request).then((res) => {
        if (res.ok) {
          cache.put(request, res.clone());
          _tileAccess.set(reqKey, Date.now());
          // LRU eviction: remove least-recently-accessed tiles when over limit
          cache.keys().then((keys) => {
            const excess = keys.length - TILE_MAX;
            if (excess > 0) {
              // Build list of (key, timestamp) for all cached tiles
              const now = Date.now();
              const entries = keys.map((k) => {
                const u = new URL(k.url);
                return { key: k, ts: _tileAccess.get(u.href) || 0 };
              });
              // Sort by timestamp ascending (oldest access first)
              entries.sort((a, b) => a.ts - b.ts);
              // Evict the oldest
              const toEvict = entries.slice(0, Math.min(excess, entries.length));
              for (const e of toEvict) {
                cache.delete(e.key);
                _tileAccess.delete(new URL(e.key.url).href);
              }
            }
            // Periodically clean LRU map of stale entries
            if (_tileAccess.size > TILE_MAX * 2) {
              const keep = new Set(keys.map(k => new URL(k.url).href));
              for (const k of _tileAccess.keys()) {
                if (!keep.has(k)) _tileAccess.delete(k);
              }
            }
          });
        }
        return res;
      });
    })
  );
}
