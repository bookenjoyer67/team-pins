import init, {
  generate_user_keypair, generate_dek, generate_uuid,
  wrap_dek, unwrap_dek, encrypt_pin_data, decrypt_pin_data,
  encrypt_geojson, decrypt_geojson, encode_hex, decode_hex,
  encrypt_raw_bytes, decrypt_raw_bytes,
  encrypt_with_password, decrypt_with_password,
  encrypt_bytes_with_password, decrypt_bytes_with_password,
  compress_gzip, decompress_gzip, compress_gzip_max,
  base64_encode, base64_decode, base64url_encode, base64url_decode,
  compress_gzip_to_base64,
  compact_and_pack_json, compact_pack_gzip_json,
  sign, verify,
  generate_qr_svg, serialize_container, deserialize_container,
} from "./core/pkg/e2e_core.js";
import * as DB from "./db.js";
import * as Peer from "./peer.js";
import { state } from "./state.js";
import { compressVideoBytes } from "./map.js";
import { compressImageBuffer } from "./workers/media-compress.js";
import { toast, showQRHostDialog, showQRJoinDialog, showQRAnswerDialog, showPeerPaste, showQRScanDialog, showPasswordDialog, showProgressDialog, escapeHtml, promptRoomPassword, confirmDialog, alertDialog } from "./dialogs.js";
import { DeferredBoundedMap, DeferredChunkStore } from "./store-helpers.js";

function recordNotification(opts) {
  if (!state.currentSet) return;
  const n = {
    id: generate_uuid(),
    community_id: opts.community_id || state.currentSet,
    type: opts.type,
    pin_id: opts.pin_id,
    pin_title: opts.pin_title || "Untitled",
    annotation_id: opts.annotation_id || null,
    by_name: opts.by_name || "Someone",
    by_pubkey: opts.by_pubkey || "",
    text_preview: opts.text_preview || null,
    created_at: Date.now(),
    read: false,
  };
  const notifications = state.notifications;
  notifications.unshift(n);
  if (notifications.length > 100) notifications.pop();
  state.notifications = notifications;
  window._renderUI?.();
}

// --- Message chunking (WASM-backed, size-capped + TTL-auto-eviction) ---
const MAX_CHUNKS = 500;
const MAX_BATCH_CHUNKS = 200;
const chunkStore = new DeferredChunkStore(MAX_CHUNKS, 60_000);
const syncBatchStore = new DeferredBoundedMap(200, 30_000);

// Peer location store (120s TTL, accessed from map.js via window._peerLocations)
window._peerLocations = new DeferredBoundedMap(200, 120_000);

function splitMessage(msg) {
  if (msg.length < 16000) return null;
  const id = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const total = Math.ceil(msg.length / 15000);
  const chunks = [];
  for (let i = 0; i < total; i++) {
    chunks.push(msg.slice(i * 15000, (i + 1) * 15000));
  }
  return { id, nonce, total, chunks };
}

function reassembleChunk(senderId, id, index, total, chunk, nonce) {
  if (total > MAX_CHUNKS || index >= total) return null;
  const key = `${senderId}:${id}:${nonce}`;
  if (chunkStore.add_chunk(key, index, total, chunk)) {
    const full = chunkStore.assemble(key);
    chunkStore.remove(key);
    if (full) {
      try { JSON.parse(full); } catch (_) { return null; }
      return full;
    }
  }
  return null;
}

// --- Batch sync helpers ---

function accumulateBatch(key, batchIndex, totalBatches, data) {
  if (totalBatches > MAX_BATCH_CHUNKS || batchIndex >= totalBatches) return null;
  let entry = syncBatchStore.get(key);
  if (!entry) {
    entry = { chunks: new Array(totalBatches), count: 0 };
    syncBatchStore.set(key, entry);
  }
  if (entry.chunks[batchIndex] === undefined) {
    entry.chunks[batchIndex] = data;
    entry.count++;
    syncBatchStore.set(key, entry);  // persist mutation to WASM Store
  }
  if (entry.count >= totalBatches) {
    const merged = entry.chunks.flat();
    syncBatchStore.delete(key);
    return merged;
  }
  return null;
}

// --- Data compaction ---

function stripEmpties(obj, depth = 0) {
  if (depth > 100) return undefined;
  if (Array.isArray(obj)) {
    const out = [];
    for (const v of obj) {
      const c = stripEmpties(v, depth + 1);
      if (c !== undefined) out.push(c);
    }
    return out;
  }
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const c = stripEmpties(v, depth + 1);
      if (c !== undefined && c !== null && c !== "" && !(Array.isArray(c) && c.length === 0) &&
          !(c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0)) {
        out[k] = c;
      }
    }
    return out;
  }
  return obj;
}

// --- Hex ↔ base64 conversion for ciphertext fields ---

const HEX_KEYS = new Set(["public_key", "secret_key", "wrapped_dek", "ciphertext", "nonce", "encrypted_geojson"]);

function hexToBytes(hex) {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return new Uint8Array(0);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToBase64(bytes) {
  return base64_encode(bytes);
}

function base64ToBytes(b64) {
  return base64_decode(b64);
}

function walkHexFields(obj, fn, depth = 0) {
  if (depth > 100) return obj;
  if (Array.isArray(obj)) return obj.map(v => walkHexFields(v, fn, depth + 1));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = HEX_KEYS.has(k) && typeof v === "string" ? fn(v) : walkHexFields(v, fn, depth + 1);
    }
    return out;
  }
  return obj;
}

function packHexFields(data) {
  return walkHexFields(data, v => {
    if (/^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0) return bytesToBase64(hexToBytes(v));
    return v;
  });
}

function unpackHexFields(data) {
  return walkHexFields(data, v => {
    if (/^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0) return v; // already hex (old format)
    try { return encode_hex(base64ToBytes(v)); } catch (_) { return v; }
  });
}

// --- Binary container (no JSON, no base64 — raw bytes, handled in Rust) ---

function serializeBinary(data) {
  return serialize_container(JSON.stringify(stripEmpties(data)));
}

function deserializeBinary(buf) {
  return JSON.parse(deserialize_container(buf));
}

// --- Export-time media re-compression for old uploads ---

async function compactStoredMedia(data, onProgress, compressVideos = false) {
  if (!state.dek) return data;
  const items = [...(data.pins || []), ...(data.drawings || [])];
  const total = items.filter(i => i.media).length;
  let done = 0;
  let savedBytes = 0;
  let compressedCount = 0;
  const compact = async (item) => {
    if (!item.media) return item;
    const m = item.media;
    const ext = (m.name || "").split(".").pop().toLowerCase();
    if (ext === "webp" || ext === "webm") { done++; onProgress?.(done, total); return item; }
    try {
      const raw = decrypt_raw_bytes(m.ciphertext, m.nonce, state.dek);
      let result = null;
      if (m.type && m.type.startsWith("video/") && compressVideos) {
        result = await compressVideoBytes(raw, m.type, m.name);
        if (result.compressed === false) {
          toast("Video skipped — " + (result.reason || "unsupported format"), "#f97316");
        }
      } else if (m.type && m.type.startsWith("image/") && !m.type.includes("gif") && !m.type.includes("svg")) {
        result = await compressImageBuffer(raw, m.type, m.name);
      }
      if (result && result.buffer.byteLength < raw.byteLength) {
        const enc = encrypt_raw_bytes(result.buffer, state.dek);
        item.media = { type: result.type, name: result.name, ciphertext: enc.ciphertext, nonce: enc.nonce };
        savedBytes += raw.byteLength - result.buffer.byteLength;
        compressedCount++;
      }
    } catch (_) {}
    done++;
    onProgress?.(done, total);
    return item;
  };
  if (data.pins) data.pins = await Promise.all(data.pins.map(compact));
  if (data.drawings) data.drawings = await Promise.all(data.drawings.map(compact));
  if (total > 0) {
    if (savedBytes > 0) {
      const mb = (savedBytes / 1024 / 1024).toFixed(1);
      toast(`Compacted ${compressedCount} media item${compressedCount !== 1 ? "s" : ""} (${mb} MB saved)`, "#16a34a");
    } else {
      toast("Media already optimal — no savings", "#6b7280");
    }
  }
  return data;
}

let _meshBroadcast = null;
const passwordAuthPeers = new Set();
export function setMeshBroadcast(cb) { _meshBroadcast = cb; }

export function setupPeer() {
  Peer.setOnMessage((msg, connId) => handleMessage(msg, connId));
  Peer.setOnConnectionChange((connId, peerState) => {
    if (peerState === "connected") {
      Peer.send({ type: "peer_info", data: { display_name: state.displayName, set_id: state.currentSet, user_id: state.user.id } }, connId);
      setTimeout(() => sendAll(null, connId), 300);
      import("./gossip.js").then(g => g.sendCapabilityAnnounce(connId)).catch(() => {});
      toast("Peer connected", "#16a34a");
    } else if (peerState === "disconnected") {
      state.hostedConnections.delete(connId);
      state.peers.delete(connId);
      passwordAuthPeers.delete(connId);
      window._renderPeerList?.();
    }
    window._renderUI?.();
  });
}

function relayToOthers(msg, fromConnId) {
  for (const [cid] of state.peers) {
    if (cid !== fromConnId) Peer.send({ ...msg, _relay: true }, cid);
  }
}

