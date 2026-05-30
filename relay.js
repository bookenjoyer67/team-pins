import * as DB from "./db.js";
import { state } from "./state.js";
import { toast } from "./dialogs.js";
import { verify, encode_hex, wrap_dek, unwrap_dek } from "./core/pkg/e2e_core.js";

const connections = new Map();  // url → { ws, connected, url, pendingLists: [], communityPeers: Map, reconnectTimer, authPubkey }

let lastSyncTimestamps = new Map();
let onCommunityList = null;
let onCommunityPeerUpdate = null;
let pendingPushes = [];
let reconnectAttempts = new Map();

function getCommunityConn(communityId) {
  if (communityId && communityId === state.currentSet) {
    const relayUrl = state.currentCommunity?.relay_url;
    if (relayUrl) {
      const conn = connections.get(relayUrl);
      if (conn && isAlive(conn)) return conn;
    }
  }
  return null;
}

function queuePush(data) {
  if (pendingPushes.length > 50) pendingPushes.shift();
  pendingPushes.push(data);
}

function isAlive(conn) {
  return conn && conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING);
}

function getConn(url) {
  if (url) return connections.get(url) || null;
  for (const conn of connections.values()) {
    if (isAlive(conn)) return conn;
  }
  return null;
}

function getWsForCommunity(communityId, cb) {
  DB.getCommunity(communityId).then(c => {
    const url = c?.relay_url;
    const conn = getConn(url);
    if (isAlive(conn)) {
      cb(conn.ws, conn);
    } else {
      cb(null, null);
    }
  }).catch(() => cb(null, null));
}

export function isRelayConnected(url) {
  if (url) return isAlive(connections.get(url));
  for (const c of connections.values()) {
    if (isAlive(c)) return true;
  }
  return false;
}

export function getLastSync(communityId) {
  return lastSyncTimestamps.get(communityId) || 0;
}

export function setOnCommunityList(cb) { onCommunityList = cb; }
export function setOnCommunityPeerUpdate(cb) { onCommunityPeerUpdate = cb; }

export function getCommunityPeers(communityId) {
  for (const conn of connections.values()) {
    const peers = conn.communityPeers.get(communityId);
    if (peers && peers.size > 0) {
      const now = Date.now();
      return [...peers.values()].filter(p => now - p.ts < 120000);
    }
  }
  return [];
}

