// IndexedDB storage
const DB_NAME = "team-pins";
const DB_VERSION = 13;

let db = null;
let _migrationSigningPubkey = null;

export function setMigrationSigningPubkey(pubkey) {
  _migrationSigningPubkey = pubkey;
}

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      const oldVersion = e.oldVersion;
      if (!d.objectStoreNames.contains("pins")) {
        d.createObjectStore("pins", { keyPath: "pin_id" }).createIndex("team_id", "team_id", { unique: false });
      } else {
        const pins = e.target.transaction.objectStore("pins");
        if (!pins.indexNames.contains("team_id")) {
          pins.createIndex("team_id", "team_id", { unique: false });
        }
        if (!pins.indexNames.contains("layer_id")) {
          pins.createIndex("layer_id", "layer_id", { unique: false });
        }
      }
      if (!d.objectStoreNames.contains("drawings")) {
        d.createObjectStore("drawings", { keyPath: "drawing_id" }).createIndex("team_id", "team_id", { unique: false });
      } else {
        const drawings = e.target.transaction.objectStore("drawings");
        if (!drawings.indexNames.contains("team_id")) {
          drawings.createIndex("team_id", "team_id", { unique: false });
        }
        if (!drawings.indexNames.contains("layer_id")) {
          drawings.createIndex("layer_id", "layer_id", { unique: false });
        }
      }
      if (!d.objectStoreNames.contains("teams")) d.createObjectStore("teams", { keyPath: "team_id" });
      if (!d.objectStoreNames.contains("profile")) d.createObjectStore("profile", { keyPath: "key" });
      if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings", { keyPath: "team_id" });
      if (!d.objectStoreNames.contains("known_peers")) d.createObjectStore("known_peers", { keyPath: "user_id" });
      if (!d.objectStoreNames.contains("layers")) d.createObjectStore("layers", { keyPath: "team_id" });
      if (!d.objectStoreNames.contains("schemas")) {
        d.createObjectStore("schemas", { keyPath: "schema_id" }).createIndex("team_id", "team_id", { unique: false });
      }
      if (!d.objectStoreNames.contains("communities")) {
        d.createObjectStore("communities", { keyPath: "community_id" });
      }
      if (!d.objectStoreNames.contains("annotations")) {
        const ann = d.createObjectStore("annotations", { keyPath: "annotation_id" });
        ann.createIndex("pin_id", "pin_id", { unique: false });
        ann.createIndex("community_id", "community_id", { unique: false });
      }
      if (!d.objectStoreNames.contains("tombstones")) {
        const tom = d.createObjectStore("tombstones", { keyPath: "tombstone_id" });
        tom.createIndex("target_id", "target_id", { unique: false });
      }
      if (!d.objectStoreNames.contains("subscribed_layers")) {
        d.createObjectStore("subscribed_layers", { keyPath: "source_layer_id" });
      }
      if (!d.objectStoreNames.contains("layer_deks")) {
        d.createObjectStore("layer_deks", { keyPath: "layer_dek_id" });
      }
      if (!d.objectStoreNames.contains("chains")) {
        d.createObjectStore("chains", { keyPath: "chain_id" }).createIndex("community_id", "community_id", { unique: false });
      }
      if (!d.objectStoreNames.contains("offline_regions")) {
        d.createObjectStore("offline_regions", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("collections")) {
        d.createObjectStore("collections", { keyPath: "collection_id" });
      }
      if (!d.objectStoreNames.contains("collection_pins")) {
        const cp = d.createObjectStore("collection_pins", { keyPath: "id" });
        cp.createIndex("collection_id", "collection_id", { unique: false });
      }
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
                vouched_by: null,
              }] : [],
              governance: {
                contribution: "open",
                validation: "none",
                schema_authority: "any_member",
                key_rotation: "founder_only",
                fork_policy: "allowed",
                join_policy: "open",
              },
              bounds: null,
              relay_nodes: [],
            });
            cursor.continue();
          }
        };
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => { _dbPromise = null; reject(req.error); };
    let _retryCount = 0;
    req.onblocked = () => {
      _dbPromise = null;
      if (_retryCount < 5) {
        _retryCount++;
        setTimeout(() => openDB().then(resolve).catch(reject), 300 * _retryCount);
      } else {
        _retryCount = 0;
        reject(new Error("Database blocked by another connection"));
      }
    };

    setTimeout(() => {
      if (!db) { _dbPromise = null; reject(new Error("Database open timed out")); }
    }, 30000);
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