export async function handleMessage(msg, connId) {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;
  const d = unpackHexFields(msg.data || {});
  if (d && typeof d.ts === "number") {
    const age = Date.now() - d.ts;
    if (age < -120000 || age > 120000) return;
  }
  switch (msg.type) {
    case "peer_info": {
      if (!d || typeof d.display_name !== "string" || d.display_name.length > 100
        || typeof d.user_id !== "string" || d.user_id.length > 64) return;
      const existing = [...state.peers.values()].find(p => p.userId === msg.data.user_id);
      state.peers.set(connId, { name: msg.data.display_name, setId: msg.data.set_id, userId: msg.data.user_id });
      DB.saveKnownPeer({ user_id: msg.data.user_id, display_name: msg.data.display_name, last_seen: Date.now() });
      state.peers.delete("known_" + msg.data.user_id);
      if (state.hostedConnections.has(connId) && msg.data.user_id && !existing) {
        for (const [cid] of state.peers) { if (cid !== connId) Peer.send({ type: "new_peer_mesh", data: { user_id: msg.data.user_id, display_name: msg.data.display_name } }, cid); }
      }
      if (!state.hostedConnections.has(connId) && !existing) {
        setTimeout(() => sendAll(state.currentSet, connId), 50);
      }
      window._renderPeerList?.(); break;
    }
    case "new_peer_mesh": {
      if (!d || typeof d.user_id !== "string" || d.user_id.length > 64) return;
      if (msg.data.user_id !== state.user.id && ![...state.peers.values()].some(p => p.userId === msg.data.user_id)) {
        const result = await Peer.createOffer(state.user.id, state.displayName, state.currentSet);
        Peer.send({ type: "mesh_offer", data: { offer: result.code, from_user: state.user.id, from_name: state.displayName, for_user: msg.data.user_id, connId: result.connId } });
      }
      break;
    }
    case "mesh_offer": {
      if (!d || typeof d.offer !== "string" || typeof d.from_user !== "string" || d.from_user.length > 64) return;
      if (msg.data.for_user === state.user.id || !msg.data.for_user) {
        const { code: answer } = await Peer.acceptOffer(msg.data.offer, state.user.id, state.displayName);
        Peer.send({ type: "mesh_answer", data: { answer, to_user: msg.data.from_user, offer_connId: msg.data.connId } }, connId);
      } else {
        const tc = [...state.peers.entries()].find(([, p]) => p.userId === msg.data.for_user);
        if (tc) Peer.send(msg, tc[0]);
      }
      break;
    }
    case "mesh_answer": {
      if (!d || typeof d.answer !== "string") return;
      if (msg.data.to_user === state.user.id || !msg.data.to_user) {
        if (msg.data.offer_connId && Peer.hasConnection(msg.data.offer_connId)) await Peer.finalizeConnection(msg.data.offer_connId, msg.data.answer);
      } else {
        const tc = [...state.peers.entries()].find(([, p]) => p.userId === msg.data.to_user);
        if (tc) Peer.send(msg, tc[0]);
      }
      break;
    }
    case "keys": {
      const isPasswordDerived = d.key_derivation === "pbkdf2";
      if (!d || typeof d.public_key !== "string" || typeof d.wrapped_dek !== "string"
        || d.public_key.length > 256 || d.wrapped_dek.length > 512) return;
      // For non-PBKDF2, secret_key is optional (per-member model)
      if (!isPasswordDerived && d.secret_key && d.secret_key.length > 256) return;
      const sid = d.set_id || generate_uuid();
      let public_key = d.public_key;
      let secret_key = d.secret_key || "";
      if (isPasswordDerived) {
        const existingTeam = await DB.getTeam(sid).catch(() => null);
        if (!existingTeam || !existingTeam.secret_key) {
          const { generate_user_keypair_from_password, encode_hex } = await import("./core/pkg/e2e_core.js");
          const pass = await promptRoomPassword("This community requires a password to join");
          if (!pass) return;
          const kp = generate_user_keypair_from_password(pass, sid);
          public_key = encode_hex(kp.public);
          secret_key = encode_hex(kp.secret);
        } else {
          public_key = existingTeam.public_key;
          secret_key = existingTeam.secret_key;
        }
      } else if (!d.secret_key) {
        // Per-member model: generate own keypair
        const existingTeam = await DB.getTeam(sid).catch(() => null);
        if (!existingTeam) {
          const { generate_user_keypair, encode_hex } = await import("./core/pkg/e2e_core.js");
          const kp = generate_user_keypair();
          public_key = encode_hex(kp.public);
          secret_key = encode_hex(kp.secret);
        } else {
          public_key = existingTeam.public_key;
          secret_key = existingTeam.secret_key;
        }
      }
      await DB.saveTeam({ team_id: sid, name: d.name || sid.slice(0, 8), public_key, secret_key, wrapped_dek: d.wrapped_dek, key_derivation: d.key_derivation || "random", community_public_key: d.community_public_key || d.public_key, community_secret_key: d.community_secret_key || "", community_wrapped_dek: d.wrapped_dek || "" });
      const existingCommunity = await DB.getCommunity(sid);
      if (!existingCommunity) {
        await DB.saveCommunity({
          community_id: sid, name: d.name || sid.slice(0, 8), description: "",
          genesis_public_key: d.genesis_public_key || state.signingPublicKey || "",
          genesis_created_at: Date.now(), members: [], governance: d.governance || { contribution: "open", validation: "none", schema_authority: "any_member", key_rotation: "founder_only", fork_policy: "allowed", join_policy: "open" },
          bounds: null, relay_nodes: d.relay_nodes || [],
          visibility: "local",
        });
      }
      window._names[sid] = (d.name || sid.slice(0, 8)) + " (← peer)";
      window._pendingSet = sid;
      if (sid === state.currentSet) {
        state.dek = unwrap_dek(d.wrapped_dek, secret_key);
        await window._loadPins();
        await window._loadDrawings();
      }
      if (window._pendingJoinSet) { window._pendingJoinSet = false; await window._switchSet(sid); }
      break;
    }
    case "new_pin": {
      if (!d || typeof d.team_id !== "string" || typeof d.ciphertext !== "string" || typeof d.nonce !== "string" || typeof d.pin_id !== "string") return;
      if (d.media && (typeof d.media.type !== "string" || typeof d.media.ciphertext !== "string" || typeof d.media.nonce !== "string" || d.media.type.length > 32)) return;
      const pinData = { ...d };
      if (!pinData.author_pubkey) delete pinData.author_pubkey;
      const sid = pinData.team_id || window._pendingSet;
      if (sid) await DB.importPin({ ...pinData, team_id: sid });
      if (sid === state.currentSet) await window._loadPins();
      if (!msg._relay && d.author_pubkey && d.author_pubkey !== state.signingPublicKey && sid === state.currentSet) {
        try {
          const dec = decrypt_pin_data(d.ciphertext, d.nonce, state.dek);
          recordNotification({ type: "pin_added", pin_id: d.pin_id, pin_title: dec?.title || "Untitled", by_pubkey: d.author_pubkey });
        } catch (_) {}
      }
      window._addHistory?.(sid === state.currentSet ? "Pin added (peer)" : "", d.pin_id.slice(0, 8));
      if (!msg._relay) relayToOthers(msg, connId);
      break;
    }
    case "delete_pin": {
      if (!d || typeof d.pin_id !== "string") return;
      if (!msg._relay) {
        const existing = await DB.getPin(d.pin_id).catch(() => null);
        if (!existing) { console.warn("[sync] delete_pin: pin not found", d.pin_id); return; }
        if (existing.author_pubkey) {
          if (!d.by_pubkey || existing.author_pubkey !== d.by_pubkey) {
            console.warn("[sync] delete_pin: unauthorized deletion of", d.pin_id);
            return;
          }
          if (d.signature) {
            try {
              const rawPayload = d.pin_id + "|" + (d.timestamp || "");
              const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
              if (!verify(payloadHex, d.signature, d.by_pubkey)) {
                console.warn("[sync] delete_pin: invalid signature", d.pin_id);
                return;
              }
            } catch (_) { return; }
          }
        } else {
          console.warn("[sync] delete_pin: rejecting legacy pin deletion without author_pubkey", d.pin_id);
          return;
        }
      }
      await DB.deletePin(d.pin_id);
      if (state.currentSet) { await window._loadPins(); window._addHistory?.("Pin deleted (peer)", d.pin_id.slice(0, 8)); }
      if (!msg._relay) relayToOthers(msg, connId);
      break;
    }
    case "new_drawing": {
      if (!d || typeof d.team_id !== "string" || typeof d.encrypted_geojson !== "string" || typeof d.nonce !== "string" || typeof d.drawing_id !== "string") return;
      const sid = d.team_id || window._pendingSet;
      if (sid) await DB.importDrawing({ ...d, team_id: sid });
      if (sid === state.currentSet) { await window._loadDrawings(); window._addHistory?.("Drawing added (peer)", d.drawing_id.slice(0, 8)); }
      if (!msg._relay) relayToOthers(msg, connId);
      break;
    }
    case "delete_drawing": {
      if (!d || typeof d.drawing_id !== "string") return;
      if (!msg._relay) {
        const existing = await DB.getDrawing(d.drawing_id).catch(() => null);
        if (!existing) { console.warn("[sync] delete_drawing: drawing not found", d.drawing_id); return; }
        if (existing.author_pubkey) {
          if (!d.by_pubkey || existing.author_pubkey !== d.by_pubkey) {
            console.warn("[sync] delete_drawing: unauthorized deletion of", d.drawing_id);
            return;
          }
          if (d.signature) {
            try {
              const rawPayload = d.drawing_id + "|" + (d.timestamp || "");
              const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
              if (!verify(payloadHex, d.signature, d.by_pubkey)) {
                console.warn("[sync] delete_drawing: invalid signature", d.drawing_id);
                return;
              }
            } catch (_) { return; }
          }
        } else {
          console.warn("[sync] delete_drawing: rejecting legacy drawing deletion without author_pubkey", d.drawing_id);
          return;
        }
      }
      await DB.deleteDrawing(d.drawing_id);
      if (state.currentSet) { await window._loadDrawings(); window._addHistory?.("Drawing deleted (peer)", d.drawing_id.slice(0, 8)); }
      if (!msg._relay) relayToOthers(msg, connId);
      break;
    }
    case "sync_pins": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data)) return;
      await processSyncPins(d.set_id, d.data);
      break;
    }
    case "sync_pins_batch": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data) || typeof d.batchIndex !== "number" || typeof d.totalBatches !== "number") return;
      const batchKey = `pins:${d.set_id}`;
      const merged = accumulateBatch(batchKey, d.batchIndex, d.totalBatches, d.data);
      if (merged) {
        await processSyncPins(d.set_id, merged);
        toast("Synced " + merged.length + " pins", "#16a34a");
      }
      break;
    }
    case "sync_drawings": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data)) return;
      await processSyncDrawings(d.set_id, d.data);
      if (d.data && d.data.length) toast("Synced " + d.data.length + " drawings", "#16a34a");
      break;
    }
    case "sync_drawings_batch": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data) || typeof d.batchIndex !== "number" || typeof d.totalBatches !== "number") return;
      const batchKey = `drawings:${d.set_id}`;
      const merged = accumulateBatch(batchKey, d.batchIndex, d.totalBatches, d.data);
      if (merged) {
        await processSyncDrawings(d.set_id, merged);
        toast("Synced " + merged.length + " drawings", "#16a34a");
      }
      break;
    }
    case "password_required": {
      if (!d || typeof d.set_id !== "string") return;
      import("./dialogs.js").then(async mod => {
        const pass = await mod.promptRoomPassword("This community requires a password to join");
        if (!pass) return;
        const hash = await mod.hashCommunityPassword(pass, d.set_id);
        broadcast("password_verify", { set_id: d.set_id, password_hash: hash }, connId);
      }).catch(() => {});
      break;
    }
    case "password_verify": {
      if (!d || typeof d.set_id !== "string" || typeof d.password_hash !== "string") return;
      const c = await DB.getCommunity(d.set_id);
      if (!c || !c.password_hash) return;
      if (d.password_hash === c.password_hash) {
        passwordAuthPeers.add(connId);
        await sendAll(d.set_id, connId);
      } else {
        broadcast("password_denied", { set_id: d.set_id }, connId);
      }
      break;
    }
    case "password_denied": {
      import("./dialogs.js").then(mod => mod.toast?.("Wrong password — access denied", "#dc2626"));
      break;
    }
    case "sync_schemas": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data)) return;
      for (const s of (d.data || [])) {
        const existing = await DB.getSchemas();
        if (!existing.find(e => e.schema_id === s.schema_id)) {
          await DB.saveSchema(s);
        }
      }
      break;
    }
    case "new_annotation": {
      if (!d || typeof d.annotation_id !== "string" || typeof d.pin_id !== "string" || typeof d.ciphertext !== "string" || typeof d.nonce !== "string") return;
      const cid = d.team_id || state.currentSet;
      if (!cid) return;
      await DB.saveAnnotation({
        annotation_id: d.annotation_id, pin_id: d.pin_id, community_id: cid,
        ciphertext: d.ciphertext, nonce: d.nonce,
        author_pubkey: d.author_pubkey || "", created_at: d.created_at || d.ts || Date.now(),
        media: d.media || null,
        parent_id: d.parent_id || null,
      });
      if (!msg._relay) relayToOthers(msg, connId);
      window._refreshPinPopup?.(d.pin_id);
      window._addHistory?.("Annotation added (peer)", d.annotation_id.slice(0, 8));
      // Notifications: notify if this comment involves the current user
      if (!msg._relay && d.author_pubkey !== state.signingPublicKey) {
        if (d.parent_id) {
          const parent = await DB.getAnnotation(d.parent_id).catch(() => null);
          if (parent && parent.author_pubkey === state.signingPublicKey) {
            const pin = await DB.getPin(d.pin_id).catch(() => null);
            recordNotification({ type: "reply", pin_id: d.pin_id, pin_title: pin?.pin_id ? "Pin" : "Untitled", annotation_id: d.annotation_id, by_pubkey: d.author_pubkey, text_preview: (d.text_preview || "").slice(0, 60) });
          }
        } else {
          const pin = await DB.getPin(d.pin_id).catch(() => null);
          if (pin && pin.author_pubkey === state.signingPublicKey) {
            recordNotification({ type: "comment", pin_id: d.pin_id, pin_title: "Pin", annotation_id: d.annotation_id, by_pubkey: d.author_pubkey, text_preview: (d.text_preview || "").slice(0, 60) });
          } else {
            const anns = await DB.getAnnotationsByPin(d.pin_id, 0, 1);
            const iParticipated = anns.some(a => a.author_pubkey === state.signingPublicKey);
            if (iParticipated) {
              recordNotification({ type: "comment", pin_id: d.pin_id, pin_title: "Pin", annotation_id: d.annotation_id, by_pubkey: d.author_pubkey, text_preview: (d.text_preview || "").slice(0, 60) });
            }
          }
        }
      }
      break;
    }
    case "annotation_vote": {
      if (!d || typeof d.annotation_id !== "string" || typeof d.pubkey !== "string" || typeof d.signature !== "string") return;
      const rawPayload = d.annotation_id + "|" + (d.direction || "") + "|" + (d.timestamp || "");
      const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
      if (!verify(payloadHex, d.signature, d.pubkey)) return;
      const ann = await DB.getAnnotation(d.annotation_id);
      if (!ann) break;
      ann.votes = ann.votes || [];
      const existingIdx = ann.votes.findIndex(v => v.pubkey === d.pubkey);
      if (existingIdx >= 0) ann.votes[existingIdx] = { pubkey: d.pubkey, direction: d.direction, timestamp: d.timestamp, signature: d.signature };
      else ann.votes.push({ pubkey: d.pubkey, direction: d.direction, timestamp: d.timestamp, signature: d.signature });
      await DB.saveAnnotation(ann);
      if (!msg._relay) relayToOthers(msg, connId);
      window._refreshPinPopup?.(ann.pin_id);
      if (!msg._relay && d.pubkey !== state.signingPublicKey && ann.author_pubkey === state.signingPublicKey) {
        recordNotification({ type: "vote", pin_id: ann.pin_id, pin_title: "Pin", annotation_id: d.annotation_id, by_pubkey: d.pubkey });
      }
      break;
    }
    case "new_tombstone": {
      if (!d || typeof d.tombstone_id !== "string" || typeof d.target_id !== "string" || typeof d.by_pubkey !== "string") return;
      const existingAnn = await DB.getAnnotation(d.target_id).catch(() => null);
      if (existingAnn && existingAnn.author_pubkey && d.by_pubkey !== existingAnn.author_pubkey) {
        console.warn("[sync] tombstone: pubkey mismatch, rejecting", d.tombstone_id);
        return;
      }
      if (d.signature && verify && encode_hex) {
        try {
          const rawPayload = d.target_id + "|" + d.tombstone_id + "|" + (d.timestamp || "");
          const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
          if (!verify(payloadHex, d.signature, d.by_pubkey)) {
            console.warn("[sync] tombstone: invalid signature", d.tombstone_id);
            return;
          }
        } catch (_) { return; }
      }
      await DB.saveTombstone({ tombstone_id: d.tombstone_id, target_id: d.target_id, by_pubkey: d.by_pubkey, reason: d.reason || "", timestamp: d.timestamp || d.ts || Date.now(), signature: d.signature || "" });
      const ann = await DB.getAnnotation(d.target_id);
      if (ann) window._refreshPinPopup?.(ann.pin_id);
      if (!msg._relay) relayToOthers(msg, connId);
      break;
    }
    case "sync_annotations": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data)) return;
      await processSyncAnnotations(d.set_id, d.data);
      break;
    }
    case "sync_annotations_batch": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data) || typeof d.batchIndex !== "number" || typeof d.totalBatches !== "number") return;
      const batchKey = `annotations:${d.set_id}`;
      const merged = accumulateBatch(batchKey, d.batchIndex, d.totalBatches, d.data);
      if (merged) {
        await processSyncAnnotations(d.set_id, merged);
      }
      break;
    }
    case "sync_request": await sendAll(); break;
    case "map_view": {
      if (!d || !Array.isArray(d.center) || d.center.length !== 2 || typeof d.center[0] !== "number" || typeof d.center[1] !== "number" || typeof d.team_id !== "string") return;
      if (d.center && state.map && (d.team_id === state.currentSet || d.team_id === window._pendingSet || d.team_id === window._pendingJoinSet)) {
        if (state.followMap) {
          state.suppressMapSync = true;
          state.map.setView(d.center, d.zoom || 5);
          setTimeout(() => { state.suppressMapSync = false; }, 600);
        }
      } else if (d.center && state.map) {
        window._pendingMapView = { center: d.center, zoom: d.zoom || 5 };
      }
      const peer = state.peers.get(connId);
      if (d.center && peer && d.team_id) {
        window._peerLocations.set(connId, { lat: d.center[0], lng: d.center[1], name: peer.name, team_id: d.team_id });
        window._renderPeerMarkers?.();
      }
      if (!msg._relay) relayToOthers(msg, connId);
      break;
    }
    case "chunk": {
      if (!d || typeof d.id !== "string" || typeof d.index !== "number" || typeof d.total !== "number" || typeof d.chunk !== "string") return;
      const { id, index, total, chunk, nonce } = d;
      const full = reassembleChunk(connId, id, index, total, chunk, nonce || "");
      if (full) handleMessage(JSON.parse(full), connId);
      break;
    }
    case "gossip_capabilities": {
      const { handleCapabilityAnnounce } = await import("./gossip.js");
      handleCapabilityAnnounce(d);
      break;
    }
    case "gossip_query": {
      const { handleQuery } = await import("./gossip.js");
      handleQuery(d, connId);
      break;
    }
    case "gossip_response": {
      if (window._gossipResponseHandler) window._gossipResponseHandler(d);
      break;
    }
    case "schema_publish": {
      if (!d || typeof d.schema_id !== "string") return;
      const existing = await DB.getSchemas();
      if (!existing.find(e => e.schema_id === d.schema_id)) {
        await DB.saveSchema({ schema_id: d.schema_id, name: d.name || "", fields: d.fields || [], version: d.version || 1, forked_from: d.forked_from || null, published: d.published || true });
      } else if (d.version && existing.find(e => e.schema_id === d.schema_id && (e.version || 1) < d.version)) {
        await DB.saveSchema({ ...existing.find(e => e.schema_id === d.schema_id), name: d.name, fields: d.fields, version: d.version, forked_from: d.forked_from });
      }
      if (state.schemas) await window._loadSchemas?.(state.currentSet);
      break;
    }
    case "new_chain": {
      if (!d || !d.chain_id) return;
      await DB.saveChain(d);
      window._loadChains?.();
      break;
    }
    case "delete_chain": {
      if (!d || !d.chain_id) return;
      await DB.deleteChain(d.chain_id);
      window._loadChains?.();
      break;
    }
    case "sync_chains": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data)) return;
      await processSyncChains(d.set_id, d.data);
      break;
    }
    case "sync_chains_batch": {
      if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data) || typeof d.batchIndex !== "number" || typeof d.totalBatches !== "number") return;
      const batchKey = `chains:${d.set_id}`;
      const merged = accumulateBatch(batchKey, d.batchIndex, d.totalBatches, d.data);
      if (merged) processSyncChains(d.set_id, merged);
      break;
    }
  }
}