export function connect(relayUrl) {
  const url = (relayUrl || localStorage.getItem("pins-relay-url") || "").trim().replace(/\/$/, "");
  if (!url) return;
  let registeredCommunities = new Set();
  if (connections.has(url)) {
    const existing = connections.get(url);
    if (existing.ws && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)) return;
    if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
    registeredCommunities = existing.registeredCommunities || new Set();
    try { existing.ws.close(); } catch (_) {}
  }

  const conn = { connected: false, ws: null, url, pendingLists: [], communityPeers: new Map(), reconnectTimer: null, authPubkey: null, registeredCommunities };
  connections.set(url, conn);

  try {
    conn.ws = new WebSocket(url);
  } catch (_) { connections.delete(url); toast("Cannot connect to " + url, "#dc2626"); return; }

  conn.ws.onopen = async () => {
    reconnectAttempts.delete(url);
    conn.connected = true;
    reconnectAttempts.set(url, 0);
    conn.ws.send(JSON.stringify({ type: "join", room: "community-relay" }));
    window._renderUI?.();
    await registerCommunitiesOn(conn);
    requestCommunityListOn(conn);
    setTimeout(() => window._pushAllLocalData?.(), 100);
    drainQueuedPushesOn(conn);
    import("./gossip.js").then(async g => {
      const announce = await g.buildCapabilityAnnounce();
      if (announce.communities.length > 0 && conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(JSON.stringify(announce));
      }
    }).catch(() => {});
    setTimeout(async () => {
      if (!isAlive(conn)) return;
      const allCommunities = await DB.getAllCommunities();
      for (const c of allCommunities) {
        if (c.relay_url === conn.url || (!c.relay_url && c.visibility !== "local")) {
          await syncDeltaOn(conn, c.community_id);
        }
      }
      // Sync subscribed layers too
      setTimeout(() => syncSubscribedLayers(), 500);
      if (state.currentSet) {
        await window._loadPins?.();
        await window._loadDrawings?.();
        await window._loadSubscribedPins?.();
      }
    }, 300);
  };

  function drainQueuedPushesOn(c) {
    const pushes = [...pendingPushes];
    pendingPushes.length = 0;
    for (const p of pushes) {
      // Only push to the relay this community is registered on
      DB.getCommunity(p.communityId).then(community => {
        const communityRelayUrl = community?.relay_url;
        if (!communityRelayUrl || communityRelayUrl === c.url || !c.url) {
          pushDeltaOn(c, p.communityId, p.pins, p.annotations, p.drawings, p.tombstones, p.deletedPinIds, p.deletedDrawingIds);
        } else {
          queuePush(p);
        }
      }).catch(() => { queuePush(p); });
    }
  }

  conn.ws.onmessage = async (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (parseErr) {
      console.warn("[relay] failed to parse message:", e.data?.slice?.(0, 200));
      return;
    }
    try {
      if (msg.type === "hello") {
        conn.ws.send(JSON.stringify({ type: "join", room: "community-relay" }));
        registerCommunitiesOn(conn);
        requestCommunityListOn(conn);
      } else if (msg.type === "sync_delta") {
        await handleDelta(msg, true);
      } else if (msg.type === "community_registered") {
        console.log("[relay] community registered:", msg.community_id);
      } else if (msg.type === "community_list") {
        const pending = [...conn.pendingLists];
        conn.pendingLists.length = 0;
        for (const resolve of pending) resolve(msg.communities || []);
        if (onCommunityList) onCommunityList(msg.communities || []);
      } else if (msg.type === "community_peer_joined") {
        const cid = msg.community_id;
        const pubkey = msg.pubkey;
        const name = msg.name;
        if (!cid || !pubkey) return;
        let peers = conn.communityPeers.get(cid);
        if (!peers) { peers = new Map(); conn.communityPeers.set(cid, peers); }
        peers.set(pubkey, { pubkey, name, ts: Date.now() });
        if (onCommunityPeerUpdate) onCommunityPeerUpdate(cid);
        if (msg.governance && state.currentCommunity && state.currentCommunity.community_id === cid) {
          state.currentCommunity.governance = msg.governance;
          DB.saveCommunity(state.currentCommunity);
        }
        window._renderUI?.();
      } else if (msg.type === "delta_stored") {
        // acknowledged
      } else if (msg.type === "push_delta") {
        handleDelta(msg);
      } else if (msg.type === "push_delta_bc") {
        handleDelta(msg);
      } else if (msg.type === "pin_vote_bc") {
        handlePinVoteUpdate(msg);
      } else if (msg.type === "annotation_vote") {
        const ok = await handleAnnotationVote(msg);
        if (!ok) window._toast?.("Vote not submitted — signature invalid");
      } else if (msg.type === "gossip_capabilities") {
        import("./gossip.js").then(g => g.handleCapabilityAnnounce(msg)).catch(() => {});
      } else if (msg.type === "gossip_query") {
        import("./gossip.js").then(g => g.handleQuery(msg)).catch(() => {});
      } else if (msg.type === "gossip_response") {
        if (window._gossipResponseHandler) window._gossipResponseHandler(msg);
      } else if (msg.type === "auth_challenge") {
        handleAuthChallenge(conn, msg);
      } else if (msg.type === "auth_ok") {
        conn.authPubkey = msg.pubkey || null;
      } else if (msg.type === "member_added") {
        handleMemberAdded(msg);
      } else if (msg.type === "member_removed") {
        handleMemberRemoved(msg);
      } else if (msg.type === "community_deleted") {
        handleCommunityDeleted(msg);
      } else if (msg.type === "governance_updated") {
        handleGovernanceUpdated(msg);
      } else if (msg.type === "membership_claimed") {
        handleMembershipClaimed(msg);
      } else if (msg.type === "token_created") {
        handleTokenCreated(msg);
      } else if (msg.type === "layer_subscribed") {
        handleLayerSubscribed(msg);
      } else if (msg.type === "layer_update") {
        handleLayerUpdate(msg);
      } else if (msg.type === "layer_published") {
        handleLayerPublished(msg);
      } else if (msg.type === "layer_unpublished") {
        handleLayerUnpublished(msg);
      } else if (msg.type === "subscribed_sync") {
        handleSubscribedSync(msg);
      } else if (msg.type === "member_dek_requested") {
        handleMemberDekRequested(msg);
      } else if (msg.type === "member_dek_ready") {
        handleMemberDekReady(msg);
      } else if (msg.type === "error") {
        toast("Relay error: " + (msg.reason || "unknown"), "#dc2626");
      }
    } catch (err) {
      console.error("[relay] message handler failed:", err, "msg type:", msg?.type);
    }
  };

  conn.ws.onclose = () => {
    conn.connected = false;
    conn.ws = null;
    window._renderUI?.();
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    const attempts = (reconnectAttempts.get(url) || 0) + 1;
    reconnectAttempts.set(url, attempts);
    if (attempts > 10) { console.error("[relay] max reconnect attempts reached for", url); return; }
    const delay = Math.min(1000 * Math.pow(2, attempts), 60000);
    const jitter = (crypto.getRandomValues(new Uint32Array(1))[0] / 0xFFFFFFFF) * delay * 0.3;
    conn.reconnectTimer = setTimeout(() => connect(url), delay + jitter);
  };

  conn.ws.onerror = () => {
    console.warn("[relay] WebSocket error on", url);
  };
}

export function disconnect(url) {
  if (url) {
    const conn = connections.get(url);
    if (conn) {
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      conn.ws.onclose = null;
      conn.ws.onmessage = null;
      try { conn.ws.close(); } catch (_) {}
      connections.delete(url);
    }
  } else {
    for (const [u, conn] of connections) {
      if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
      conn.ws.onclose = null;
      conn.ws.onmessage = null;
      try { conn.ws.close(); } catch (_) {}
    }
    connections.clear();
  }
}

async function registerCommunitiesOn(conn) {
  if (!isAlive(conn)) return;
  conn.registeredCommunities = conn.registeredCommunities || new Set();
  const communities = await DB.getAllCommunities();
  for (const c of communities) {
    if (c.visibility === "local") continue;
    if (c.relay_url && c.relay_url !== conn.url) continue;
    if (conn.registeredCommunities.has(c.community_id)) continue;
    await registerCommunityOn(conn, c.community_id, c.visibility === "public");
    conn.registeredCommunities.add(c.community_id);
  }
}