// --- pins ---
export async function getPins(teamId) {
  await openDB();
  return promisify(tx("pins").index("team_id").getAll(teamId));
}

export async function getPin(pinId) {
  await openDB();
  return promisify(tx("pins").get(pinId));
}

export async function savePin(pin) {
  await openDB();
  return promisify(tx("pins", "readwrite").put(pin));
}

export async function deletePin(pinId) {
  await openDB();
  return promisify(tx("pins", "readwrite").delete(pinId));
}

export async function updatePinLayerId(pinId, layerId) {
  await openDB();
  const txn = db.transaction("pins", "readwrite");
  const store = txn.objectStore("pins");
  const pin = await promisify(store.get(pinId));
  if (!pin) return;
  pin.layer_id = layerId;
  return promisify(store.put(pin));
}

export async function getPinsByLayer(teamId, layerId) {
  await openDB();
  const all = await promisify(tx("pins").index("team_id").getAll(teamId));
  return all.filter(p => p.layer_id === layerId);
}

// --- drawings ---
export async function getDrawings(teamId) {
  await openDB();
  return promisify(tx("drawings").index("team_id").getAll(teamId));
}

export async function saveDrawing(drawing) {
  await openDB();
  return promisify(tx("drawings", "readwrite").put(drawing));
}

export async function getDrawing(drawingId) {
  await openDB();
  return promisify(tx("drawings").get(drawingId));
}

export async function deleteDrawing(drawingId) {
  await openDB();
  return promisify(tx("drawings", "readwrite").delete(drawingId));
}

export async function updateDrawingLayerId(drawingId, layerId) {
  await openDB();
  const txn = db.transaction("drawings", "readwrite");
  const store = txn.objectStore("drawings");
  const drawing = await promisify(store.get(drawingId));
  if (!drawing) return;
  drawing.layer_id = layerId;
  return promisify(store.put(drawing));
}

// --- teams ---
export async function getTeam(teamId) {
  await openDB();
  return promisify(tx("teams").get(teamId));
}

export async function getAllTeams() {
  await openDB();
  return promisify(tx("teams").getAll());
}

export async function saveTeam(team) {
  await openDB();
  return promisify(tx("teams", "readwrite").put(team));
}

export async function renameTeam(teamId, newName) {
  await openDB();
  const txn = db.transaction("teams", "readwrite");
  const store = txn.objectStore("teams");
  const team = await promisify(store.get(teamId));
  if (!team) return;
  team.name = newName;
  return promisify(store.put(team));
}

export async function deleteTeam(teamId) {
  await openDB();
  const txn = db.transaction(["teams", "pins", "drawings", "settings", "layers", "schemas", "communities", "annotations", "tombstones", "subscribed_layers", "layer_deks", "chains", "offline_regions"], "readwrite");
  const pinKeys = await promisify(txn.objectStore("pins").index("team_id").getAllKeys(teamId));
  for (const key of pinKeys) {
    const annKeys = await promisify(txn.objectStore("annotations").index("pin_id").getAllKeys(key));
    for (const ak of annKeys) {
      const tomKeys = await promisify(txn.objectStore("tombstones").index("target_id").getAllKeys(ak));
      for (const tk of tomKeys) txn.objectStore("tombstones").delete(tk);
      txn.objectStore("annotations").delete(ak);
    }
    txn.objectStore("pins").delete(key);
  }
  const drawingKeys = await promisify(txn.objectStore("drawings").index("team_id").getAllKeys(teamId));
  for (const key of drawingKeys) txn.objectStore("drawings").delete(key);
  txn.objectStore("teams").delete(teamId);
  txn.objectStore("settings").delete(teamId);
  txn.objectStore("layers").delete(teamId);
  txn.objectStore("communities").delete(teamId);
 const chainKeys = await promisify(txn.objectStore("chains").index("community_id").getAllKeys(teamId));
  for (const key of chainKeys) txn.objectStore("chains").delete(key);
  if (txn.objectStoreNames.contains("schemas")) {
    try {
      const schemaKeys = await promisify(txn.objectStore("schemas").index("team_id").getAllKeys(teamId));
      for (const key of schemaKeys) txn.objectStore("schemas").delete(key);
    } catch (_) {}
  }
  return new Promise((resolve, reject) => { txn.oncomplete = resolve; txn.onerror = () => reject(txn.error); });
}