export function broadcastPinVote(pinId, dir) {
  if (!state.currentSet) return;
  import("./relay.js").then(r => r.sendPinVote(state.currentSet, pinId, dir)).catch(e => { console.warn("[sync] pin vote relay failed:", e.message); });
}

async function processSyncPins(setId, data) {
  const sid = setId || window._pendingSet;
  const pins = (data || []).map(p => {
    if (!p.author_pubkey) delete p.author_pubkey;
    return { ...p, team_id: sid };
  });
  await DB.importPins(pins);
  window._pendingSet = null;
  await window._loadSetList();
  if (sid === state.currentSet) await window._loadPins();
  window._renderUI?.();
}

async function processSyncDrawings(setId, data) {
  const sid = setId || window._pendingSet;
  await DB.importDrawings((data || []).map(d => ({ ...d, team_id: sid })));
  if (sid === state.currentSet) await window._loadDrawings();
  window._renderUI?.();
}

async function processSyncAnnotations(setId, data) {
  await DB.saveAnnotations((data || []).map(a => ({ ...a, community_id: setId })));
  window._refreshAllPinPopups?.();
}

async function processSyncChains(setId, data) {
  for (const c of (data || [])) {
    await DB.saveChain({ ...c, community_id: setId || c.community_id });
  }
  window._loadChains?.();
}