function requestCommunityListOn(conn) {
  if (!isAlive(conn)) return;
  conn.ws.send(JSON.stringify({ type: "list_communities" }));
}

export async function fetchCommunityList(relayUrl) {
  if (relayUrl) {
    const conn = connections.get(relayUrl);
    if (!conn || !isAlive(conn)) return [];
    return fetchFromConn(conn);
  }
  const conn = getConn();
  if (!conn) return [];
  return fetchFromConn(conn);
}

async function fetchFromConn(conn) {
  return new Promise(resolve => {
    conn.pendingLists.push(resolve);
    conn.ws.send(JSON.stringify({ type: "list_communities" }));
    setTimeout(() => {
      const idx = conn.pendingLists.indexOf(resolve);
      if (idx >= 0) { conn.pendingLists.splice(idx, 1); resolve([]); }
    }, 5000);
  });
}

async function syncDeltaOn(conn, communityId) {
  if (!isAlive(conn)) return false;
  const since = lastSyncTimestamps.get(communityId) || 0;
  const requestId = crypto.randomUUID();
  conn.ws.send(JSON.stringify({ type: "sync_request", community_id: communityId, since, request_id: requestId }));
  return new Promise(resolve => {
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "sync_delta" && msg.community_id === communityId && msg.request_id === requestId) {
          conn.ws.removeEventListener("message", handler);
          resolve(true);
        }
      } catch (_) { resolve(false); }
    };
    conn.ws.addEventListener("message", handler);
    setTimeout(() => {
      conn.ws.removeEventListener("message", handler);
      resolve(false);
    }, 5000);
  });
}

export async function syncDelta(communityId) {
  const conn = getConn();
  if (!conn) return false;
  return syncDeltaOn(conn, communityId);
}

async function handleDelta(msg, isSync = false) {
  const communityId = msg.community_id;
  if (!communityId) return;

  for (const pin of msg.pins || []) {
    if (!pin.author_pubkey) delete pin.author_pubkey;
    const existing = await DB.getPin(pin.pin_id).catch(() => null);
    const merged = existing
      ? { ...pin, team_id: communityId, media: pin.media || existing.media, author_pubkey: pin.author_pubkey || existing.author_pubkey, ttl_expires_at: pin.ttl_expires_at ?? existing.ttl_expires_at, ttl_base_at: pin.ttl_base_at ?? existing.ttl_base_at, vote_count_up: pin.vote_count_up ?? existing.vote_count_up, vote_count_down: pin.vote_count_down ?? existing.vote_count_down, posted_anonymously: pin.posted_anonymously ?? existing.posted_anonymously }
      : { ...pin, team_id: communityId };
    await DB.importPin(merged);
  }
  for (const ann of msg.annotations || []) {
    const existing = await DB.getAnnotation(ann.annotation_id).catch(() => null);
    if (existing) {
      const mergedVotes = [...(existing.votes || [])];
      for (const v of (ann.votes || [])) {
        if (!mergedVotes.some(ev => ev.pubkey === v.pubkey)) mergedVotes.push(v);
      }
      await DB.saveAnnotation({ ...existing, ...ann, community_id: communityId, votes: mergedVotes });
    } else {
      await DB.saveAnnotation({ ...ann, community_id: communityId });
    }
  }
  for (const tomb of msg.tombstones || []) {
    await DB.saveTombstone({ ...tomb, community_id: communityId });
  }
  for (const dwg of (msg.drawings || [])) {
    const existing = await DB.getDrawing(dwg.drawing_id).catch(() => null);
    const normalized = { ...dwg, team_id: communityId, encrypted_geojson: dwg.ciphertext || dwg.encrypted_geojson };
    delete normalized.ciphertext;
    const merged = existing
      ? { ...existing, ...normalized }
      : normalized;
    await DB.importDrawing(merged);
  }
  await DB.deletePins(msg.deleted_pin_ids || []);
  await DB.deleteDrawings(msg.deleted_drawing_ids || []);

  if (isSync) {
    const now = Date.now();
    lastSyncTimestamps.set(communityId, now);
    if (msg.pins?.length || msg.drawings?.length || msg.annotations?.length) {
      const c = await DB.getCommunity(communityId).catch(() => null);
      if (c) { c.last_updated = Date.now(); await DB.saveCommunity(c); }
    }
    if (msg.governance && state.currentCommunity && state.currentCommunity.community_id === communityId) {
      state.currentCommunity.governance = msg.governance;
      DB.saveCommunity(state.currentCommunity);
    }
  }

  if (communityId === state.currentSet) {
    await window._loadPins?.();
    await window._loadDrawings?.();
  }
  window._renderUI?.();
}

async function pushDeltaOn(conn, communityId, pins, annotations, drawings, tombstones, deletedPinIds, deletedDrawingIds) {
  if (!isAlive(conn)) return;
  try {
    conn.ws.send(JSON.stringify({
      type: "push_delta",
      community_id: communityId,
      ts: Date.now(),
      pins: pins || [],
      annotations: annotations || [],
      drawings: drawings || [],
      tombstones: tombstones || [],
      deleted_pin_ids: deletedPinIds || [],
      deleted_drawing_ids: deletedDrawingIds || [],
    }));
  } catch (e) {
    queuePush({ communityId, pins, annotations, drawings, tombstones, deletedPinIds, deletedDrawingIds });
  }
}