// --- communities ---
export async function getCommunity(communityId) {
  await openDB();
  return promisify(tx("communities").get(communityId));
}

export async function getAllCommunities() {
  await openDB();
  return promisify(tx("communities").getAll());
}

export async function saveCommunity(community) {
  await openDB();
  return promisify(tx("communities", "readwrite").put(community));
}

export async function addCommunityMember(communityId, member) {
  await openDB();
  const txn = db.transaction("communities", "readwrite");
  const store = txn.objectStore("communities");
  const c = await promisify(store.get(communityId));
  if (!c) return null;
  const existing = c.members.findIndex(m => m.pubkey === member.pubkey);
  if (existing >= 0) c.members[existing] = member;
  else c.members.push(member);
  return promisify(store.put(c));
}

export async function removeCommunityMember(communityId, pubkey) {
  await openDB();
  const txn = db.transaction("communities", "readwrite");
  const store = txn.objectStore("communities");
  const c = await promisify(store.get(communityId));
  if (!c) return null;
  c.members = c.members.filter(m => m.pubkey !== pubkey);
  return promisify(store.put(c));
}

// --- annotations ---
export async function getAnnotationsByPin(pinId, offset = 0, limit = 20) {
  await openDB();
  const all = await promisify(tx("annotations").index("pin_id").getAll(pinId));
  return all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(offset, offset + limit);
}

export async function saveAnnotation(annotation) {
  await openDB();
  return promisify(tx("annotations", "readwrite").put(annotation));
}

export async function getAnnotation(annotationId) {
  await openDB();
  return promisify(tx("annotations").get(annotationId));
}

export async function deleteAnnotation(annotationId) {
  await openDB();
  return promisify(tx("annotations", "readwrite").delete(annotationId));
}

export async function getAnnotationsByCommunity(communityId) {
  await openDB();
  return promisify(tx("annotations").index("community_id").getAll(communityId));
}

// --- tombstones ---
export async function getTombstonesForTarget(targetId) {
  await openDB();
  return promisify(tx("tombstones").index("target_id").getAll(targetId));
}

export async function saveTombstone(tombstone) {
  await openDB();
  return promisify(tx("tombstones", "readwrite").put(tombstone));
}

export async function getTombstone(tombstoneId) {
  await openDB();
  return promisify(tx("tombstones").get(tombstoneId));
}

export async function getTombstoneTargetIds(annotationIds) {
  if (!annotationIds || !annotationIds.length) return new Set();
  await openDB();
  const all = await promisify(tx("tombstones").getAll());
  const idSet = new Set(annotationIds);
  const tombstoned = new Set();
  for (const t of all) {
    if (idSet.has(t.target_id)) tombstoned.add(t.target_id);
  }
  return tombstoned;
}

// --- layers ---
export async function getLayers(teamId) {
  await openDB();
  const result = await promisify(tx("layers").get(teamId));
  return result ? result.layers : null;
}

export async function saveLayers(teamId, layersArray) {
  await openDB();
  return promisify(tx("layers", "readwrite").put({ team_id: teamId, layers: layersArray }));
}

// --- schemas ---
export async function getSchemas() {
  await openDB();
  if (!db.objectStoreNames.contains("schemas")) return [];
  return promisify(tx("schemas").getAll());
}

export async function saveSchema(schema) {
  await openDB();
  if (!db.objectStoreNames.contains("schemas")) return;
  return promisify(tx("schemas", "readwrite").put(schema));
}

export async function getSchemasByCommunity(communityId) {
  await openDB();
  if (!db.objectStoreNames.contains("schemas")) return [];
  const all = await promisify(tx("schemas").getAll());
  return all.filter(s => s.community_id === communityId);
}

export async function deleteSchema(schemaId) {
  await openDB();
  if (!db.objectStoreNames.contains("schemas")) return;
  return promisify(tx("schemas", "readwrite").delete(schemaId));
}