export async function sendAll(sid, connId) {
  const set = sid || state.currentSet;
  if (!Peer.isConnected() || !set) return;
  const t = await DB.getTeam(set);
  const c = await DB.getCommunity(set);

  if (t && connId && c?.password_hash && !passwordAuthPeers.has(connId)) {
    broadcast("password_required", { set_id: set, name: window._names[set] || set.slice(0, 8) }, connId);
    return;
  }

  if (t) {
    const isPasswordDerived = t.key_derivation === "pbkdf2";
    broadcast("keys", {
      set_id: set,
      name: window._names[set] || set.slice(0, 8),
      public_key: t.public_key,
      secret_key: t.secret_key || "",
      wrapped_dek: t.wrapped_dek,
      key_derivation: isPasswordDerived ? "pbkdf2" : "random",
      genesis_public_key: c?.genesis_public_key || state.signingPublicKey,
      governance: c?.governance || null,
      relay_nodes: c?.relay_nodes || [],
    }, connId);
  }

  const BATCH_SIZE = 50;
  const allPins = await DB.getAllPins(set);
  if (allPins && allPins.length > 0) {
    for (let i = 0; i < allPins.length; i += BATCH_SIZE) {
      broadcast("sync_pins_batch", {
        set_id: set,
        batchIndex: Math.floor(i / BATCH_SIZE),
        totalBatches: Math.ceil(allPins.length / BATCH_SIZE),
        data: allPins.slice(i, i + BATCH_SIZE),
      }, connId);
    }
  } else {
    broadcast("sync_pins", { set_id: set, data: [] }, connId);
  }

  const allDrawings = await DB.getAllDrawings(set);
  if (allDrawings && allDrawings.length > 0) {
    for (let i = 0; i < allDrawings.length; i += BATCH_SIZE) {
      broadcast("sync_drawings_batch", {
        set_id: set,
        batchIndex: Math.floor(i / BATCH_SIZE),
        totalBatches: Math.ceil(allDrawings.length / BATCH_SIZE),
        data: allDrawings.slice(i, i + BATCH_SIZE),
      }, connId);
    }
  } else {
    broadcast("sync_drawings", { set_id: set, data: [] }, connId);
  }

  const anns = await DB.getAnnotationsByCommunity(set);
  if (anns && anns.length > 0) {
    for (let i = 0; i < anns.length; i += BATCH_SIZE) {
      broadcast("sync_annotations_batch", {
        set_id: set,
        batchIndex: Math.floor(i / BATCH_SIZE),
        totalBatches: Math.ceil(anns.length / BATCH_SIZE),
        data: anns.slice(i, i + BATCH_SIZE),
      }, connId);
    }
  }

  const chains = await DB.getChainsByCommunity(set);
  if (chains && chains.length > 0) {
    for (let i = 0; i < chains.length; i += BATCH_SIZE) {
      broadcast("sync_chains_batch", {
        set_id: set,
        batchIndex: Math.floor(i / BATCH_SIZE),
        totalBatches: Math.ceil(chains.length / BATCH_SIZE),
        data: chains.slice(i, i + BATCH_SIZE),
      }, connId);
    }
  } else {
    broadcast("sync_chains", { set_id: set, data: [] }, connId);
  }

  const schemas = await DB.getSchemas();
  if (schemas && schemas.length) broadcast("sync_schemas", { set_id: set, data: schemas }, connId);

  if (state.map) {
    const s = await DB.getSettings(set);
    broadcast("map_view", { center: s?.map_center || [state.map.getCenter().lat, state.map.getCenter().lng], zoom: s?.map_zoom || state.map.getZoom() }, connId);
  }
}

export function broadcast(type, data, connId) {
  if (!state.currentSet) return;
  let meshData = data;
  if (state.signingPublicKey) {
    if (type === "delete_pin" || type === "delete_drawing") {
      meshData = { ...data, by_pubkey: state.signingPublicKey };
      if (state.signingSecretKey) {
        try {
          const ts = Date.now();
          const rawPayload = (data.pin_id || data.drawing_id) + "|" + ts;
          const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
          const sig = sign(payloadHex, state.signingSecretKey);
          if (sig) meshData = { ...meshData, signature: sig, timestamp: ts };
        } catch (e) {
          console.warn("[sync] sig failed for", type, data?.pin_id || data?.drawing_id || "", e.message);
        }
      }
    }
  }
  if (!connId && type !== "map_view") _meshBroadcast?.(type, meshData);

  if (type === "new_pin") {
    window._relayPushDelta?.(state.currentSet, [{ ...data, team_id: undefined, set_id: undefined, ts: undefined }], [], [], [], [], []);
  } else if (type === "new_drawing") {
    window._relayPushDelta?.(state.currentSet, [], [], [{ ...data, drawing_id: data.drawing_id }], [], [], []);
  } else if (type === "new_annotation") {
    window._relayPushDelta?.(state.currentSet, [], [{ ...data, annotation_id: data.annotation_id }], [], [], [], []);
  } else if (type === "new_tombstone") {
    window._relayPushDelta?.(state.currentSet, [], [], [], [{ ...data, tombstone_id: data.tombstone_id }], [], []);
  } else if (type === "delete_pin") {
    window._relayPushDelta?.(state.currentSet, [], [], [], [], [data.pin_id], []);
  } else if (type === "delete_drawing") {
    window._relayPushDelta?.(state.currentSet, [], [], [], [], [], [data.drawing_id]);
  } else if (type === "new_chain") {
    window._relayPushDelta?.(state.currentSet, [], [], [], [], [], [], [data], []);
  } else if (type === "delete_chain") {
    window._relayPushDelta?.(state.currentSet, [], [], [], [], [], [], [], [data.chain_id]);
  }

  const payload = packHexFields({ ...data, team_id: state.currentSet, ts: Date.now() });
  const msg = JSON.stringify({ type, data: payload });
  const chunks = splitMessage(msg);
  if (!chunks) {
    Peer.send({ type, data: payload }, connId);
  } else {
    for (let i = 0; i < chunks.total; i++) {
      Peer.send({ type: "chunk", data: { id: chunks.id, index: i, total: chunks.total, chunk: chunks.chunks[i], nonce: chunks.nonce, ts: Date.now() } }, connId);
    }
  }
}