export async function pushDelta(communityId, pins, annotations, drawings, tombstones, deletedPinIds, deletedDrawingIds) {
  const data = { communityId, pins, annotations, drawings, tombstones, deletedPinIds, deletedDrawingIds };
  const conn = getCommunityConn(communityId);
  if (conn && isAlive(conn)) {
    await pushDeltaOn(conn, communityId, pins, annotations, drawings, tombstones, deletedPinIds, deletedDrawingIds);
  } else {
    queuePush(data);
  }
}

export function getLastSyncTimestamps() {
  return new Map(lastSyncTimestamps);
}

export function publishCommunity(communityId, published = true) {
  const conn = getCommunityConn(communityId);
  if (conn && isAlive(conn)) {
    registerCommunityOn(conn, communityId, published).then(() => {
      conn.registeredCommunities = conn.registeredCommunities || new Set();
      conn.registeredCommunities.add(communityId);
      if (published) requestCommunityListOn(conn);
      window._pushAllLocalData?.();
    });
  }
}

export function unpublishCommunity(communityId) {
  const conn = getCommunityConn(communityId);
  if (conn && isAlive(conn)) {
    conn.ws.send(JSON.stringify({ type: "unpublish_community", community_id: communityId }));
  }
}

export function deleteCommunity(communityId) {
  const conn = getCommunityConn(communityId);
  if (conn && isAlive(conn)) {
    conn.ws.send(JSON.stringify({ type: "delete_community", community_id: communityId }));
  }
}

async function registerCommunityOn(conn, communityId, published) {
  const c = await DB.getCommunity(communityId);
  const team = await DB.getTeam(communityId);
  if (!c || !team) return;
  const isPasswordDerived = team.key_derivation === "pbkdf2";
  // Compute join_wrapped_dek for open communities so new members can self-service the DEK
  let joinWrappedDek = "";
  if (!isPasswordDerived && (c.governance?.join_policy || "open") === "open") {
    try {
      const { unwrap_dek, encode_hex, encrypt_with_password } = await import("./core/pkg/e2e_core.js");
      const communitySecret = team.community_secret_key || team.secret_key;
      if (communitySecret) {
        const dk = unwrap_dek(team.community_wrapped_dek || team.wrapped_dek, communitySecret);
        const dekHex = encode_hex(dk);
        const encrypted = encrypt_with_password(dekHex, communityId);
        joinWrappedDek = `${encrypted.ciphertext_hex}:${encrypted.nonce_hex}:${encrypted.salt_hex}`;
      }
    } catch (_) {}
  }
  conn.ws.send(JSON.stringify({
    type: "register_community",
    community_id: communityId,
    name: c.name,
    description: c.description || "",
    genesis_public_key: c.genesis_public_key,
    public_key: team.public_key || "",
    wrapped_dek: team.community_wrapped_dek || team.wrapped_dek || "",
    key_derivation: isPasswordDerived ? "pbkdf2" : "random",
    published,
    members: c.members || [],
    governance: c.governance || null,
    owner_pubkey: state.signingPublicKey || "",
    owner_name: state.displayName || "",
    bounds: c.bounds || null,
    password_hash: c.password_hash || null,
    join_wrapped_dek: joinWrappedDek || null,
  }));
}

async function handleAnnotationVote(msg) {
  const ann = await DB.getAnnotation(msg.annotation_id).catch(() => null);
  if (!ann) return false;
  if (msg.pubkey) {
    if (!msg.signature) {
      console.warn("[relay] annotation_vote: missing signature from", msg.pubkey);
      return false;
    }
    try {
      const rawPayload = msg.annotation_id + "|" + (msg.direction || "") + "|" + (msg.timestamp || "");
      const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
      if (!verify(payloadHex, msg.signature, msg.pubkey)) {
        console.warn("[relay] annotation_vote: invalid signature from", msg.pubkey);
        return false;
      }
    } catch (_) { return false; }
  }
  ann.votes = ann.votes || [];
  const idx = ann.votes.findIndex(v => v.pubkey === msg.pubkey);
  const vote = { pubkey: msg.pubkey, direction: msg.direction, timestamp: msg.timestamp, signature: msg.signature || "" };
  if (idx >= 0) ann.votes[idx] = vote;
  else ann.votes.push(vote);
  await DB.saveAnnotation(ann);
  window._refreshPinPopup?.(ann.pin_id);
  return true;
}

