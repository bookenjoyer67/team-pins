//#region db.js
var DB_NAME = "team-pins";
var DB_VERSION = 13;
var db = null;
var _migrationSigningPubkey = null;
function setMigrationSigningPubkey(pubkey) {
	_migrationSigningPubkey = pubkey;
}
var _dbPromise = null;
function openDB() {
	if (_dbPromise) return _dbPromise;
	_dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (e) => {
			const d = e.target.result;
			const oldVersion = e.oldVersion;
			if (!d.objectStoreNames.contains("pins")) d.createObjectStore("pins", { keyPath: "pin_id" }).createIndex("team_id", "team_id", { unique: false });
			else {
				const pins = e.target.transaction.objectStore("pins");
				if (!pins.indexNames.contains("team_id")) pins.createIndex("team_id", "team_id", { unique: false });
				if (!pins.indexNames.contains("layer_id")) pins.createIndex("layer_id", "layer_id", { unique: false });
			}
			if (!d.objectStoreNames.contains("drawings")) d.createObjectStore("drawings", { keyPath: "drawing_id" }).createIndex("team_id", "team_id", { unique: false });
			else {
				const drawings = e.target.transaction.objectStore("drawings");
				if (!drawings.indexNames.contains("team_id")) drawings.createIndex("team_id", "team_id", { unique: false });
				if (!drawings.indexNames.contains("layer_id")) drawings.createIndex("layer_id", "layer_id", { unique: false });
			}
			if (!d.objectStoreNames.contains("teams")) d.createObjectStore("teams", { keyPath: "team_id" });
			if (!d.objectStoreNames.contains("profile")) d.createObjectStore("profile", { keyPath: "key" });
			if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", { keyPath: "team_id" });
			if (!d.objectStoreNames.contains("known_peers")) d.createObjectStore("known_peers", { keyPath: "user_id" });
			if (!d.objectStoreNames.contains("layers")) d.createObjectStore("layers", { keyPath: "team_id" });
			if (!d.objectStoreNames.contains("schemas")) d.createObjectStore("schemas", { keyPath: "schema_id" }).createIndex("team_id", "team_id", { unique: false });
			if (!d.objectStoreNames.contains("communities")) d.createObjectStore("communities", { keyPath: "community_id" });
			if (!d.objectStoreNames.contains("annotations")) {
				const ann = d.createObjectStore("annotations", { keyPath: "annotation_id" });
				ann.createIndex("pin_id", "pin_id", { unique: false });
				ann.createIndex("community_id", "community_id", { unique: false });
			}
			if (!d.objectStoreNames.contains("tombstones")) d.createObjectStore("tombstones", { keyPath: "tombstone_id" }).createIndex("target_id", "target_id", { unique: false });
			if (!d.objectStoreNames.contains("subscribed_layers")) d.createObjectStore("subscribed_layers", { keyPath: "source_layer_id" });
			if (!d.objectStoreNames.contains("layer_deks")) d.createObjectStore("layer_deks", { keyPath: "layer_dek_id" });
			if (!d.objectStoreNames.contains("chains")) d.createObjectStore("chains", { keyPath: "chain_id" }).createIndex("community_id", "community_id", { unique: false });
			if (!d.objectStoreNames.contains("offline_regions")) d.createObjectStore("offline_regions", { keyPath: "id" });
			if (!d.objectStoreNames.contains("collections")) d.createObjectStore("collections", { keyPath: "collection_id" });
			if (!d.objectStoreNames.contains("collection_pins")) d.createObjectStore("collection_pins", { keyPath: "id" }).createIndex("collection_id", "collection_id", { unique: false });
			if (oldVersion < 8 && d.objectStoreNames.contains("teams") && d.objectStoreNames.contains("communities")) {
				const teamsStore = e.target.transaction.objectStore("teams");
				const communitiesStore = e.target.transaction.objectStore("communities");
				teamsStore.openCursor().onsuccess = (ev) => {
					const cursor = ev.target.result;
					if (cursor) {
						const team = cursor.value;
						communitiesStore.put({
							community_id: team.team_id,
							name: team.name || team.team_id.slice(0, 8),
							description: "",
							genesis_public_key: _migrationSigningPubkey || "",
							genesis_created_at: Date.now(),
							members: _migrationSigningPubkey ? [{
								pubkey: _migrationSigningPubkey,
								display_name: "Founder",
								role: "founder",
								joined_at: Date.now(),
								vouched_by: null
							}] : [],
							governance: {
								contribution: "open",
								validation: "none",
								schema_authority: "any_member",
								key_rotation: "founder_only",
								fork_policy: "allowed",
								join_policy: "open"
							},
							bounds: null,
							relay_nodes: []
						});
						cursor.continue();
					}
				};
			}
		};
		req.onsuccess = (e) => {
			db = e.target.result;
			resolve(db);
		};
		req.onerror = () => {
			_dbPromise = null;
			reject(req.error);
		};
		let _retryCount = 0;
		req.onblocked = () => {
			_dbPromise = null;
			if (_retryCount < 5) {
				_retryCount++;
				setTimeout(() => openDB().then(resolve).catch(reject), 300 * _retryCount);
			} else {
				_retryCount = 0;
				reject(/* @__PURE__ */ new Error("Database blocked by another connection"));
			}
		};
		setTimeout(() => {
			if (!db) {
				_dbPromise = null;
				reject(/* @__PURE__ */ new Error("Database open timed out"));
			}
		}, 3e4);
	});
	return _dbPromise;
}
function tx(store, mode = "readonly") {
	try {
		return db.transaction(store, mode).objectStore(store);
	} catch (e) {
		db = null;
		_dbPromise = null;
		throw e;
	}
}
function promisify(request) {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
async function getPins(teamId) {
	await openDB();
	return promisify(tx("pins").index("team_id").getAll(teamId));
}
async function getPin(pinId) {
	await openDB();
	return promisify(tx("pins").get(pinId));
}
async function savePin(pin) {
	await openDB();
	return promisify(tx("pins", "readwrite").put(pin));
}
async function deletePin(pinId) {
	await openDB();
	return promisify(tx("pins", "readwrite").delete(pinId));
}
async function getDrawings(teamId) {
	await openDB();
	return promisify(tx("drawings").index("team_id").getAll(teamId));
}
async function saveDrawing(drawing) {
	await openDB();
	return promisify(tx("drawings", "readwrite").put(drawing));
}
async function getDrawing(drawingId) {
	await openDB();
	return promisify(tx("drawings").get(drawingId));
}
async function deleteDrawing(drawingId) {
	await openDB();
	return promisify(tx("drawings", "readwrite").delete(drawingId));
}
async function getTeam(teamId) {
	await openDB();
	return promisify(tx("teams").get(teamId));
}
async function saveTeam(team) {
	await openDB();
	return promisify(tx("teams", "readwrite").put(team));
}
async function getCommunity(communityId) {
	await openDB();
	return promisify(tx("communities").get(communityId));
}
async function getAllCommunities() {
	await openDB();
	return promisify(tx("communities").getAll());
}
async function saveCommunity(community) {
	await openDB();
	return promisify(tx("communities", "readwrite").put(community));
}
async function getAnnotationsByPin(pinId, offset = 0, limit = 20) {
	await openDB();
	return (await promisify(tx("annotations").index("pin_id").getAll(pinId))).sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(offset, offset + limit);
}
async function saveAnnotation(annotation) {
	await openDB();
	return promisify(tx("annotations", "readwrite").put(annotation));
}
async function getAnnotation(annotationId) {
	await openDB();
	return promisify(tx("annotations").get(annotationId));
}
async function getAnnotationsByCommunity(communityId) {
	await openDB();
	return promisify(tx("annotations").index("community_id").getAll(communityId));
}
async function saveTombstone(tombstone) {
	await openDB();
	return promisify(tx("tombstones", "readwrite").put(tombstone));
}
async function saveLayers(teamId, layersArray) {
	await openDB();
	return promisify(tx("layers", "readwrite").put({
		team_id: teamId,
		layers: layersArray
	}));
}
async function getSchemas() {
	await openDB();
	if (!db.objectStoreNames.contains("schemas")) return [];
	return promisify(tx("schemas").getAll());
}
async function saveSchema(schema) {
	await openDB();
	if (!db.objectStoreNames.contains("schemas")) return;
	return promisify(tx("schemas", "readwrite").put(schema));
}
async function getProfile() {
	await openDB();
	return promisify(tx("profile").get("me"));
}
async function saveProfile(profile) {
	await openDB();
	profile.key = "me";
	return promisify(tx("profile", "readwrite").put(profile));
}
async function getSigningKey() {
	await openDB();
	const p = await promisify(tx("profile").get("me"));
	if (p && p.signing_public_key && p.signing_secret_key) return {
		public: p.signing_public_key,
		secret: p.signing_secret_key
	};
	return null;
}
async function saveSigningKey(kp) {
	await openDB();
	const profile = await promisify(tx("profile").get("me")).catch(() => null) || {
		key: "me",
		user_id: generateUUIDCompat(),
		display_name: "Me"
	};
	profile.signing_public_key = kp.public;
	profile.signing_secret_key = kp.secret;
	return promisify(tx("profile", "readwrite").put(profile));
}
function generateUUIDCompat() {
	return crypto.randomUUID();
}
async function getSettings(teamId) {
	await openDB();
	return promisify(tx("settings").get(teamId));
}
async function saveSettings(teamId, settings) {
	await openDB();
	settings.team_id = teamId;
	return promisify(tx("settings", "readwrite").put(settings));
}
async function getKnownPeers() {
	await openDB();
	return promisify(tx("known_peers").getAll());
}
async function saveKnownPeer(peer) {
	await openDB();
	return promisify(tx("known_peers", "readwrite").put(peer));
}
async function getAllPins(teamId) {
	return getPins(teamId);
}
async function getAllDrawings(teamId) {
	return getDrawings(teamId);
}
async function importPin(pin) {
	return savePin(pin);
}
async function importDrawing(drawing) {
	return saveDrawing(drawing);
}
async function saveSubscribedLayer(sub) {
	await openDB();
	return promisify(tx("subscribed_layers", "readwrite").put(sub));
}
async function getSubscribedLayer(layerId) {
	await openDB();
	return promisify(tx("subscribed_layers").get(layerId));
}
function upgradeChain(chain) {
	if (!chain) return chain;
	if (chain.pin_entries && Array.isArray(chain.pin_entries) && chain.pin_entries.length > 0) chain.pin_ids = chain.pin_entries.map((e) => e.pin_id);
	else if (chain.pin_ids && Array.isArray(chain.pin_ids)) chain.pin_entries = chain.pin_ids.map((pid) => ({
		pin_id: pid,
		narrative: "",
		audio_ciphertext: null,
		audio_nonce: null,
		audio_type: null
	}));
	else {
		chain.pin_entries = [];
		chain.pin_ids = [];
	}
	for (const entry of chain.pin_entries) if (!entry.branches) entry.branches = [];
	if (!chain.description && chain.description !== "") chain.description = "";
	if (!chain.cover_pin_id && chain.cover_pin_id !== null) chain.cover_pin_id = null;
	if (!chain.author_pubkey && chain.author_pubkey !== "") chain.author_pubkey = "";
	if (!chain.author_display_name && chain.author_display_name !== "") chain.author_display_name = "";
	if (!chain.tags) chain.tags = [];
	if (!chain.updated_at) chain.updated_at = chain.created_at || Date.now();
	return chain;
}
async function saveChain(chain) {
	await openDB();
	const normalized = upgradeChain(chain);
	normalized.updated_at = Date.now();
	return promisify(tx("chains", "readwrite").put(normalized));
}
async function getChainsByCommunity(communityId) {
	await openDB();
	return (await promisify(tx("chains").index("community_id").getAll(communityId))).map(upgradeChain);
}
async function deleteChain(chainId) {
	await openDB();
	return promisify(tx("chains", "readwrite").delete(chainId));
}
async function importPins(pins) {
	if (!pins.length) return;
	await openDB();
	const store = tx("pins", "readwrite");
	const ops = pins.map((p) => promisify(store.put(p)));
	return Promise.all(ops);
}
async function importDrawings(drawings) {
	if (!drawings.length) return;
	await openDB();
	const store = tx("drawings", "readwrite");
	const ops = drawings.map((d) => promisify(store.put(d)));
	return Promise.all(ops);
}
async function saveAnnotations(annotations) {
	if (!annotations.length) return;
	await openDB();
	const store = tx("annotations", "readwrite");
	const ops = annotations.map((a) => promisify(store.put(a)));
	return Promise.all(ops);
}
async function deletePins(pinIds) {
	if (!pinIds.length) return;
	await openDB();
	const store = tx("pins", "readwrite");
	const ops = pinIds.map((id) => promisify(store.delete(id)));
	return Promise.all(ops);
}
async function deleteDrawings(drawingIds) {
	if (!drawingIds.length) return;
	await openDB();
	const store = tx("drawings", "readwrite");
	const ops = drawingIds.map((id) => promisify(store.delete(id)));
	return Promise.all(ops);
}
//#endregion
export { saveAnnotations as A, saveSigningKey as B, getSubscribedLayer as C, importPin as D, importDrawings as E, saveLayers as F, saveTeam as H, savePin as I, saveProfile as L, saveCommunity as M, saveDrawing as N, importPins as O, saveKnownPeer as P, saveSchema as R, getSigningKey as S, importDrawing as T, saveTombstone as U, saveSubscribedLayer as V, setMigrationSigningPubkey as W, getPin as _, deletePins as a, getSchemas as b, getAllPins as c, getAnnotationsByPin as d, getChainsByCommunity as f, getKnownPeers as g, getDrawings as h, deletePin as i, saveChain as j, saveAnnotation as k, getAnnotation as l, getDrawing as m, deleteDrawing as n, getAllCommunities as o, getCommunity as p, deleteDrawings as r, getAllDrawings as s, deleteChain as t, getAnnotationsByCommunity as u, getPins as v, getTeam as w, getSettings as x, getProfile as y, saveSettings as z };
