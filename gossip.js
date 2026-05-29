import * as DB from "./db.js";
import { state } from "./state.js";

const _gossipListeners = new Map(); // queryId → handler
const _gossipMultiHandler = (resp) => {
  for (const [qid, cb] of _gossipListeners) { try { cb(resp); } catch(_) {} }
};
const discoveryCache = new Map();
// Register global handler once
if (typeof window !== "undefined") {
  window._gossipResponseHandler = _gossipMultiHandler;
}

export async function buildCapabilityAnnounce() {
  const communities = [];
  const allIds = Object.keys(window._names || {});
  for (const cid of allIds) {
    try {
      const c = await DB.getCommunity(cid);
      if (c && c.visibility && c.visibility !== "private" && c.visibility !== "local") communities.push({
        community_id: c.community_id,
        name: c.name,
        bounds: c.bounds,
        governance: c.governance,
        access: (c.governance?.contribution || "open") === "open" ? "open" : "request",
      });
    } catch (_) {}
  }
  return {
    type: "gossip_capabilities",
    peer_id: state.signingPublicKey || "anon",
    communities,
    ts: Date.now(),
  };
}

export async function sendCapabilityAnnounce(targetConnId) {
  const announce = await buildCapabilityAnnounce();
  if (announce.communities.length === 0) return;
  window._broadcast?.("gossip_capabilities", announce, targetConnId);
  _meshBroadcast?.("gossip_capabilities", announce);
}

export function handleCapabilityAnnounce(msg) {
  if (!msg || !msg.communities) return;
  const MAX_CACHE = 500;
  for (const c of msg.communities) {
    const key = c.community_id;
    const existing = discoveryCache.get(key);
    if (!existing || existing.ts < msg.ts) {
      if (discoveryCache.size >= MAX_CACHE) {
        const firstKey = discoveryCache.keys().next().value;
        if (firstKey) discoveryCache.delete(firstKey);
      }
      discoveryCache.set(key, { ...c, ts: msg.ts, peer_id: msg.peer_id });
    }
  }
  window._renderUI?.();
}

export async function queryPeers(bbox, categories, minTrust, maxAge) {
  const queryId = crypto.randomUUID ? crypto.randomUUID() : (() => {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return Array.from(a, n => n.toString(36)).join('').slice(0, 36);
  })();
  const payload = {
    type: "gossip_query",
    bbox,
    categories: categories || [],
    min_trust: minTrust || 0.1,
    max_age: maxAge || 7 * 86400000,
  };
  window._broadcast?.("gossip_query", payload);
  _meshBroadcast?.("gossip_query", payload);
  return new Promise(resolve => {
    const gathered = [];
    const timeout = setTimeout(() => {
      _gossipListeners.delete(queryId);
      resolve(gathered);
    }, 5000);
    _gossipListeners.set(queryId, (resp) => { gathered.push(resp); });
  });
}

function bboxesOverlap(b1, b2) {
  if (!b1 || !b2 || b1.length !== 4 || b2.length !== 4) return false;
  const [s1, w1, n1, e1] = b1;
  const [s2, w2, n2, e2] = b2;
  return !(e1 < w2 || e2 < w1 || n1 < s2 || n2 < s1);
}

export async function handleQuery(query, fromConnId) {
  if (!query.bbox || query.bbox.length !== 4) return;
  const results = [];
  const communities = await DB.getAllCommunities();
  const categories = query.categories || [];
  const minTrust = query.min_trust || 0.1;
  const maxAge = query.max_age || 7 * 86400000;
  const now = Date.now();
  const ageThreshold = maxAge > 0 ? now - maxAge : 0;

  for (const c of communities) {
    if (!c.bounds || !bboxesOverlap(query.bbox, c.bounds)) continue;
    if (!c.visibility || c.visibility === "private" || c.visibility === "local") continue;

    let pinCount = 0;
    let drawingCount = 0;
    let lastUpdated = c.last_updated || 0;
    let categorySet = new Set();

    // For the active community, we have decrypted markers with full data
    if (c.community_id === state.currentSet && state.markers) {
      for (const marker of state.markers) {
        const latlng = marker.getLatLng();
        if (!latlng) continue;
        const lat = latlng.lat;
        const lng = latlng.lng;
        const [s, w, n, e] = query.bbox;
        if (lat < s || lat > n || lng < w || lng > e) continue;
        // Age filter
        if (ageThreshold > 0 && marker._pinCreatedAt && marker._pinCreatedAt < ageThreshold) continue;
        pinCount++;
        if (marker._pinCreatedAt && marker._pinCreatedAt > lastUpdated) lastUpdated = marker._pinCreatedAt;
        // Collect categories from schema names
        if (marker._schemaId) {
          const schema = (state.schemas || []).find(s => s.schema_id === marker._schemaId);
          if (schema) categorySet.add(schema.name);
        }
      }
      // Count drawings in bbox
      for (const dl of state.drawingLayers) {
        try {
          const db = dl.getBounds();
          if (db) {
            const [s, w, n, e] = query.bbox;
            const ds = db.getSouth(), dw = db.getWest(), dn = db.getNorth(), de = db.getEast();
            if (!(de < w || e < dw || dn < s || n < ds)) {
              drawingCount++;
              if (dl._drawingCreatedAt && dl._drawingCreatedAt > lastUpdated) lastUpdated = dl._drawingCreatedAt;
            }
          }
        } catch (_) {}
      }
    } else {
      // Non-active community: return metadata only, no pin counts
      pinCount = -1; // signals "unknown" to the client
    }

    results.push({
      community_id: c.community_id,
      name: c.name,
      pin_count: pinCount >= 0 ? pinCount : "?",
      drawing_count: drawingCount,
      bounds: c.bounds,
      access: c.governance?.contribution === "open" ? "open" : "request",
      categories: [...categorySet],
      last_updated: lastUpdated || null,
      has_public_layers: c.governance?.public_subscriptions === "anyone",
    });
  }
  if (results.length > 0) {
    const resp = { type: "gossip_response", results, query_bbox: query.bbox };
    window._broadcast?.("gossip_response", resp);
    _meshBroadcast?.("gossip_response", resp);
  }
}

export function getDiscoveredCommunities() {
  return [...discoveryCache.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export function clearDiscoveryCache() {
  discoveryCache.clear();
}

let _meshBroadcast = null;
export function setGossipMeshBroadcast(cb) { _meshBroadcast = cb; }

let lastPanCenters = [];
const PAN_THRESHOLD = 0.2;

export function notifyMapPan(lat, lng, zoom) {
  if (lastPanCenters.length > 0) {
    const last = lastPanCenters[lastPanCenters.length - 1];
    const dist = Math.sqrt((last.lat - lat) ** 2 + (last.lng - lng) ** 2);
    if (dist < PAN_THRESHOLD / Math.max(zoom, 1)) return;
  }
  lastPanCenters.push({ lat, lng, ts: Date.now() });
  if (lastPanCenters.length > 5) lastPanCenters.shift();
  const pad = 0.05 / Math.max(zoom, 3);
  const bbox = [lat - pad, lng - pad, lat + pad, lng + pad];
  queryPeers(bbox).then(responses => {
    for (const r of responses) {
      if (r.results) {
        for (const disc of r.results) {
          discoveryCache.set(disc.community_id, { ...disc, ts: Date.now() });
        }
        window._showDiscoveryBanner?.(r.results);
      }
    }
  });
}