async function handlePinVoteUpdate(msg) {
  const { pin_id, community_id, vote_count_up, vote_count_down, ttl_expires_at, deleted } = msg;
  if (!pin_id || !community_id) return;
  if (deleted) {
    await DB.deletePin(pin_id);
    if (community_id === state.currentSet) {
      await window._loadPins?.();
      await window._loadDrawings?.();
    }
    window._renderUI?.();
    return;
  }
  const pin = await DB.getPin(pin_id).catch(() => null);
  if (pin) {
    pin.vote_count_up = vote_count_up ?? 0;
    pin.vote_count_down = vote_count_down ?? 0;
    pin.ttl_expires_at = ttl_expires_at ?? null;
    await DB.importPin(pin);
    if (community_id === state.currentSet) {
      const marker = state.markers?.find(m => m._pinId === pin_id);
      if (marker) {
        marker._ttlVoteUp = vote_count_up ?? 0;
        marker._ttlVoteDown = vote_count_down ?? 0;
        marker._ttlExpiresAt = ttl_expires_at ?? null;
        window._refreshPinMarkerPopup?.(marker);
      } else {
        await window._loadPins?.();
        await window._loadDrawings?.();
      }
    }
    window._renderUI?.();
  }
}

export function joinCommunity(communityId, passwordHash, relayUrl) {
  const conn = (relayUrl && connections.get(relayUrl.trim().replace(/\/$/, ""))) || getConn();
  if (!conn || !isAlive(conn)) return Promise.resolve(null);
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const msg = { type: "join_community", community_id: communityId, request_id: requestId };
    if (passwordHash) msg.password_hash = passwordHash;

    let waitingToast = null;
    let toastTimer = null;
    let timeoutTimer = null;
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(toastTimer);
      clearTimeout(timeoutTimer);
      if (waitingToast) waitingToast.remove();
      conn.ws.removeEventListener("message", handler);
      resolve(result);
    };

    const handler = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "community_joined" && m.community_id === communityId && m.request_id === requestId) {
          done(m);
        }
      } catch (_) { done(null); }
    };

    toastTimer = setTimeout(() => {
      waitingToast = document.createElement("div");
      waitingToast.textContent = "Connecting to community...";
      waitingToast.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#2563eb;color:white;padding:10px 20px;border-radius:6px;z-index:3000;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,0.3);";
      document.body.appendChild(waitingToast);
    }, 3000);

    timeoutTimer = setTimeout(() => done(null), 15000);

    conn.ws.addEventListener("message", handler);
    if (!isAlive(conn)) { done(null); return; }
    try { conn.ws.send(JSON.stringify(msg)); } catch (_) { done(null); }
  });
}

export function requestMemberDek(communityId, memberPubkey) {
  const conn = getConn();
  if (!conn || !isAlive(conn)) return false;
  try { conn.ws.send(JSON.stringify({
    type: "request_member_dek",
    community_id: communityId,
    member_pubkey: memberPubkey,
  })); } catch (_) { return false; }
  return true;
}

export function rewrapMemberDek(communityId, targetPubkey, rewrapDek, signature) {
  const conn = getConn();
  if (!conn || !isAlive(conn)) return;
  const msg = {
    type: "rewrap_member_dek",
    community_id: communityId,
    target_pubkey: targetPubkey,
    rewrap_dek: rewrapDek,
  };
  if (signature) msg.signature = signature;
  try { conn.ws.send(JSON.stringify(msg)); } catch (_) {}
}

export function sendAnnotationVote(annotationId, vote) {
  const conn = getCommunityConn(state.currentSet);
  if (!conn || !isAlive(conn)) return;
  conn.ws.send(JSON.stringify({
    type: "annotation_vote",
    community_id: state.currentSet,
    annotation_id: annotationId,
    pubkey: vote.pubkey,
    direction: vote.direction,
    timestamp: vote.timestamp,
    signature: vote.signature || "",
  }));
}

export async function sendPinVote(communityId, pinId, dir) {
  const relayUrl = state.currentCommunity?.relay_url;
  const conn = relayUrl ? connections.get(relayUrl) : getConn();
  if (!conn || !isAlive(conn)) return;
  const ts = Date.now();
  let sig = "";
  if (state.signingSecretKey) {
    const mod = await import("./core/pkg/e2e_core.js");
    const payload = mod.encode_hex(new TextEncoder().encode(pinId + "|" + communityId + "|" + dir + "|" + ts));
    sig = mod.sign(payload, state.signingSecretKey);
  }
  conn.ws.send(JSON.stringify({
    type: "pin_vote",
    community_id: communityId,
    pin_id: pinId,
    dir,
    pubkey: state.signingPublicKey || "",
    signature: sig,
    timestamp: ts,
  }));
}

export async function queryCommunities(bbox) {
  const conn = getConn();
  if (!conn || !isAlive(conn)) return [];
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    conn.ws.send(JSON.stringify({ type: "query_communities", bbox, request_id: requestId }));
    const handler = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "communities_nearby" && m.request_id === requestId) {
          conn.ws.removeEventListener("message", handler);
          resolve(m.results || []);
        }
      } catch (_) {}
    };
    conn.ws.addEventListener("message", handler);
    setTimeout(() => {
      conn.ws.removeEventListener("message", handler);
      resolve([]);
    }, 5000);
  });
}

export function getSavedRelayUrls() {
  const raw = localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "";
  if (!raw) return [];
  return raw.split(",").map(u => u.trim().replace(/\/$/, "")).filter(Boolean);
}

export function saveRelayUrls(urls) {
  const unique = [...new Set(urls.map(u => u.trim().replace(/\/$/, "")).filter(Boolean))];
  localStorage.setItem("pins-relay-urls", unique.join(","));
}