// --- profile ---
export async function getProfile() {
  await openDB();
  return promisify(tx("profile").get("me"));
}

export async function saveProfile(profile) {
  await openDB();
  profile.key = "me";
  return promisify(tx("profile", "readwrite").put(profile));
}

export async function getSigningKey() {
  await openDB();
  const p = await promisify(tx("profile").get("me"));
  if (p && p.signing_public_key && p.signing_secret_key) {
    return { public: p.signing_public_key, secret: p.signing_secret_key };
  }
  return null;
}

export async function saveSigningKey(kp) {
  await openDB();
  const p = await promisify(tx("profile").get("me")).catch(() => null);
  const profile = p || { key: "me", user_id: generateUUIDCompat(), display_name: "Me" };
  profile.signing_public_key = kp.public;
  profile.signing_secret_key = kp.secret;
  return promisify(tx("profile", "readwrite").put(profile));
}

function generateUUIDCompat() {
  return crypto.randomUUID();
}

// --- settings ---
export async function getSettings(teamId) {
  await openDB();
  return promisify(tx("settings").get(teamId));
}

export async function saveSettings(teamId, settings) {
  await openDB();
  settings.team_id = teamId;
  return promisify(tx("settings", "readwrite").put(settings));
}

// --- known peers ---
export async function getKnownPeers() {
  await openDB();
  return promisify(tx("known_peers").getAll());
}

export async function saveKnownPeer(peer) {
  await openDB();
  return promisify(tx("known_peers", "readwrite").put(peer));
}

export async function deleteKnownPeer(userId) {
  await openDB();
  return promisify(tx("known_peers", "readwrite").delete(userId));
}

// --- bulk ops ---
export async function getAllPins(teamId) { return getPins(teamId); }
export async function getAllDrawings(teamId) { return getDrawings(teamId); }
export async function importPin(pin) { return savePin(pin); }
export async function importDrawing(drawing) { return saveDrawing(drawing); }

// --- subscribed layers ---
export async function saveSubscribedLayer(sub) {
  await openDB();
  return promisify(tx("subscribed_layers", "readwrite").put(sub));
}

export async function getSubscribedLayer(layerId) {
  await openDB();
  return promisify(tx("subscribed_layers").get(layerId));
}

export async function getAllSubscribedLayers() {
  await openDB();
  return promisify(tx("subscribed_layers").getAll());
}

export async function deleteSubscribedLayer(layerId) {
  await openDB();
  return promisify(tx("subscribed_layers", "readwrite").delete(layerId));
}

// --- layer DEKs ---
export async function saveLayerDek(dek) {
  await openDB();
  return promisify(tx("layer_deks", "readwrite").put(dek));
}

export async function getLayerDek(dekId) {
  await openDB();
  return promisify(tx("layer_deks").get(dekId));
}

export async function getAllLayerDeks() {
  await openDB();
  return promisify(tx("layer_deks").getAll());
}

// --- chains ---

function upgradeChain(chain) {
  if (!chain) return chain;
  if (chain.pin_entries && Array.isArray(chain.pin_entries) && chain.pin_entries.length > 0) {
    chain.pin_ids = chain.pin_entries.map(e => e.pin_id);
  } else if (chain.pin_ids && Array.isArray(chain.pin_ids)) {
    chain.pin_entries = chain.pin_ids.map(pid => ({
      pin_id: pid,
      narrative: "",
      audio_ciphertext: null,
      audio_nonce: null,
      audio_type: null,
    }));
  } else {
    chain.pin_entries = [];
    chain.pin_ids = [];
  }
  for (const entry of chain.pin_entries) {
    if (!entry.branches) entry.branches = [];
  }
  if (!chain.description && chain.description !== "") chain.description = "";
  if (!chain.cover_pin_id && chain.cover_pin_id !== null) chain.cover_pin_id = null;
  if (!chain.author_pubkey && chain.author_pubkey !== "") chain.author_pubkey = "";
  if (!chain.author_display_name && chain.author_display_name !== "") chain.author_display_name = "";
  if (!chain.tags) chain.tags = [];
  if (!chain.updated_at) chain.updated_at = chain.created_at || Date.now();
  return chain;
}