export async function hostGroup() {
  if (!state.currentSet) return;
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:360px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">Host Group</h3><p style="color:var(--text-dim);font-size:13px;">Preparing connection...</p></div>`;
  document.body.appendChild(ov);
  try {
    const { connId, code, compact } = await Peer.createOffer(state.user.id, state.displayName, state.currentSet);
    state.hostedConnections.add(connId);
    state.pendingConnId = connId;
    const urlCode = btoa(compact).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const joinLink = window.location.origin + window.location.pathname + "#join=" + urlCode;
    ov.remove();
    showQRHostDialog(connId, code, compact, joinLink, {
      onPeerHandshake: hostPeerHandshake,
      onRenderUI: window._renderUI,
      onAddAnother: () => hostGroup(),
    });
  } catch (e) { ov.remove(); await alertDialog("Failed: " + e.message); }
}

function connectRelayRoom({ relayUrl, roomId, password, title, retryFn, onWelcome, onMessage }) {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${escapeHtml(title)}</h3><p style="color:var(--text-dim);font-size:13px;">Connecting relay...</p></div>`;
  document.body.appendChild(ov);

  let ws;
  let done = false;
  let clientId = null;

  try {
    ws = new WebSocket(relayUrl.replace(/\/$/, ""));
  } catch (e) { ov.remove(); alertDialog("Invalid relay URL"); return; }

  const cleanup = () => {
    done = true;
    if (ws && ws.readyState < 2) ws.close();
    ov.remove();
  };

  const sendJoin = () => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "join", room: roomId, pw: password || undefined })); };

  ws.onerror = () => {
    if (ov.querySelector("button")) return;
    ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">Relay unreachable</h3><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;"><button id="relay-retry" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Retry</button><button id="relay-close" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">Close</button></div></div>`;
    document.getElementById("relay-retry").onclick = () => { done = true; ws.close(); ov.remove(); retryFn(); };
    document.getElementById("relay-close").onclick = () => { done = true; ws.close(); ov.remove(); };
  };

  ws.onclose = () => { if (!done) cleanup(); };
  ws.onopen = sendJoin;

  ws.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);

      if (msg.type === "error") {
        done = true;
        ws.close();
        ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">Relay Error</h3><p style="color:var(--text-dim);font-size:13px;margin:0 0 12px;">${escapeHtml(msg.reason || "Unknown error")}</p><button id="relay-err-close" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">Close</button></div>`;
        document.getElementById("relay-err-close").onclick = cleanup;
        return;
      }

      if (msg.type === "hello") { sendJoin(); return; }

      if (msg.type === "welcome") {
        clientId = msg.clientId;
        onWelcome(clientId, ov, relayUrl, roomId, cleanup);
        return;
      }

      onMessage(msg, ws, clientId, cleanup);
    } catch (err) { console.error("Relay message error:", err); }
  };
}

export async function hostGroupViaRelay(relayUrl) {
  if (!state.currentSet) return;
  const roomId = generate_uuid().slice(0, 12);
  const password = await promptRoomPassword("Room password (optional)");
  const pendingOffers = new Map();

  const createOfferFor = async (targetId) => {
    try {
      const { connId, code } = await Peer.createOffer(state.user.id, state.displayName, state.currentSet);
      state.hostedConnections.add(connId);
      pendingOffers.set(connId, targetId);
      ws?.send(JSON.stringify({ type: "offer", code, connId, to: targetId }));
    } catch (e) { console.error("offer failed:", e); toast("Failed to connect to peer — retry", "#dc2626"); }
  };

  let ws; // captured by closure for host-only message sending

  connectRelayRoom({
    relayUrl, roomId, password,
    title: "Host Group",
    retryFn: () => hostGroupViaRelay(relayUrl),
    onWelcome: (clientId, ov, relayUrl, roomId, cleanup) => {
      let joinLink = window.location.origin + window.location.pathname + "#relay=" + encodeURIComponent(relayUrl) + "&room=" + roomId;
      ov.remove();
      showQRHostDialog("Relay Room " + roomId, joinLink, joinLink, joinLink, {
        onPeerHandshake: hostPeerHandshake,
        onRenderUI: window._renderUI,
        onAddAnother: () => hostGroupViaRelay(relayUrl),
      });
    },
    onMessage: async (msg, w, clientId) => {
      ws = w; // capture for createOfferFor

      if (msg.type === "peer_joined") {
        createOfferFor(msg.clientId);
      }

      if (msg.type === "peer_left") {
        const toRemove = Array.from(pendingOffers.keys()).find(k => pendingOffers.get(k) === msg.clientId);
        if (toRemove) pendingOffers.delete(toRemove);
      }

      if (msg.type === "answer") {
        const connId = msg.connId || Array.from(pendingOffers.keys()).find(k => pendingOffers.get(k) === msg.from);
        if (connId) {
          await Peer.finalizeConnection(connId, msg.code);
          hostPeerHandshake(msg.display_name || "Peer", connId);
          pendingOffers.delete(connId);
          window._renderUI?.();
        } else {
          toast("Received answer for unknown peer", "#f97316");
        }
      }
    },
  });
}

export async function joinPeerViaRelay(relayUrl, roomId) {
  const password = await promptRoomPassword("Room password (leave blank if none)");

  connectRelayRoom({
    relayUrl, roomId, password,
    title: "Joining via relay...",
    retryFn: () => joinPeerViaRelay(relayUrl, roomId),
    onWelcome: (clientId, ov, relayUrl, roomId, cleanup) => {},
    onMessage: async (msg, ws, clientId, cleanup) => {
      if (msg.type === "offer" && msg.code) {
        const result = await Peer.acceptOffer(msg.code, state.user.id, state.displayName);
        const { setId, connId, code: answer } = result;
        ws.send(JSON.stringify({ type: "answer", code: answer, connId, from: clientId, display_name: state.displayName }));
        if (setId) await window._switchSet(setId);
        window._renderUI?.();
        cleanup();
        toast("Connected via relay", "#16a34a");
      }
    },
  });
}

export async function joinPeer() {
  showQRJoinDialog({
    onSetReceived: async (setId) => {
      if (setId && window._names[setId]) await window._switchSet(setId);
    },
    onRenderUI: window._renderUI,
  });
}

function hostPeerHandshake(name, connId) {
  state.peers.set(connId, { name: name || "Peer", setId: state.currentSet, userId: null });
  window._renderPeerList?.();
  Peer.send({ type: "peer_info", data: { display_name: state.displayName, set_id: state.currentSet, user_id: state.user.id } }, connId);
  setTimeout(() => sendAll(state.currentSet), 500);
}

// --- Background music for long exports ---

function startBgMusic() {
  let timer, active = false;
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:4000;display:none;background:#1a1a2e;border-radius:8px;padding:8px;box-shadow:0 2px 12px rgba(0,0,0,0.4);align-items:center;gap:8px;";
  const audio = document.createElement("audio");
  audio.src = "/bgm.mp3";
  audio.loop = true;
  audio.volume = 0.5;
  audio.style.cssText = "width:200px;";
  wrapper.appendChild(audio);
  const toggle = document.createElement("button");
  toggle.textContent = "🔊";
  toggle.style.cssText = "padding:4px 8px;border:1px solid #555;background:#2a2a3e;color:#ccc;border-radius:4px;cursor:pointer;font-size:12px;";
  toggle.onclick = () => {
    if (audio.paused) { audio.play(); toggle.textContent = "🔊"; }
    else { audio.pause(); toggle.textContent = "🔇"; }
  };
  wrapper.appendChild(toggle);
  document.body.appendChild(wrapper);
  timer = setTimeout(() => {
    active = true;
    wrapper.style.display = "flex";
    audio.play().catch(() => {});
  }, 5000);
  return {
    stop() {
      clearTimeout(timer);
      if (active) { audio.pause(); audio.currentTime = 0; }
      setTimeout(() => wrapper.remove(), 2000);
    },
  };
}

export async function exportSet() {
  if (!state.currentSet) return;
  showPasswordDialog("Export — set a password (or leave blank):", async (password, compressVideos) => {
    const bgm = startBgMusic();
    const prog = showProgressDialog("Building export...");
    try {
      prog.update(5, "Loading data...");
      const t = await DB.getTeam(state.currentSet);
      const s = await DB.getSettings(state.currentSet);
      const c = await DB.getCommunity(state.currentSet);
      const pins = await DB.getAllPins(state.currentSet);
      const drawings = await DB.getAllDrawings(state.currentSet);
      const chains = await DB.getChainsByCommunity(state.currentSet);
      const data = await compactStoredMedia({
        name: window._names[state.currentSet] || state.currentSet,
        keys: t ? { public_key: t.public_key, secret_key: t.secret_key, wrapped_dek: t.wrapped_dek, key_derivation: t.key_derivation || "random", community_public_key: t.community_public_key || "", community_secret_key: t.community_secret_key || "", community_wrapped_dek: t.community_wrapped_dek || "" } : null,
        map_center: s?.map_center || null,
        map_zoom: s?.map_zoom || null,
        layers: state.layers,
        schemas: state.schemas,
        community: c ? { name: c.name, description: c.description, governance: c.governance, bounds: c.bounds, relay_nodes: c.relay_nodes } : null,
        pins,
        drawings,
        chains,
      }, (done, total) => {
        prog.update(10 + Math.round(done / Math.max(total, 1) * 60), `Compressing media (${done}/${total})`);
      }, compressVideos);
      // exportSet continues after compact
      prog.update(75, "Serializing...");
      const json = compact_and_pack_json(JSON.stringify(data));
      let payload;
      if (password) {
        prog.update(80, "Encrypting...");
        const enc = encrypt_with_password(json, password);
        const salt = decode_hex(enc.salt);
        const ct = decode_hex(enc.ciphertext);
        const nonce = decode_hex(enc.nonce);
        payload = new Uint8Array(1 + 16 + 12 + ct.length);
        payload[0] = 1;
        payload.set(salt, 1);
        payload.set(nonce, 17);
        payload.set(ct, 29);
      } else {
        payload = new TextEncoder().encode(json);
      }
      prog.update(90, "Compressing...");
      const compressed = compress_gzip(payload);
      const blob = new Blob([compressed], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "🗺️ " + (window._names[state.currentSet] || state.currentSet || "export") + ".piggpin";
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      prog.update(100, "Done");
      bgm.stop();
      setTimeout(prog.done, 600);
    } catch (e) {
      bgm.stop();
      prog.done();
      await alertDialog("Export failed: " + (e.message || "Unknown error"));
    }
  }, "Compress video media (slower export, smaller file)");
}

export async function shareMap() {
  if (!state.currentSet) return;
  showPasswordDialog("Share — set a password (or leave blank):", async (password) => {
    const bgm = startBgMusic();
    const prog = showProgressDialog("Building share link...");
    try {
      prog.update(10, "Loading data...");
      const t = await DB.getTeam(state.currentSet);
      const s = await DB.getSettings(state.currentSet);
      const c = await DB.getCommunity(state.currentSet);
      const pins = await DB.getAllPins(state.currentSet);
      const drawings = await DB.getAllDrawings(state.currentSet);
      const data = await compactStoredMedia({
        name: window._names[state.currentSet] || state.currentSet,
        keys: t ? { public_key: t.public_key, secret_key: t.secret_key, wrapped_dek: t.wrapped_dek, key_derivation: t.key_derivation || "random", community_public_key: t.community_public_key || "", community_secret_key: t.community_secret_key || "", community_wrapped_dek: t.community_wrapped_dek || "" } : null,
        map_center: s?.map_center || null,
        map_zoom: s?.map_zoom || null,
        layers: state.layers,
        schemas: state.schemas,
        community: c ? { name: c.name, description: c.description, governance: c.governance, bounds: c.bounds, relay_nodes: c.relay_nodes } : null,
        pins,
        drawings,
      }, (done, total) => {
        prog.update(10 + Math.round(done / Math.max(total, 1) * 40), `Compacting (${done}/${total})`);
      });
      prog.update(60, "Serializing...");
      const jsonPayload = compact_pack_gzip_json(JSON.stringify(data));
      let payload = serializeBinary(data);
      if (password) {
        prog.update(75, "Encrypting...");
        const enc = encrypt_bytes_with_password(payload, password);
        const salt = decode_hex(enc.salt);
        const ct = decode_hex(enc.ciphertext);
        const nonce = decode_hex(enc.nonce);
        payload = new Uint8Array(1 + 16 + 12 + ct.length);
        payload[0] = 1;
        payload.set(salt, 1);
        payload.set(nonce, 17);
        payload.set(ct, 29);
      }
      prog.update(85, "Compressing...");
      const compressed = compress_gzip_max(payload);
      prog.done();
      const pinCount = (data.pins || []).length;
      const dwgCount = (data.drawings || []).length;
      const mediaCount = [...(data.pins || []), ...(data.drawings || [])].filter(i => i.media).length;
      const rawSize = compressed.length;
      const limitEmbed = 200 * 1024;
      showShareMethodDialog(compressed, compressed.length > limitEmbed, bgm, { pinCount, dwgCount, mediaCount, rawSize }, jsonPayload, c);
    } catch (e) {
      prog.done();
      bgm.stop();
      await alertDialog("Share failed: " + (e.message || "Unknown error"));
    }
  });
}

function generateCommunityLinkUrl(community, communitySk) {
  if (!community || community.visibility === "local" || !community.visibility) return null;
  const nameBytes = new TextEncoder().encode(community.name || "");
  if (nameBytes.length > 255) return null;
  const cidBytes = hexToBytes((community.community_id || "").replace(/-/g, ""));
  if (cidBytes.length !== 16) return null;
  const relayUrl = community.relay_url
    || (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "").split(",")[0]?.trim()
    || "";
  const relayBytes = relayUrl ? new TextEncoder().encode(relayUrl) : new Uint8Array(0);
  const flags = (community.password_hash ? 1 : 0) | (communitySk ? 0x04 : 0);
  const skBytes = communitySk ? hexToBytes(communitySk) : new Uint8Array(0);
  const skLen = skBytes.length;
  const mapCenter = state.map?.getCenter();
  const mapZoom = state.map?.getZoom();
  const viewStr = mapCenter ? `${mapCenter.lat.toFixed(6)},${mapCenter.lng.toFixed(6)},${mapZoom || 5}` : "";
  const viewBytes = viewStr ? new TextEncoder().encode(viewStr) : new Uint8Array(0);
  const total = 1 + nameBytes.length + 16 + 1 + relayBytes.length + 1 + 2 + skLen + viewBytes.length;
  const buf = new Uint8Array(total);
  let pos = 0;
  buf[pos++] = nameBytes.length;
  buf.set(nameBytes, pos); pos += nameBytes.length;
  buf.set(cidBytes, pos); pos += 16;
  buf[pos++] = relayBytes.length;
  if (relayBytes.length > 0) buf.set(relayBytes, pos);
  pos += relayBytes.length;
  buf[pos++] = flags;
  // community secret key: 2-byte len + raw bytes (32 for X25519)
  buf[pos++] = (skLen >> 8) & 0xFF;
  buf[pos++] = skLen & 0xFF;
  if (skLen > 0) buf.set(skBytes, pos);
  pos += skLen;
  if (viewBytes.length > 0) buf.set(viewBytes, pos);
  const b64 = base64url_encode(buf);
  return window.location.origin + window.location.pathname + "#community=" + b64;
}

function showShareMethodDialog(compressed, tooLarge, bgm, preview = {}, jsonPayload = null, community = null) {
  const relayUrl = (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "").split(",")[0]?.trim();
  const sz = (compressed.length / 1024).toFixed(0);
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
  const disabledStyle = "opacity:0.5;pointer-events:none;";
  const summary = preview.pinCount != null ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;display:flex;gap:12px;flex-wrap:wrap;">
    <span>${preview.pinCount} pin${preview.pinCount !== 1 ? "s" : ""}</span>
    ${preview.dwgCount > 0 ? `<span>${preview.dwgCount} drawing${preview.dwgCount !== 1 ? "s" : ""}</span>` : ""}
    ${preview.mediaCount > 0 ? `<span>${preview.mediaCount} media</span>` : ""}
    <span>${sz} KB</span>
  </div>` : "";

  const hasExistingCommunity = community && community.community_id;
  const isCommunityPublished = hasExistingCommunity && community.visibility && community.visibility !== "local";
  const communityName = community ? (escapeHtml(community.name || "").slice(0, 30)) : "";
  const tierStyle = "border:1px solid var(--border-light);border-radius:6px;padding:10px;margin-bottom:8px;";
  const communityTierHtml = hasExistingCommunity ? (isCommunityPublished ? `
    <div style="${tierStyle}border-left:3px solid #16a34a;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>🌐 Live Community</span></div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Join link for "${communityName}". Recipients join your synced community.</div>
      <button id="sm-community" style="display:block;width:100%;padding:7px;border:none;background:#16a34a;color:white;border-radius:4px;cursor:pointer;font-size:13px;">🔗 Copy Community Link</button>
    </div>` : `
    <div style="${tierStyle}border-left:3px solid #eab308;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>🌐 Live Community</span></div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Set visibility to Private or above on a relay to enable community sharing.</div>
      <button id="sm-community-setup" style="display:block;width:100%;padding:7px;border:none;background:#eab308;color:#1a1a1a;border-radius:4px;cursor:pointer;font-size:13px;">⚙ Set Up Community</button>
    </div>`) : `
    <div style="${tierStyle}border-left:3px solid #eab308;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>🌐 Live Community</span></div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Create a community to share and collaborate in real-time.</div>
      <button id="sm-community-create" style="display:block;width:100%;padding:7px;border:none;background:#eab308;color:#1a1a1a;border-radius:4px;cursor:pointer;font-size:13px;">+ Create Community</button>
    </div>`;

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:380px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 4px;">Share via…</h3>
    ${summary}
    <div style="${tierStyle}border-left:3px solid #0891b2;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>📋 Snapshot</span></div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">All data in the link. Works offline, no relay.${tooLarge ? " Map too large for embedding." : " Limited to ~200 KB."}</div>
      <div style="display:flex;gap:6px;">
        <button id="sm-embed" style="flex:1;padding:7px 6px;border:none;background:#0891b2;color:white;border-radius:4px;cursor:pointer;font-size:12px;">📟 Embed</button>
        <button id="sm-raw" style="flex:1;padding:7px 6px;border:none;background:#ea580c;color:white;border-radius:4px;cursor:pointer;font-size:12px;${tooLarge ? disabledStyle : ""}">🔗 Raw URL</button>
        <button id="sm-tinyurl" style="flex:1;padding:7px 6px;border:1px solid #0891b2;background:var(--bg-card);color:#0891b2;border-radius:4px;cursor:pointer;font-size:12px;${tooLarge ? disabledStyle : ""}">📎 TinyURL</button>
      </div>
    </div>
    <div style="${tierStyle}border-left:3px solid #7c3aed;">
      <div style="font-weight:600;font-size:13px;margin-bottom:2px;display:flex;align-items:center;gap:4px;"><span>☁️ Hosted Link</span></div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Stored on relay. Any map size. Auto-expires.${!relayUrl ? " No relay configured." : ""}</div>
      ${relayUrl ? `
        <button id="sm-relay" style="display:block;width:100%;padding:7px;border:none;background:#7c3aed;color:white;border-radius:4px;cursor:pointer;font-size:13px;margin-bottom:6px;">Upload &amp; Copy Link</button>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:11px;color:var(--text-dim);white-space:nowrap;">Uses:</span>
          <select id="sm-uses" style="flex:1;padding:3px;border:1px solid var(--border);border-radius:3px;font-size:12px;">
            <option value="">∞</option><option value="1">1</option><option value="3">3</option><option value="5">5</option><option value="10">10</option>
          </select>
          <span style="font-size:11px;color:var(--text-dim);white-space:nowrap;">Expires:</span>
          <select id="sm-ttl" style="flex:1;padding:3px;border:1px solid var(--border);border-radius:3px;font-size:12px;">
            <option value="3600">1 hour</option><option value="86400" selected>24 hours</option><option value="604800">7 days</option><option value="2592000">30 days</option><option value="">never</option>
          </select>
        </div>
      ` : `<div style="font-size:11px;color:var(--text-dim);">Add a relay in ⚡ Settings to enable.</div>`}
    </div>
    ${communityTierHtml}
    <button id="sm-cancel" style="display:block;width:100%;padding:6px;margin-top:4px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;font-size:12px;">Cancel</button>
  </div>`;
  document.body.appendChild(ov);
  const clean = () => { ov.remove(); bgm.stop(); };
  const copy = async (url, msg) => { bgm.stop(); await navigator.clipboard.writeText(url); toast(msg || "Share link copied to clipboard", "#16a34a"); };

  document.getElementById("sm-embed").onclick = () => {
    clean();
    const payload = jsonPayload || compressed;
    const urlCode = base64url_encode(payload);
    const mapUrl = window.location.origin + window.location.pathname + "?embed=1#map=" + urlCode;
    const embedCode = `<iframe src="${mapUrl}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>`;
    copy(embedCode, "Embed code copied to clipboard");
  };

  document.getElementById("sm-cancel").onclick = clean;
  ov.onclick = e => { if (e.target === ov) clean(); };

  document.getElementById("sm-raw").onclick = () => {
    if (tooLarge) return;
    clean();
    const urlCode = base64url_encode(compressed);
    copy(window.location.origin + window.location.pathname + "#map=" + urlCode);
  };

  document.getElementById("sm-tinyurl").onclick = async () => {
    if (tooLarge) return;
    clean();
    const urlCode = base64url_encode(compressed);
    const longUrl = window.location.origin + window.location.pathname + "#map=" + urlCode;
    const shortBtn = document.getElementById("sm-tinyurl");
    if (shortBtn) shortBtn.textContent = "Shortening…";
    let short = null;
    try {
      const resp = await fetch("https://tinyurl.com/api-create.php?url=" + encodeURIComponent(longUrl));
      if (resp.ok) { const t = await resp.text(); if (t && t.startsWith("http")) short = t; }
    } catch (_) {}
    if (short) copy(short);
    else { copy(longUrl); toast("TinyURL failed — raw URL copied", "#f97316"); }
  };

  if (relayUrl) {
    document.getElementById("sm-relay").onclick = async () => {
      const btn = document.getElementById("sm-relay");
      btn.textContent = "Uploading…"; btn.disabled = true;
      const usesEl = document.getElementById("sm-uses");
      const ttlEl = document.getElementById("sm-ttl");
      const uses = usesEl?.value || "";
      const ttl = ttlEl?.value || "";
      let httpUrl = relayUrl.replace(/\/$/, "");
      httpUrl = httpUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
      const altUrl = httpUrl.replace(/\/\/([^.]+)\./, "//share.");
      let qs = "";
      if (uses) qs += (qs ? "&" : "?") + "uses=" + uses;
      if (ttl) qs += (qs ? "&" : "?") + "ttl=" + ttl;
      let resp = null;
      try {
        for (const u of [httpUrl, altUrl]) {
          try {
            const r = await fetch(u + "/share" + qs, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: compressed });
            if (r.ok) { resp = r; break; }
          } catch (_) {}
        }
        if (resp) {
          const { id } = await resp.json();
          const bare = httpUrl.replace(/^https?:\/\//, "");
          const hostB64 = btoa(bare).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
          clean();
          copy(window.location.origin + window.location.pathname + "#share=" + hostB64 + "@" + id);
        } else {
          btn.textContent = "Relay unreachable — try another";
          btn.disabled = false;
        }
      } catch (_) { btn.textContent = "Relay unreachable — try another"; btn.disabled = false; }
    };
  }

  if (hasExistingCommunity && isCommunityPublished) {
    document.getElementById("sm-community").onclick = async () => {
      const team = await DB.getTeam(community.community_id);
      const communitySk = team?.community_secret_key || team?.secret_key || "";
      const url = generateCommunityLinkUrl(community, communitySk);
      if (url) {
        copy(url, "Community link copied to clipboard");
        import("./core/pkg/e2e_core.js").then(mod => {
          const qrWrap = document.createElement("div");
          qrWrap.style.cssText = "margin-top:8px;text-align:center;";
          qrWrap.innerHTML = `<div style="display:flex;justify-content:center;background:white;padding:8px;border-radius:4px;display:inline-block;">${mod.generate_qr_svg(url) || ""}</div>`;
          const tier = document.getElementById("sm-community").parentElement;
          tier.appendChild(qrWrap);
        }).catch(() => {});
      }
    };
  }

  if (hasExistingCommunity && !isCommunityPublished) {
    document.getElementById("sm-community-setup").onclick = () => {
      const cid = community.community_id;
      import("./map.js").then(m => m.showCommunityDetails(cid)).catch(() => {});
    };
  }

  if (!hasExistingCommunity) {
    document.getElementById("sm-community-create").onclick = async () => {
      const btn = document.getElementById("sm-community-create");
      btn.textContent = "Creating…"; btn.disabled = true;
      try {
        await DB.saveCommunity({
          community_id: state.currentSet,
          name: window._names[state.currentSet] || state.currentSet.slice(0, 8),
          description: "",
          genesis_public_key: state.signingPublicKey || "",
          genesis_created_at: Date.now(),
          members: state.signingPublicKey ? [{ pubkey: state.signingPublicKey, display_name: state.displayName, role: "founder", joined_at: Date.now(), vouched_by: null }] : [],
          governance: { contribution: "open", validation: "none", schema_authority: "any_member", key_rotation: "founder_only", fork_policy: "allowed", join_policy: "open", ttl_enabled: false, ttl_base_mins: 10080, ttl_vote_mins: 360, ttl_min_mins: 60, ttl_max_mins: 43200, anonymous_posting: "forbidden" },
          bounds: null,
          relay_nodes: [],
          visibility: "local",
        });
        toast("Community created", "#16a34a");
        const cid = state.currentSet;
        import("./map.js").then(m => m.showCommunityDetails(cid)).catch(() => {});
      } catch (e) {
        btn.textContent = "Create Community"; btn.disabled = false;
        toast("Create failed: " + (e.message || "error"), "#dc2626");
      }
    };
  }
}