export async function connectAll() {
  const urls = getSavedRelayUrls();
  try {
    const communities = await DB.getAllCommunities();
    for (const c of communities) {
      if (c.relay_url && !urls.includes(c.relay_url)) urls.push(c.relay_url);
    }
  } catch (_) {}
  for (const url of urls) connect(url);
}

// ---- Auth handshake ----

async function handleAuthChallenge(conn, msg) {
  if (!state.signingSecretKey || !state.signingPublicKey) return;
  try {
    const { sign, encode_hex } = await import("./core/pkg/e2e_core.js");
    const challenge = msg.challenge;
    const ts = msg.ts;
    const payload = encode_hex(new TextEncoder().encode(challenge + ts));
    const signature = sign(payload, state.signingSecretKey);
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({
        type: "auth_response",
        pubkey: state.signingPublicKey,
        challenge,
        ts,
        signature,
      }));
    }
  } catch (e) {
    console.warn("[relay] auth challenge signing failed:", e);
  }
}

// ---- Member management handlers ----

async function handleMemberAdded(msg) {
  const c = await DB.getCommunity(msg.community_id).catch(() => null);
  if (!c) return;
  c.members = c.members || [];
  if (!c.members.some(m => m.pubkey === msg.pubkey)) {
    c.members.push({ pubkey: msg.pubkey, display_name: msg.display_name, role: msg.role });
    await DB.saveCommunity(c);
  }
  if (state.currentCommunity && state.currentCommunity.community_id === msg.community_id) {
    state.currentCommunity.members = c.members;
  }
  window._renderUI?.();
}

async function handleMemberRemoved(msg) {
  const c = await DB.getCommunity(msg.community_id).catch(() => null);
  if (!c) return;
  c.members = (c.members || []).filter(m => m.pubkey !== msg.pubkey);
  await DB.saveCommunity(c);
  if (state.currentCommunity && state.currentCommunity.community_id === msg.community_id) {
    state.currentCommunity.members = c.members;
  }
  window._renderUI?.();
}

async function handleCommunityDeleted(msg) {
  const c = await DB.getCommunity(msg.community_id).catch(() => null);
  if (!c) return;
  c.visibility = "local";
  await DB.saveCommunity(c);
  if (state.currentCommunity && state.currentCommunity.community_id === msg.community_id) {
    state.currentCommunity.visibility = "local";
  }
  window._toast?.("Community '" + (c.name || msg.community_id.slice(0, 8)) + "' was deleted from the relay by its founder");
  window._disconnectCommunity?.(msg.community_id);
  window._renderUI?.();
}

async function handleGovernanceUpdated(msg) {
  const c = await DB.getCommunity(msg.community_id).catch(() => null);
  if (!c || !msg.governance) return;
  c.governance = msg.governance;
  await DB.saveCommunity(c);
  if (state.currentCommunity && state.currentCommunity.community_id === msg.community_id) {
    state.currentCommunity.governance = msg.governance;
  }
  window._renderUI?.();
}

async function handleMembershipClaimed(msg) {
  // Token claim succeeded — refresh community data
  window._renderUI?.();
}

async function handleTokenCreated(msg) {
  // Token created — caller provides the token data for sharing
  if (window._tokenCreatedHandler) window._tokenCreatedHandler(msg);
}

// ---- Member DEK exchange ----

async function handleMemberDekRequested(msg) {
  const { community_id, member_pubkey } = msg;
  if (!community_id || !member_pubkey) return;
  const team = await DB.getTeam(community_id);
  const c = await DB.getCommunity(community_id);
  if (!team || !c || team.key_derivation === "pbkdf2") return;
  // Verify the requesting pubkey is a member of the community
  const members = c.members || [];
  const gov = c.governance || {};
  const joinPolicy = gov.join_policy || "open";
  if (joinPolicy !== "open" && !members.some(m => m.pubkey === member_pubkey)) {
    console.warn("[relay] rejecting member_dek request from non-member:", member_pubkey);
    return;
  }
  const communitySecret = team.community_secret_key || team.secret_key;
  if (!communitySecret) return;
  try {
    const communityDek = team.community_wrapped_dek || team.wrapped_dek;
    const dk = unwrap_dek(communityDek, communitySecret);
    if (!dk) return;
    const memberDek = wrap_dek(dk, member_pubkey);
    rewrapMemberDek(community_id, member_pubkey, memberDek);
    console.log("[relay] auto-rewrapped DEK for", member_pubkey, "in", community_id);
  } catch (e) {
    console.warn("[relay] DEK rewrap for", member_pubkey?.slice(0, 10), "failed:", e.message);
  }
}