export async function saveChain(chain) {
  await openDB();
  const normalized = upgradeChain(chain);
  normalized.updated_at = Date.now();
  return promisify(tx("chains", "readwrite").put(normalized));
}
export async function getChain(chainId) {
  await openDB();
  const result = await promisify(tx("chains").get(chainId));
  return upgradeChain(result);
}
export async function getChainsByCommunity(communityId) {
  await openDB();
  const results = await promisify(tx("chains").index("community_id").getAll(communityId));
  return results.map(upgradeChain);
}
export async function deleteChain(chainId) {
  await openDB();
  return promisify(tx("chains", "readwrite").delete(chainId));
}

// --- offline_regions ---

export async function getOfflineRegions() {
  await openDB();
  if (!db.objectStoreNames.contains("offline_regions")) return [];
  return promisify(tx("offline_regions").getAll());
}

export async function saveOfflineRegion(region) {
  await openDB();
  if (!db.objectStoreNames.contains("offline_regions")) return;
  return promisify(tx("offline_regions", "readwrite").put(region));
}

export async function deleteOfflineRegion(id) {
  await openDB();
  if (!db.objectStoreNames.contains("offline_regions")) return;
  return promisify(tx("offline_regions", "readwrite").delete(id));
}

// --- collections ---

export async function getCollections() {
  await openDB();
  if (!db.objectStoreNames.contains("collections")) return [];
  return promisify(tx("collections").getAll());
}

export async function saveCollection(collection) {
  await openDB();
  if (!db.objectStoreNames.contains("collections")) return;
  return promisify(tx("collections", "readwrite").put(collection));
}

export async function deleteCollection(id) {
  await openDB();
  if (!db.objectStoreNames.contains("collections")) return;
  // Also remove associated collection_pins
  if (db.objectStoreNames.contains("collection_pins")) {
    const pins = await promisify(tx("collection_pins").index("collection_id").getAll(id));
    for (const p of pins) await promisify(tx("collection_pins", "readwrite").delete(p.id));
  }
  return promisify(tx("collections", "readwrite").delete(id));
}

export async function addPinToCollection(collection_id, pin_id, team_id) {
  await openDB();
  if (!db.objectStoreNames.contains("collection_pins")) return;
  const id = collection_id + "_" + pin_id;
  return promisify(tx("collection_pins", "readwrite").put({ id, collection_id, pin_id, team_id, added_at: Date.now() }));
}

export async function removePinFromCollection(collection_id, pin_id) {
  await openDB();
  if (!db.objectStoreNames.contains("collection_pins")) return;
  const id = collection_id + "_" + pin_id;
  return promisify(tx("collection_pins", "readwrite").delete(id));
}

export async function getCollectionPins(collection_id) {
  await openDB();
  if (!db.objectStoreNames.contains("collection_pins")) return [];
  return promisify(tx("collection_pins").index("collection_id").getAll(collection_id));
}

// --- batch operations (single transaction per batch) ---

export async function importPins(pins) {
  if (!pins.length) return;
  await openDB();
  const store = tx("pins", "readwrite");
  const ops = pins.map(p => promisify(store.put(p)));
  return Promise.all(ops);
}

export async function importDrawings(drawings) {
  if (!drawings.length) return;
  await openDB();
  const store = tx("drawings", "readwrite");
  const ops = drawings.map(d => promisify(store.put(d)));
  return Promise.all(ops);
}

export async function saveAnnotations(annotations) {
  if (!annotations.length) return;
  await openDB();
  const store = tx("annotations", "readwrite");
  const ops = annotations.map(a => promisify(store.put(a)));
  return Promise.all(ops);
}

export async function saveTombstones(tombstones) {
  if (!tombstones.length) return;
  await openDB();
  const store = tx("tombstones", "readwrite");
  const ops = tombstones.map(t => promisify(store.put(t)));
  return Promise.all(ops);
}

export async function deletePins(pinIds) {
  if (!pinIds.length) return;
  await openDB();
  const store = tx("pins", "readwrite");
  const ops = pinIds.map(id => promisify(store.delete(id)));
  return Promise.all(ops);
}

export async function deleteDrawings(drawingIds) {
  if (!drawingIds.length) return;
  await openDB();
  const store = tx("drawings", "readwrite");
  const ops = drawingIds.map(id => promisify(store.delete(id)));
  return Promise.all(ops);
}