export async function importSet() {
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = ".piggpin,.txt";
  fileInput.onchange = async () => {
    const file = fileInput.files[0]; if (!file) return;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      let data;
      try { data = decompress_gzip(bytes); } catch (_) { await alertDialog("Invalid data"); return; }
      if (!data || data.length < 1) { await alertDialog("Invalid data"); return; }
      if (data[0] === 1) {
        if (data.length < 30) { await alertDialog("Invalid data"); return; }
        const salt = data.slice(1, 17);
        const nonce = data.slice(17, 29);
        const ct = data.slice(29);
        showPasswordDialog("Import — enter password:", async password => {
          try {
            const dec = decrypt_with_password(encode_hex(ct), encode_hex(nonce), encode_hex(salt), password);
            await doImport(unpackHexFields(JSON.parse(dec)));
          } catch (e) { console.error("[import] password-protected .piggpin:", e); await alertDialog("Wrong password or invalid data"); }
        });
      } else {
        try { await doImport(unpackHexFields(JSON.parse(new TextDecoder().decode(data)))); } catch (e) { console.error("[import] plain .piggpin:", e); await alertDialog("Invalid data"); }
      }
    } else {
      const text = new TextDecoder().decode(bytes);
      if (text.startsWith("ENCRYPTED:")) {
        showPasswordDialog("Import — enter password:", async password => {
          try {
            const parts = text.split(":");
            const dec = decrypt_with_password(parts[1], parts[2], parts[3], password);
            await doImport(unpackHexFields(JSON.parse(dec)));
          } catch (e) { console.error("[import] ENCRYPTED text format:", e); await alertDialog("Wrong password or invalid data"); }
        });
      } else {
        try { await doImport(unpackHexFields(JSON.parse(text))); } catch (_) { await alertDialog("Invalid data"); }
      }
    }
  };
  fileInput.click();
}