async function handleMemberDekReady(msg) {
  const { community_id, member_pubkey, individually_wrapped_dek } = msg;
  if (!community_id || !individually_wrapped_dek) return;

  const team = await DB.getTeam(community_id);
  console.log("[relay] member_dek_ready: cid=", community_id, "msg_pubkey=", member_pubkey?.slice(0,16), "team_pubkey=", team?.public_key?.slice(0,16), "team_exists=", !!team);
  if (!team) return;

  // Check if this individuallly wrapped DEK is for our member key
  if (member_pubkey === team.public_key) {
    console.log("[relay] member_dek_ready: storing individually-wrapped DEK for", member_pubkey.slice(0, 16), "in", community_id);
    team.wrapped_dek = individually_wrapped_dek;
    await DB.saveTeam(team);

    // Try to decrypt and load immediately
    try {
      const dk = unwrap_dek(individually_wrapped_dek, team.secret_key);
      console.log("[relay] member_dek_ready: unwrap returned", !!dk, "currentSet=", state.currentSet, "cid=", community_id);
      if (dk && community_id === state.currentSet) {
        state.dek = dk;
        await window._loadPins?.();
        await window._loadDrawings?.();
        window._renderUI?.();
        window._toast?.("Key exchange complete — pins decrypted", "#16a34a");
      } else if (dk) {
        console.log("[relay] key exchange complete for", community_id, "(not current set)");
      }
    } catch (_) {}
  } else {
    console.log("[relay] member_dek_ready: pubkey mismatch — msg:", member_pubkey?.slice(0,16), "vs team:", team.public_key?.slice(0,16));
  }
}

// ---- Option A: Add / Remove members ----

export async function addMember(communityId, pubkey, displayName, role) {
  if (!state.signingSecretKey) return;
  const { sign, encode_hex } = await import("./core/pkg/e2e_core.js");
  const ts = Date.now();
  const payload = encode_hex(new TextEncoder().encode(communityId + "|" + pubkey + "|" + role + "|" + ts));
  const signature = sign(payload, state.signingSecretKey);
  const conn = getConn();
  if (!conn || !isAlive(conn)) return;
  conn.ws.send(JSON.stringify({
    type: "add_member",
    community_id: communityId,
    pubkey,
    display_name: displayName,
    role,
    signature,
    timestamp: ts,
  }));
}

export async function removeMember(communityId, pubkey) {
  const conn = getConn();
  if (!conn || !isAlive(conn)) return;
  conn.ws.send(JSON.stringify({
    type: "remove_member",
    community_id: communityId,
    pubkey,
  }));
}

// ---- Option B: Create / Claim tokens ----

export async function createInviteToken(communityId, role, expiry, maxUses) {
  if (!state.signingSecretKey) return null;
  const { sign, generate_uuid, encode_hex } = await import("./core/pkg/e2e_core.js");
  const nonce = generate_uuid();
  const payload = encode_hex(new TextEncoder().encode(communityId + "|" + nonce + "|" + role + "|" + expiry + "|" + maxUses));
  const signature = sign(payload, state.signingSecretKey);
  const conn = getConn();
  if (!conn || !isAlive(conn)) return null;
  conn.ws.send(JSON.stringify({
    type: "create_token",
    community_id: communityId,
    nonce,
    role,
    expiry,
    max_uses: maxUses,
    signature,
  }));
  return { nonce, role, expiry, maxUses, signature, communityId };
}

export async function claimMembership(communityId, memberPubkey, memberName, nonce, capabilitySig) {
  const conn = getConn();
  if (!conn || !isAlive(conn)) return null;
  return new Promise(resolve => {
    conn.ws.send(JSON.stringify({
      type: "claim_membership",
      community_id: communityId,
      member_pubkey: memberPubkey,
      member_name: memberName,
      nonce,
      capability_signature: capabilitySig,
    }));
    const handler = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "membership_claimed" && m.community_id === communityId) {
          conn.ws.removeEventListener("message", handler);
          resolve(m);
        } else if (m.type === "claim_denied") {
          conn.ws.removeEventListener("message", handler);
          resolve({ error: m.reason });
        }
      } catch (_) {}
    };
    conn.ws.addEventListener("message", handler);
    setTimeout(() => {
      conn.ws.removeEventListener("message", handler);
      resolve({ error: "timeout" });
    }, 15000);
  });
}

// ---- Update governance ----

export async function updateGovernance(communityId, governance) {
  if (!state.signingSecretKey) return;
  const { sign, encode_hex } = await import("./core/pkg/e2e_core.js");
  const payload = encode_hex(new TextEncoder().encode(communityId + "|" + JSON.stringify(governance)));
  const signature = sign(payload, state.signingSecretKey);
  const conn = getConn();
  if (!conn || !isAlive(conn)) return;
  conn.ws.send(JSON.stringify({
    type: "update_governance",
    community_id: communityId,
    governance,
    signature,
  }));
}

// ---- Token created callback ----

export function setOnTokenCreated(cb) { window._tokenCreatedHandler = cb; }

// ---- Public layer subscription exports ----

export async function publishLayer(communityId, layerId, name, topicTags, layerDekWrapped) {
  const conn = getConn();
  if (!conn || !isAlive(conn)) return false;
  return new Promise(resolve => {
    conn.ws.send(JSON.stringify({
      type: "publish_layer",
      community_id: communityId,
      layer_id: layerId,
      name,
      topic_tags: topicTags,
      layer_dek_wrapped: layerDekWrapped,
    }));
    const handler = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "layer_published" && m.layer_id === layerId) {
          conn.ws.removeEventListener("message", handler);
          resolve(true);
        }
      } catch (_) {}
    };
    conn.ws.addEventListener("message", handler);
    setTimeout(() => { conn.ws.removeEventListener("message", handler); resolve(false); }, 8000);
  });
}

export async function unpublishLayer(communityId, layerId) {
  const conn = getConn();
  if (!conn || !isAlive(conn)) return;
  conn.ws.send(JSON.stringify({
    type: "unpublish_layer",
    community_id: communityId,
    layer_id: layerId,
  }));
}

