import { o as getAllCommunities, p as getCommunity } from "./db2.js";
import { t as state } from "./state.js";
import { t as DeferredBoundedMap } from "./store-helpers.js";
//#region gossip.js
var _gossipListeners = /* @__PURE__ */ new Map();
var _gossipMultiHandler = (resp) => {
	for (const [qid, cb] of _gossipListeners) try {
		cb(resp);
	} catch (_) {}
};
var _discoveryCache = null;
function getDiscoveryCache() {
	if (!_discoveryCache) _discoveryCache = new DeferredBoundedMap(500, 6e5);
	return _discoveryCache;
}
if (typeof window !== "undefined") window._gossipResponseHandler = _gossipMultiHandler;
async function buildCapabilityAnnounce() {
	const communities = [];
	const allIds = Object.keys(window._names || {});
	for (const cid of allIds) try {
		const c = await getCommunity(cid);
		if (c && c.visibility && c.visibility !== "private" && c.visibility !== "local") communities.push({
			community_id: c.community_id,
			name: c.name,
			bounds: c.bounds,
			governance: c.governance,
			access: (c.governance?.contribution || "open") === "open" ? "open" : "request"
		});
	} catch (_) {}
	return {
		type: "gossip_capabilities",
		peer_id: state.signingPublicKey || "anon",
		communities,
		ts: Date.now()
	};
}
async function sendCapabilityAnnounce(targetConnId) {
	const announce = await buildCapabilityAnnounce();
	if (announce.communities.length === 0) return;
	window._broadcast?.("gossip_capabilities", announce, targetConnId);
	_meshBroadcast?.("gossip_capabilities", announce);
}
function handleCapabilityAnnounce(msg) {
	if (!msg || !msg.communities) return;
	for (const c of msg.communities) {
		const key = c.community_id;
		const existing = getDiscoveryCache().get(key);
		if (!existing || existing.ts < msg.ts) getDiscoveryCache().set(key, {
			...c,
			ts: msg.ts,
			peer_id: msg.peer_id
		});
	}
	window._renderUI?.();
}
function bboxesOverlap(b1, b2) {
	if (!b1 || !b2 || b1.length !== 4 || b2.length !== 4) return false;
	const [s1, w1, n1, e1] = b1;
	const [s2, w2, n2, e2] = b2;
	return !(e1 < w2 || e2 < w1 || n1 < s2 || n2 < s1);
}
var _markerGrid = /* @__PURE__ */ new Map();
var CELL = .5;
function _cellKey(lat, lng) {
	return `${lat / CELL | 0},${lng / CELL | 0}`;
}
function queryMarkersInBbox(bbox) {
	const [s, w, n, e] = bbox;
	const seen = /* @__PURE__ */ new Set();
	const results = [];
	const minLat = Math.floor(s / CELL) * CELL;
	const minLng = Math.floor(w / CELL) * CELL;
	for (let lat = minLat; lat <= n + CELL; lat += CELL) for (let lng = minLng; lng <= e + CELL; lng += CELL) {
		const cell = _markerGrid.get(_cellKey(lat, lng));
		if (cell) for (const m of cell) {
			const id = m._leaflet_id ?? m;
			if (seen.has(id)) continue;
			seen.add(id);
			const ll = m.getLatLng();
			if (ll && ll.lat >= s && ll.lat <= n && ll.lng >= w && ll.lng <= e) results.push(m);
		}
	}
	return results;
}
async function handleQuery(query, fromConnId) {
	if (!query.bbox || query.bbox.length !== 4) return;
	const results = [];
	const communities = await getAllCommunities();
	query.categories;
	query.min_trust;
	const maxAge = query.max_age || 7 * 864e5;
	const ageThreshold = maxAge > 0 ? Date.now() - maxAge : 0;
	for (const c of communities) {
		if (!c.bounds || !bboxesOverlap(query.bbox, c.bounds)) continue;
		if (!c.visibility || c.visibility === "private" || c.visibility === "local") continue;
		let pinCount = 0;
		let drawingCount = 0;
		let lastUpdated = c.last_updated || 0;
		let categorySet = /* @__PURE__ */ new Set();
		if (c.community_id === state.currentSet && state.markers && state.markers.length > 0) {
			for (const marker of queryMarkersInBbox(query.bbox)) {
				if (ageThreshold > 0 && marker._pinCreatedAt && marker._pinCreatedAt < ageThreshold) continue;
				pinCount++;
				if (marker._pinCreatedAt && marker._pinCreatedAt > lastUpdated) lastUpdated = marker._pinCreatedAt;
				if (marker._schemaId) {
					const schema = (state.schemas || []).find((s) => s.schema_id === marker._schemaId);
					if (schema) categorySet.add(schema.name);
				}
			}
			for (const dl of state.drawingLayers) try {
				const db = dl.getBounds();
				if (db) {
					const [s, w, n, e] = query.bbox;
					const ds = db.getSouth(), dw = db.getWest(), dn = db.getNorth();
					if (!(db.getEast() < w || e < dw || dn < s || n < ds)) {
						drawingCount++;
						if (dl._drawingCreatedAt && dl._drawingCreatedAt > lastUpdated) lastUpdated = dl._drawingCreatedAt;
					}
				}
			} catch (_) {}
		} else pinCount = -1;
		results.push({
			community_id: c.community_id,
			name: c.name,
			pin_count: pinCount >= 0 ? pinCount : "?",
			drawing_count: drawingCount,
			bounds: c.bounds,
			access: c.governance?.contribution === "open" ? "open" : "request",
			categories: [...categorySet],
			last_updated: lastUpdated || null,
			has_public_layers: c.governance?.public_subscriptions === "anyone"
		});
	}
	if (results.length > 0) {
		const resp = {
			type: "gossip_response",
			results,
			query_bbox: query.bbox
		};
		window._broadcast?.("gossip_response", resp);
		_meshBroadcast?.("gossip_response", resp);
	}
}
var _meshBroadcast = null;
function setGossipMeshBroadcast(cb) {
	_meshBroadcast = cb;
}
//#endregion
export { buildCapabilityAnnounce, handleCapabilityAnnounce, handleQuery, sendCapabilityAnnounce, setGossipMeshBroadcast };