export async function importFromHash(urlCode) {
  try {
    let b64 = urlCode.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const data = decompress_gzip(bytes);
    if (!data || data.length < 1) throw new Error("empty");
    if (data[0] === 1) {
      if (data.length < 30) throw new Error("invalid encrypted");
      const salt = data.slice(1, 17);
      const nonce = data.slice(17, 29);
      const ct = data.slice(29);
      return new Promise((resolve) => {
        showPasswordDialog("Share link — enter password:", async (password) => {
          if (!password) { resolve(false); return; }
          try {
            const dec = decrypt_bytes_with_password(encode_hex(ct), encode_hex(nonce), encode_hex(salt), password);
            await doImport(deserializeBinary(dec));
            resolve(true);
          } catch (_) { resolve(false); }
        });
      });
    }
    if (data[0] === 2 || data[0] === 3) {
      await doImport(deserializeBinary(data));
      return true;
    }
    await doImport(unpackHexFields(JSON.parse(new TextDecoder().decode(data))));
    return true;
  } catch (_) { return false; }
}

export async function importFromCompressed(compressed) {
  try {
    const data = decompress_gzip(compressed);
    if (!data || data.length < 1) return false;
    if (data[0] === 1) return false; // encrypted not supported via relay
    if (data[0] === 2 || data[0] === 3) {
      await doImport(deserializeBinary(data));
      return true;
    }
    await doImport(unpackHexFields(JSON.parse(new TextDecoder().decode(data))));
    return true;
  } catch (_) { return false; }
}