export async function listPublicLayers(communityId) {
  const conn = getConn();
  if (!conn || !isAlive(conn)) return [];
  return new Promise(resolve => {
    conn.ws.send(JSON.stringify({ type: "list_public_layers", community_id: communityId }));
    const handler = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "public_layers_list" && m.community_id === communityId) {
          conn.ws.removeEventListener("message", handler);
          resolve(m.layers || []);
        }
      } catch (_) {}
    };
    conn.ws.addEventListener("message", handler);
    setTimeout(() => { conn.ws.removeEventListener("message", handler); resolve([]); }, 5000);
  });
}

export async function subscribeLayer(communityId, layerId) {
  if (!state.signingPublicKey) return null;
  const conn = getConn();
  if (!conn || !isAlive(conn)) return null;
  return new Promise(resolve => {
    conn.ws.send(JSON.stringify({
      type: "subscribe_layer",
      community_id: communityId,
      layer_id: layerId,
      subscriber_pubkey: state.signingPublicKey,
    }));
    const handler = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === "layer_subscribed" && m.layer_id === layerId) {
          conn.ws.removeEventListener("message", handler);
          resolve(m);
        }
      } catch (_) {}
    };
    conn.ws.addEventListener("message", handler);
    setTimeout(() => { conn.ws.removeEventListener("message", handler); resolve(null); }, 15000);
  });
}

export async function unsubscribeLayer(communityId, layerId) {
  if (!state.signingPublicKey) return;
  const conn = getConn();
  if (!conn || !isAlive(conn)) return;
  conn.ws.send(JSON.stringify({
    type: "unsubscribe_layer",
    community_id: communityId,
    layer_id: layerId,
    subscriber_pubkey: state.signingPublicKey,
  }));
}

export async function syncSubscribedLayers() {
  if (!state.signingPublicKey) return;
  const conn = getConn();
  if (!conn || !isAlive(conn)) return;
  conn.ws.send(JSON.stringify({
    type: "sync_subscribed_layers",
    subscriber_pubkey: state.signingPublicKey,
    since: 0,
  }));
}

// ---- Layer message handlers ----

async function handleLayerSubscribed(msg) {
  // Called when a subscription is confirmed — returns layer DEK + initial data
  const layerDekWrapped = msg.layer_dek_wrapped;
  const communityId = msg.community_id;
  const layerId = msg.layer_id;
  if (!layerDekWrapped || !communityId || !layerId) return;

  try {
    // Unwrap the layer DEK using subscriber's own key pair
    const { unwrap_dek } = await import("./core/pkg/e2e_core.js");
    const existing = await DB.getTeam(state.currentSet);
    const layerDek = existing ? unwrap_dek(layerDekWrapped, existing.secret_key) : null;
    if (layerDek) {
      state.subscribedDEKs.set(`${communityId}:${layerId}`, layerDek);
    }

    // Store subscription
    await DB.saveSubscribedLayer({
      source_community_id: communityId,
      source_layer_id: layerId,
      source_community_name: msg.community_name || "",
      source_layer_name: msg.layer_name || "",
      layer_dek_wrapped: layerDekWrapped,
      subscribed_at: Date.now(),
      last_synced_at: Date.now(),
    });

    // Store initial pins and drawings
    await DB.importPins((msg.pins || []).map(p => ({ ...p, team_id: communityId })));
    await DB.importDrawings((msg.drawings || []).map(d => ({ ...d, team_id: communityId })));

    window._loadSubscribedPins?.();
    window._renderUI?.();
  } catch (e) {
    console.error("[relay] layer subscribe failed:", e.message);
    window._toast?.("Layer subscription failed", "#dc2626");
  }
}

async function handleLayerUpdate(msg) {
  const communityId = msg.community_id;
  const layerId = msg.layer_id;
  if (!communityId || !layerId) return;

  await DB.importPins((msg.pins || []).map(p => ({ ...p, team_id: communityId })));
  await DB.importDrawings((msg.drawings || []).map(d => ({ ...d, team_id: communityId })));

  // Update last_synced_at
  const sub = await DB.getSubscribedLayer(layerId).catch(() => null);
  if (sub) { sub.last_synced_at = Date.now(); await DB.saveSubscribedLayer(sub); }

  window._loadSubscribedPins?.();
  window._renderUI?.();
}

async function handleLayerPublished(msg) {
  // Community member received notification that a layer was published
  // Refresh local layers if in the same community
  if (state.currentCommunity?.community_id === msg.community_id) {
    await window._loadLayersForSet?.(state.currentSet);
    window._renderUI?.();
  }
}

async function handleLayerUnpublished(msg) {
  if (state.currentCommunity?.community_id === msg.community_id) {
    await window._loadLayersForSet?.(state.currentSet);
    window._renderUI?.();
  }
}

async function handleSubscribedSync(msg) {
  await DB.importPins((msg.pins || []).map(p => ({ ...p, team_id: p.community_id || state.currentSet })));
  await DB.importDrawings((msg.drawings || []).map(d => ({ ...d, team_id: d.community_id || state.currentSet })));
  window._loadSubscribedPins?.();
  window._renderUI?.();
}