async function doImport(data) {
  const sid = generate_uuid();
  if (data.keys) {
    const { public_key, secret_key, wrapped_dek, key_derivation, community_public_key, community_secret_key, community_wrapped_dek } = data.keys || {};
    await DB.saveTeam({ team_id: sid, name: data.name || "Imported", public_key, secret_key, wrapped_dek, key_derivation, community_public_key: community_public_key || "", community_secret_key: community_secret_key || "", community_wrapped_dek: community_wrapped_dek || "" });
  }
  await DB.saveCommunity({
    community_id: sid,
    name: data.name || "Imported",
    description: data.description || "",
    genesis_public_key: state.signingPublicKey || "",
    genesis_created_at: Date.now(),
    members: state.signingPublicKey ? [{
      pubkey: state.signingPublicKey,
      display_name: state.displayName,
      role: "founder",
      joined_at: Date.now(),
      vouched_by: null,
    }] : [],
    governance: data.governance || { contribution: "open", validation: "none", schema_authority: "any_member", key_rotation: "founder_only", fork_policy: "allowed", join_policy: "open" },
    bounds: data.bounds || null,
    relay_nodes: data.relay_nodes || [],
    visibility: "local",
  });
  await DB.importPins((data.pins || []).map(p => ({ ...p, team_id: sid })));
  await DB.importDrawings((data.drawings || []).map(d => ({ ...d, team_id: sid })));
  if (data.schemas && Array.isArray(data.schemas)) {
    const existing = await DB.getSchemas();
    for (const s of data.schemas) {
      if (!existing.find(e => e.schema_id === s.schema_id)) {
        await DB.saveSchema({ schema_id: s.schema_id, name: s.name, fields: s.fields || [] });
      }
    }
  }
  if (data.layers && Array.isArray(data.layers) && data.layers.length > 0) {
    await DB.saveLayers(sid, data.layers);
  } else {
    await DB.saveLayers(sid, [{ layer_id: generate_uuid(), name: "Default", color: state.defaultLayerColor, visible: true, opacity: 1.0 }]);
  }
  if (data.chains && Array.isArray(data.chains)) {
    for (const c of data.chains) {
      await DB.saveChain({ ...c, community_id: sid, chain_id: generate_uuid() });
    }
  }
  window._names[sid] = data.name || "Imported";
  if (data.map_center) await DB.saveSettings(sid, { map_center: data.map_center, map_zoom: data.map_zoom });
  await window._loadSetList();
  await window._switchSet(sid);
}

export async function rotateSetKeys() {
  if (!state.currentSet || !state.dek) return;
  if (!(await confirmDialog("Rotate encryption keys? This re-encrypts all data with a new key."))) return;
  const t = await DB.getTeam(state.currentSet);
  if (!t) return;
  const newDek = generate_dek();
  const newWrapped = wrap_dek(newDek, t.public_key);
  const oldDek = state.dek;

  const pins = await DB.getAllPins(state.currentSet);
  let pinErrors = 0;
  for (const row of pins) {
    try {
      const pin = decrypt_pin_data(row.ciphertext, row.nonce, oldDek);
      const enc = encrypt_pin_data(pin.title, pin.note, pin.lat, pin.lng, pin.color || "#2563eb", newDek);
      row.ciphertext = enc.ciphertext; row.nonce = enc.nonce;
      if (row.media) {
        const dec = decrypt_raw_bytes(row.media.ciphertext, row.media.nonce, oldDek);
        const menc = encrypt_raw_bytes(dec, newDek);
        row.media.ciphertext = menc.ciphertext; row.media.nonce = menc.nonce;
      }
      await DB.savePin(row);
    } catch (_) { pinErrors++; }
  }

  const drawings = await DB.getAllDrawings(state.currentSet);
  let drawingErrors = 0;
  for (const row of drawings) {
    try {
      const geojson = decrypt_geojson(row.encrypted_geojson, row.nonce, oldDek);
      const enc = encrypt_geojson(geojson, newDek);
      row.encrypted_geojson = enc.ciphertext; row.nonce = enc.nonce;
      if (row.media) {
        const dec = decrypt_raw_bytes(row.media.ciphertext, row.media.nonce, oldDek);
        const menc = encrypt_raw_bytes(dec, newDek);
        row.media.ciphertext = menc.ciphertext; row.media.nonce = menc.nonce;
      }
      await DB.saveDrawing(row);
    } catch (_) { drawingErrors++; }
  }

  if (pinErrors > 0 || drawingErrors > 0) {
    toast(`Key rotation skipped — ${pinErrors} pin(s) and ${drawingErrors} drawing(s) failed to re-encrypt. Old key preserved.`, "#dc2626");
    return;
  }

  t.wrapped_dek = newWrapped;
  await DB.saveTeam(t);
  state.dek = newDek;
  broadcast("keys", { set_id: state.currentSet, name: window._names[state.currentSet] || state.currentSet.slice(0, 8), public_key: t.public_key, secret_key: t.secret_key, wrapped_dek: newWrapped });
  await window._loadPins();
  await window._loadDrawings();
  window._renderUI?.();
  toast("Keys rotated", "#16a34a");
}

// --- Annotation broadcasting ---

export function broadcastAnnotation(annotation) {
  broadcast("new_annotation", {
    annotation_id: annotation.annotation_id,
    pin_id: annotation.pin_id,
    ciphertext: annotation.ciphertext,
    nonce: annotation.nonce,
    author_pubkey: annotation.author_pubkey,
    created_at: annotation.created_at,
    media: annotation.media || null,
    parent_id: annotation.parent_id || null,
  });
  if (state.currentSet) _meshBroadcast?.("new_annotation", { annotation_id: annotation.annotation_id, pin_id: annotation.pin_id, ciphertext: annotation.ciphertext, nonce: annotation.nonce, author_pubkey: annotation.author_pubkey, created_at: annotation.created_at, media: annotation.media || null, parent_id: annotation.parent_id || null });
}

export function broadcastAnnotationVote(annotationId, vote) {
  broadcast("annotation_vote", {
    annotation_id: annotationId,
    pubkey: vote.pubkey,
    direction: vote.direction,
    timestamp: vote.timestamp,
    signature: vote.signature,
  });
  import("./relay.js").then(r => r.sendAnnotationVote(annotationId, vote)).catch(() => {});
}

export function broadcastTombstone(tombstone) {
  broadcast("new_tombstone", {
    tombstone_id: tombstone.tombstone_id,
    target_id: tombstone.target_id,
    by_pubkey: tombstone.by_pubkey,
    reason: tombstone.reason,
    timestamp: tombstone.timestamp,
    signature: tombstone.signature,
  });
}
