import { MeshDevice } from "@meshtastic/core";
import { TransportWebSerial } from "@meshtastic/transport-web-serial";
import { TransportWebBluetooth } from "@meshtastic/transport-web-bluetooth";
import { mesh_chunk_encode, hw_model_name, reticulum_generate_identity, reticulum_address, reticulum_hash_data } from "./core/pkg/e2e_core.js";
import { rnodeConnect, rnodeSend, rnodeDisconnect, isRnodeConnected } from "./mesh_rnode.js";
import * as DB from "./db.js";
import * as Sync from "./sync.js";
import { toast, escapeHtml } from "./dialogs.js";
import { state } from "./state.js";
import L from "leaflet";

let meshDevice = null;
let meshNodeNum = null;
const meshPeers = new Map();
const meshMarkers = new Map();

// WebSocket mesh client (MQTT bridge)
let meshWs = null;
let meshWsConnected = false;

// Direct-send target
let meshTargetNode = null;

// Transport mode: "meshtastic", "bluetooth", or "rnode"
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const meshTransport = localStorage.getItem("mesh-transport") || (isMobile ? "bluetooth" : "meshtastic");

// Mesh inbox for received map data
const meshInbox = [];
let meshInboxUnread = 0;

// Announce-based discovery (no MQTT needed)
let meshNodeAddr = null; // hex address derived from user identity
let _announceTimer = null;
const ANNOUNCE_INTERVAL = 300000; // 5 minutes

const meshChunkStore = new Map();
let _meshChunkCleanup = null;

_meshChunkCleanup = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of meshChunkStore) {
    if (now - entry.ts > 60000) meshChunkStore.delete(id);
  }
}, 30000);

function meshPeerConnId(nodeNum) {
  return `mesh_${nodeNum}`;
}

export async function connectMesh() {
  console.log("[mesh] connectMesh() called");
  const relayUrl = localStorage.getItem("pins-relay-url");
  console.log("[mesh] relayUrl from localStorage:", relayUrl || "(none)");

  // Connect both transports if relay is configured
  if (relayUrl) {
    connectMeshWS(relayUrl);
  }

  // Always try direct radio connection (meshtastic, bluetooth, or rnode)
  if (meshDevice || isRnodeConnected()) return;
  const mode = localStorage.getItem("mesh-transport") || (isMobile ? "bluetooth" : "meshtastic");

    if (mode === "rnode") {
      try {
        toast("Connecting to RNode via serial...", "#7c3aed");
        const ok = await rnodeConnect(
          (text, _from) => {
            handleMeshPacket({ from: 0, data: text, to: 0xFFFFFFFF });
            if (meshWsConnected && meshWs && meshWs.readyState === WebSocket.OPEN) {
              try {
                const parsed = JSON.parse(text);
                if (!parsed._relay) {
                  parsed._relay = true;
                  meshWs.send(JSON.stringify({ type: "mesh_rnode", data: JSON.stringify(parsed) }));
                }
              } catch (_) {
                meshWs.send(JSON.stringify({ type: "mesh_rnode", data: text }));
              }
            }
          },
          () => { console.log("[rnode] disconnected"); }
        );
        if (!ok) throw new Error("RNode connect failed");
        Sync.setMeshBroadcast((type, data) => meshBroadcast(type, data));
        import("./gossip.js").then(g => g.setGossipMeshBroadcast((type, data) => meshBroadcast(type, data))).catch(() => {});
        startAnnounceTimer();
        toast("RNode connected", "#16a34a");
        window._renderUI?.();
        return;
    } catch (e) {
      toast("RNode connect failed: " + (e.message || "Unknown"), "#dc2626");
      return;
    }
  }

  if (mode === "bluetooth" && !navigator.bluetooth) {
    toast("BLE not supported in this browser — try Chrome", "#dc2626");
    return;
  }
  try {
    let transport;
    if (mode === "bluetooth") {
      toast("Scanning for Meshtastic BLE...", "#7c3aed");
      transport = await TransportWebBluetooth.create();
      toast("Bluetooth connected", "#16a34a");
      toast("Connecting via Bluetooth...", "#7c3aed");
    } else {
      transport = await TransportWebSerial.create(115200);
    }
    meshDevice = new MeshDevice(transport);
    meshDevice.setHeartbeatInterval(300000); // 5 minutes — reduces serial load

    meshDevice.events.onMyNodeInfo.subscribe(info => {
      meshNodeNum = info.myNodeNum;
      console.log("[mesh] onMyNodeInfo — my node num:", meshNodeNum);
    });

    meshDevice.events.onMessagePacket.subscribe(packet => {
      if (!packet.data) return;
      handleMeshPacket(packet);
    });

    meshDevice.events.onNodeInfoPacket.subscribe(info => {
      // Path 1: from handleFromRadio "nodeInfo" — raw NodeInfo protobuf with .num, .user, .position, .snr
      // Path 2: from handleDecodedPacket NODEINFO_APP — { from, to, data: User_protobuf }
      let nodeNum, user, position, snr, lastHeard, deviceMetrics;
      if (info.num !== undefined && info.user) {
        // Path 1
        nodeNum = info.num;
        user = info.user;
        position = info.position;
        snr = info.snr;
        lastHeard = info.lastHeard;
        deviceMetrics = info.deviceMetrics;
      } else if (info.from !== undefined && info.data) {
        // Path 2 — over-the-air NODEINFO_APP (User protobuf)
        nodeNum = info.from;
        user = info.data;
        snr = info.snr;
      } else {
        console.log("[mesh] onNodeInfoPacket — unknown shape:", info);
        return;
      }
      console.log("[mesh] onNodeInfoPacket — node:", nodeNum, "user:", user?.longName, "hasPosition:", !!position);
      const entry = meshPeers.get(nodeNum) || {};
      entry.userId = user.id;
      entry.name = user.longName || user.shortName || `Node ${nodeNum}`;
      entry.shortName = user.shortName || "";
      entry.hwModel = deviceMetrics?.hwModel || user.hwModel || 0;
      entry.snr = snr || 0;
      entry.lastHeard = lastHeard || 0;
      entry.batteryLevel = deviceMetrics?.batteryLevel;
      entry.voltage = deviceMetrics?.voltage;
      entry.airUtilTx = deviceMetrics?.airUtilTx;
      entry.channelUtilization = deviceMetrics?.channelUtilization;
      entry.lastSeen = Date.now();
      if (position && position.latitudeI && position.longitudeI) {
        entry.lat = position.latitudeI * 1e-7;
        entry.lng = position.longitudeI * 1e-7;
        entry.alt = position.altitude;
      }
      meshPeers.set(nodeNum, entry);
      upsertMeshMarker(nodeNum, entry);
    });

    meshDevice.events.onPositionPacket.subscribe(packet => {
      const nodeNum = packet.from;
      const pos = packet.data;
      if (!pos || !pos.latitudeI && !pos.latitude_i || !pos.longitudeI && !pos.longitude_i) return;
      const lat = (pos.latitude_i || pos.latitudeI) * 1e-7;
      const lng = (pos.longitude_i || pos.longitudeI) * 1e-7;
      console.log("[mesh] onPositionPacket — node:", nodeNum, "lat:", lat, "lng:", lng);
      const entry = meshPeers.get(nodeNum) || {};
      entry.lat = lat;
      entry.lng = lng;
      entry.alt = pos.altitude;
      entry.lastSeen = Date.now();
      meshPeers.set(nodeNum, entry);
      upsertMeshMarker(nodeNum, entry);

      // Forward position to MQTT via WS bridge so meshview can see it
      // Throttled: max once per 5 minutes per node
      const lastFwd = entry._lastPosFwd || 0;
      if (meshWsConnected && meshWs && meshWs.readyState === WebSocket.OPEN && Date.now() - lastFwd > 300000) {
        console.log("[mesh] forwarding position to MQTT for node", nodeNum);
        const myEntry = meshPeers.get(nodeNum);
        const posMsg = JSON.stringify({
          type: "mesh_uplink_position",
          from: nodeNum,
          latitude_i: pos.latitude_i || pos.latitudeI,
          longitude_i: pos.longitude_i || pos.longitudeI,
          altitude: pos.altitude || 0,
          long_name: myEntry?.name || "",
          short_name: myEntry?.shortName || "",
          hw_model: myEntry?.hwModel || 0,
        });
        meshWs.send(posMsg);
        entry._lastPosFwd = Date.now();
      }
    });

    meshDevice.events.onDeviceStatus.subscribe(status => {
      if (status === 5) {
        toast("Meshtastic radio connected", "#16a34a");
      } else if (status === 2) {
        toast("Meshtastic radio disconnected", "#f97316");
        meshPeers.clear();
      }
    });

    // Forward encrypted mesh activity so meshview sees our node as participating
    // Throttled: max once per 5 minutes
    let _lastPresence = 0;
    meshDevice.events.onMeshPacket?.subscribe(packet => {
      if (meshWsConnected && meshWs && meshWs.readyState === WebSocket.OPEN && Date.now() - _lastPresence > 300000) {
        _lastPresence = Date.now();
        meshWs.send(JSON.stringify({ type: "mesh_uplink_presence", node: meshNodeNum }));
      }
    });

    Sync.setMeshBroadcast((type, data) => meshBroadcast(type, data));
    import("./gossip.js").then(g => g.setGossipMeshBroadcast((type, data) => meshBroadcast(type, data))).catch(() => {});

    startAnnounceTimer();

    const setId = await window._createSet?.("Mesh " + new Date().toLocaleDateString());
    if (setId && window._switchSet) await window._switchSet(setId);

    toast("Meshtastic radio connected", "#16a34a");
    window._renderUI?.();
    return true;
  } catch (e) {
    const msg = e.message || "Unknown";
    if (mode === "bluetooth") {
      toast("BLE failed: " + msg + ". Try serial or check pairing.", "#dc2626");
      // Fall back to serial on mobile
      if (isMobile) {
        localStorage.setItem("mesh-transport", "serial");
        toast("Switched to serial mode — reconnect", "#f97316");
      }
    } else {
      toast("Serial connect failed: " + msg, "#dc2626");
    }
    return false;
  }
}

export async function disconnectMesh() {
  stopAnnounceTimer();
  disconnectMeshWS();
  if (_meshChunkCleanup) { clearInterval(_meshChunkCleanup); _meshChunkCleanup = null; }
  await rnodeDisconnect().catch(() => {});
  if (!meshDevice) return;
  Sync.setMeshBroadcast(null);
  import("./gossip.js").then(g => g.setGossipMeshBroadcast(null)).catch(() => {});
  clearMeshMarkers();
  meshPeers.clear();
  await meshDevice.disconnect().catch(() => {});
  meshDevice = null;
  meshNodeNum = null;
  window._renderUI?.();
}

export function isMeshConnected() {
  return meshDevice !== null || meshWsConnected || isRnodeConnected();
}

export function meshPeerCount() {
  return meshPeers.size;
}

export function getMeshTarget() {
  return meshTargetNode;
}

export function setMeshTarget(nodeNum) {
  meshTargetNode = nodeNum;
  window._renderUI?.();
}

export function getMeshPeers() {
  return [...meshPeers.entries()]
    .map(([id, e]) => ({ id, name: e.name || (typeof id === "number" ? `Node ${id}` : id.slice(0, 10)), channel: e.channel, lastSeen: e.lastSeen }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

// Only peers discovered via reticulum announces (hex addresses, not numeric node IDs)
export function getReticulumPeers() {
  return [...meshPeers.entries()]
    .filter(([id]) => typeof id === "string" && id.length >= 8)
    .map(([id, e]) => ({ id, name: e.name || id.slice(0, 10), lat: e.lat, lng: e.lng, lastSeen: e.lastSeen }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

export function getMeshTransport() {
  const v = localStorage.getItem("mesh-transport") || (isMobile ? "bluetooth" : "meshtastic");
  return v === "serial" ? "meshtastic" : v; // migrate legacy value
}

export function setMeshTransport(mode) {
  localStorage.setItem("mesh-transport", mode);
}

// Self-sovereign address from Reticulum identity
function deriveAddress() {
  if (meshNodeAddr) return meshNodeAddr;
  try {
    const id = reticulum_generate_identity();
    meshNodeAddr = reticulum_address(id);
    localStorage.setItem("mesh-identity", id);
    return meshNodeAddr;
  } catch (e) {
    console.warn("[mesh] reticulum identity failed, using fallback:", e);
    const uid = state.user?.id || "fallback";
    meshNodeAddr = reticulum_hash_data(new TextEncoder().encode(uid)).slice(0, 16);
    return meshNodeAddr;
  }
}

export function getMeshAddress() {
  return deriveAddress();
}

// Reconnect announce — no radio required, pure internet
export function startReticulumHost() {
  Sync.setMeshBroadcast((type, data) => meshBroadcast(type, data));
  import("./gossip.js").then(g => g.setGossipMeshBroadcast((type, data) => meshBroadcast(type, data))).catch(() => {});
  if (!meshWsConnected) {
    const relayUrl = localStorage.getItem("pins-relay-url") || `wss://${location.hostname}:9000`;
    connectMeshWS(relayUrl);
  }
  startAnnounceTimer();
}

async function shareKeysOnConnect() {
  if (!state.currentSet) return;
  try {
    const t = await DB.getTeam(state.currentSet);
    if (!t) return;
    const c = await DB.getCommunity(state.currentSet);
    const isPasswordDerived = t.key_derivation === "pbkdf2";
    const name = window._names?.[state.currentSet] || state.currentSet.slice(0, 8);
    meshBroadcast("keys", {
      set_id: state.currentSet, name,
      public_key: t.public_key,
      wrapped_dek: t.wrapped_dek,
      key_derivation: isPasswordDerived ? "pbkdf2" : "random",
      genesis_public_key: c?.genesis_public_key || state.signingPublicKey,
      governance: c?.governance || null,
      relay_nodes: c?.relay_nodes || [],
    });
    console.log("[mesh] shared map keys for set", name);
  } catch (e) {
    console.warn("[mesh] keys share failed:", e);
  }
}

// Build and send an announce packet
function sendAnnounce() {
  const addr = deriveAddress();
  const entry = meshPeers.get(meshNodeNum);
  const name = entry?.name || state.displayName || "piggpin";
  const lat = entry?.lat || 0;
  const lng = entry?.lng || 0;
  console.log("[mesh] sending announce as", addr, name);
  const announce = JSON.stringify({
    type: "mesh_announce",
    id: addr,
    name: name,
    lat: lat,
    lng: lng,
    hw: entry?.hwModel || 0,
    ts: Date.now(),
  });

  // Send via RNode
  if (isRnodeConnected()) {
    rnodeSend(announce);
  }
  // Relay via WS for other PWAs
  if (meshWsConnected && meshWs && meshWs.readyState === WebSocket.OPEN) {
    meshWs.send(announce);
  }
}

function startAnnounceTimer() {
  if (_announceTimer) return;
  sendAnnounce(); // Send immediately
  _announceTimer = setInterval(sendAnnounce, ANNOUNCE_INTERVAL);
}

function stopAnnounceTimer() {
  if (_announceTimer) { clearInterval(_announceTimer); _announceTimer = null; }
}

// ---- WebSocket mesh client (MQTT bridge from signal server) ----

export function connectMeshWS(relayUrl) {
  console.log("[mesh-ws] connectMeshWS called with:", relayUrl);
  if (meshWs) return;
  const url = (relayUrl || localStorage.getItem("pins-relay-url") || "").replace(/\/$/, "");
  console.log("[mesh-ws] connecting to:", url);
  if (!url) {
    toast("No signal relay configured", "#dc2626");
    return;
  }
  try {
    meshWs = new WebSocket(url);
  } catch (e) {
    toast("Mesh WS connect failed: " + (e.message || "Unknown"), "#dc2626");
    meshWs = null;
    return;
  }
  meshWs.onopen = () => {
    meshWsConnected = true;
    meshWs.send(JSON.stringify({ type: "join", room: "mesh" }));
    console.log("[mesh-ws] connected, joining mesh room");
    // Fire first announce now that WS is open
    sendAnnounce();
    startAnnounceTimer();
    // Share map keys so peers can join this set
    shareKeysOnConnect();
    window._renderUI?.();
  };
  meshWs.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    console.log("[mesh-ws] received:", msg.type || "(no type)", msg.from || "");
    // Re-announce when a new peer joins so they discover us
    if (msg.type === "peer_joined") {
      sendAnnounce();
    }
    handleBridgeMessage(msg);
  };
  meshWs.onclose = () => {
    console.log("[mesh-ws] disconnected");
    meshWs = null;
    meshWsConnected = false;
    window._renderUI?.();
  };
  meshWs.onerror = () => { console.warn("[mesh] WebSocket error, will attempt reconnect"); };
}

export function disconnectMeshWS() {
  if (meshWs) {
    meshWs.onclose = null;
    meshWs.close();
    meshWs = null;
  }
  meshWsConnected = false;
  clearMeshMarkers();
  meshPeers.clear();
}

function handleBridgeMessage(msg) {
  if (msg.type === "welcome") {
    toast("Mesh bridge connected", "#16a34a");
    window._renderUI?.();
    return;
  }

  if (msg.type === "hello") {
    meshWs.send(JSON.stringify({ type: "join", room: "mesh" }));
    return;
  }

  const from = msg.from;
  const type = msg.type;
  // Skip only if from is truly missing — allow announces and uplinks without from
  if ((from === null || from === undefined) && type !== "mesh_uplink" && type !== "mesh_announce") return;

  // Get or create peer entry
  let entry = meshPeers.get(from);
  if (!entry) {
    entry = { userId: null, name: `Node ${from}`, lastSeen: Date.now() };
    meshPeers.set(from, entry);
    window._renderUI?.();
  }
  entry.lastSeen = Date.now();

  // Extract channel name from topic for popup display
  if (msg.topic) {
    const parts = msg.topic.split("/");
    const channelIdx = parts.indexOf("2") + 2; // msh/US/MeshSTL/2/e/ChannelName/!nodeid
    if (channelIdx > 1 && channelIdx < parts.length - 1) {
      entry.channel = parts[channelIdx];
    }
  }

  switch (type) {
    case "mesh_position":
    case "position": {
      console.log("[mesh-ws] position raw:", JSON.stringify(msg).slice(0, 300));
      const d = msg.data || msg.payload || msg;
      if (d) {
        const lat = d.latitude_i ?? d.latitudeI ?? d.latitude_i;
        const lng = d.longitude_i ?? d.longitudeI ?? d.longitude_i;
        console.log("[mesh-ws] position parsed:", {lat, lng, alt: d.altitude, hasMap: !!state.map});
        if (lat != null && lng != null) {
          entry.lat = lat * 1e-7;
          entry.lng = lng * 1e-7;
          entry.alt = d.altitude ?? d.alt ?? 0;
          console.log("[mesh-ws] position → marker:", from, entry.lat, entry.lng);
          upsertMeshMarker(from, entry);
        }
      }
      break;
    }
    case "mesh_nodeinfo":
    case "nodeinfo": {
      const d = msg.data || msg.payload || msg;
      if (d) {
        if (d.long_name || d.longName) entry.name = d.long_name || d.longName;
        if (d.short_name || d.shortName) entry.shortName = d.short_name || d.shortName;
        if (d.hw_model != null || d.hwModel != null) entry.hwModel = d.hw_model ?? d.hwModel;
        console.log("[mesh-ws] nodeinfo:", entry.name);
        upsertMeshMarker(from, entry);
      }
      break;
    }
    case "mesh_text": {
      // Route text messages from other nodes
      if (msg.data) {
        const packet = { from, data: msg.data, to: msg.to };
        handleMeshPacket(packet);
      }
      break;
    }
    case "mesh_rnode": {
      // Data from another PWA's RNode radio via the WS relay
      if (msg.data) {
        handleMeshPacket({ from: 0, data: msg.data, to: 0xFFFFFFFF });
        if (isRnodeConnected()) {
          rnodeSend(msg.data);
        }
      }
      break;
    }
    case "mesh_uplink": {
      // PigPin data from another PWA via WS relay — process locally + forward to RNode if available
      if (msg.payload) {
        const from = msg.from || 0xFFFFFFFF;
        handleMeshPacket({ from, data: msg.payload, to: 0xFFFFFFFF });
        // Forward to RNode radio so it hits the LoRa mesh (gateway mode)
        if (isRnodeConnected() && !msg._relay) {
          try {
            const parsed = JSON.parse(msg.payload);
            parsed._relay = true;
            rnodeSend(JSON.stringify(parsed));
          } catch (_) {
            rnodeSend(msg.payload);
          }
        }
      }
      break;
    }
    case "mesh_announce": {
      // Self-sovereign discovery — no MQTT needed
      const addr = msg.id;
      const name = msg.name;
      if (!addr) break;
      console.log("[mesh] received announce from", name, addr.slice(0, 10));
      let entry = meshPeers.get(addr);
      if (!entry) {
        entry = { userId: addr, name: name || addr, lastSeen: Date.now() };
        meshPeers.set(addr, entry);
      }
      entry.name = name || entry.name;
      entry.lastSeen = Date.now();
      if (msg.lat && msg.lng) {
        entry.lat = msg.lat;
        entry.lng = msg.lng;
      }
      if (msg.hw != null) entry.hwModel = msg.hw;
      upsertMeshMarker(addr, entry);

      // Relay announce to other PWAs via WS
      if (meshWsConnected && meshWs && meshWs.readyState === WebSocket.OPEN && !msg._relay) {
        const relay = { ...msg, _relay: true };
        meshWs.send(JSON.stringify(relay));
      }
      // Relay to RNode for LoRa propagation
      if (isRnodeConnected() && !msg._relay) {
        const relay = { ...msg, _relay: true };
        rnodeSend(JSON.stringify(relay));
      }
      break;
    }
    case "mesh_encrypted":
    case "mesh_telemetry":
    case "mesh_packet":
    case "neighborinfo":
    default: {
      // Track presence — no position/marker yet, but we know the node exists
      if (type && type !== "mesh_encrypted" && type !== "mesh_telemetry" && type !== "mesh_packet" && type !== "neighborinfo") {
        console.log("[mesh-ws] unknown type:", type, JSON.stringify(msg).slice(0, 200));
      }
      break;
    }
  }

  // Handle JSON MapReport from msh/2/json/# topic
  // Meshtastic MQTT JSON uses camelCase: latitudeI, longitudeI, longName, hwModel
  const name = msg.long_name || msg.longName;
  const sname = msg.short_name || msg.shortName;
  const lat = msg.latitude_i ?? msg.latitudeI ?? msg.payload?.latitude_i ?? msg.payload?.latitudeI;
  const lng = msg.longitude_i ?? msg.longitudeI ?? msg.payload?.longitude_i ?? msg.payload?.longitudeI;
  const hw = msg.hw_model ?? msg.hwModel;
  const alt = msg.altitude ?? msg.alt ?? msg.payload?.altitude ?? msg.payload?.alt;
  if (name || sname || lat != null) {
    console.log("[mesh-ws] MapReport:", {name, lat, lng, hasMap: !!state.map});
    if (name) entry.name = name;
    if (sname) entry.shortName = sname;
    if (hw != null) entry.hwModel = hw;
    if (lat != null && lng != null) {
      entry.lat = lat * 1e-7;
      entry.lng = lng * 1e-7;
      entry.alt = alt || 0;
    }
    upsertMeshMarker(from, entry);
  }
}

function clearMeshMarkers() {
  for (const [, marker] of meshMarkers) {
    marker.remove();
  }
  meshMarkers.clear();
}

function meshNodeIcon(nodeNum, entry) {
  const c = "#7c3aed";
  const label = (entry.shortName || entry.name || `Node ${nodeNum}`).slice(0, 4)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36"><path fill="${c}" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z"/><text x="12" y="14" text-anchor="middle" fill="#fff" font-size="7" font-weight="bold">${label}</text></svg>`;
  return L.icon({ iconUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`, iconSize: [24, 36], iconAnchor: [12, 36], popupAnchor: [0, -36] });
}

function upsertMeshMarker(nodeNum, entry) {
  if (!state.map) { console.log("[mesh] upsertMeshMarker — skip, no map"); return; }
  if (!entry.lat || !entry.lng) { console.log("[mesh] upsertMeshMarker — skip, no position for node", nodeNum); return; }
  console.log("[mesh] upsertMeshMarker — placing marker for node", nodeNum, "at", entry.lat, entry.lng);
  const latlng = [entry.lat, entry.lng];
  let marker = meshMarkers.get(nodeNum);
  if (marker) {
    marker.setLatLng(latlng);
    marker.setIcon(meshNodeIcon(nodeNum, entry));
    marker.setPopupContent(meshNodePopup(nodeNum, entry));
  } else {
    marker = L.marker(latlng, { icon: meshNodeIcon(nodeNum, entry) }).addTo(state.map);
    marker.bindPopup(meshNodePopup(nodeNum, entry));
    meshMarkers.set(nodeNum, marker);
  }
}

function meshNodePopup(nodeNum, entry) {
  const name = escapeHtml(entry.name || `Node ${nodeNum}`);
  const hw = hw_model_name(entry.hwModel || 0);
  let info = `<b>${name}</b><br><small>${hw} | #${nodeNum}</small>`;
  if (entry.snr) info += `<br>SNR: ${entry.snr.toFixed(1)} dB`;
  if (entry.batteryLevel != null) info += `<br>Batt: ${entry.batteryLevel}%`;
  if (entry.voltage != null) info += ` (${entry.voltage.toFixed(2)}V)`;
  if (entry.airUtilTx != null) info += `<br>Air util tx: ${entry.airUtilTx.toFixed(1)}%`;
  if (entry.channelUtilization != null) info += `<br>Chan util: ${entry.channelUtilization.toFixed(1)}%`;
  if (entry.lastHeard) info += `<br>Heard: ${new Date(entry.lastHeard * 1000).toLocaleTimeString()}`;
  if (entry.alt) info += `<br>Alt: ${entry.alt}m`;
  info += `<br><small>lat ${entry.lat?.toFixed(5)} lng ${entry.lng?.toFixed(5)}</small>`;
  return info;
}

function handleMeshPacket(packet) {
  const nodeNum = packet.from;
  const text = packet.data;
  console.log("[mesh] handleMeshPacket from node", nodeNum, "data len:", typeof text === "string" ? text.length : typeof text);

  if (nodeNum) {
    if (!meshPeers.has(nodeNum)) {
      meshPeers.set(nodeNum, { userId: null, name: `Node ${nodeNum}`, lastSeen: Date.now() });
    } else {
      meshPeers.get(nodeNum).lastSeen = Date.now();
    }
  }

  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { console.log("[mesh] JSON parse failed:", e.message, "data:", String(text).slice(0, 100)); return; }

  if (parsed._m && parsed._m.t === "c") {
    const reassembled = reassembleMeshChunk(parsed._m);
    if (reassembled) {
      let fullMsg;
      try { fullMsg = JSON.parse(reassembled); } catch (_) { return; }
      addToInbox(fullMsg, nodeNum);
    }
    return;
  }

  if (parsed.type === "mesh_announce") {
    // Route through announce handler
    handleBridgeMessage(parsed);
    return;
  }

  if (isPiggpinMessage(parsed)) {
    addToInbox(parsed, nodeNum);
    return;
  }

  // Not a piggPin message — route directly (skip self to avoid duplicates)
  if (nodeNum === meshNodeNum) return;
  const cid = nodeNum ? meshPeerConnId(nodeNum) : "mesh_unknown";
  Sync.handleMessage(parsed, cid);
}

function reassembleMeshChunk(meta) {
  const { id, i: index, n: total, d: chunk } = meta;
  let entry = meshChunkStore.get(id);
  if (!entry) {
    entry = { chunks: new Array(total), ts: Date.now(), count: 0 };
    meshChunkStore.set(id, entry);
  }
  entry.ts = Date.now();
  if (entry.chunks[index] === undefined) {
    entry.chunks[index] = chunk;
    entry.count++;
  }
  if (entry.count === total) {
    const full = entry.chunks.join("");
    meshChunkStore.delete(id);
    return full;
  }
  return null;
}

function meshBroadcast(type, data) {
  if ((!meshDevice && !meshWsConnected && !isRnodeConnected()) || !state.currentSet) return;
  const payload = { ...data, team_id: state.currentSet, ts: Date.now() };
  const msg = JSON.stringify({ type, data: payload });

  // WS mesh: always broadcast (internet relay)
  if (meshWsConnected && meshWs && meshWs.readyState === WebSocket.OPEN) {
    const enc = new TextEncoder();
    const chunksJson = mesh_chunk_encode(enc.encode(msg));
    const chunks = JSON.parse(chunksJson);
    if (chunks.length === 0) {
      meshWs.send(JSON.stringify({ type: "mesh_uplink", payload: msg, to: meshTargetNode }));
    } else {
      for (let i = 0; i < chunks.length; i++) {
        setTimeout(() => {
          if (meshWs && meshWs.readyState === WebSocket.OPEN) {
            meshWs.send(JSON.stringify({ type: "mesh_uplink", payload: chunks[i], to: meshTargetNode }));
          }
        }, i * 200);
      }
    }
  }

  // Serial mesh: only send when directly targeting a node (off-grid direct)
  if (meshDevice && meshTargetNode !== null && meshTargetNode !== undefined) {
    const destination = String(meshTargetNode);
    const enc = new TextEncoder();
    const chunksJson = mesh_chunk_encode(enc.encode(msg));
    const chunks = JSON.parse(chunksJson);

    if (chunks.length === 0) {
      meshDevice.sendText(msg, destination, false).catch(() => {});
    } else {
      for (let i = 0; i < chunks.length; i++) {
        setTimeout(() => {
          meshDevice.sendText(chunks[i], destination, false).catch(() => {});
        }, i * 200);
      }
    }
  }

  // RNode: send raw via KISS framing
  if (isRnodeConnected()) {
    const enc = new TextEncoder();
    const chunksJson = mesh_chunk_encode(enc.encode(msg));
    const chunks = JSON.parse(chunksJson);
    if (chunks.length === 0) {
      rnodeSend(msg);
    } else {
      for (let i = 0; i < chunks.length; i++) {
        setTimeout(() => {
          if (isRnodeConnected()) rnodeSend(chunks[i]);
        }, i * 200);
      }
    }
  }
}

// ---- Mesh Inbox ----

const PIGGPIN_TYPES = ["new_pin", "delete_pin", "new_drawing", "delete_drawing", "keys", "sync_pins", "sync_drawings", "map_view", "new_annotation", "annotation_vote", "new_tombstone", "sync_annotations", "gossip_capabilities", "gossip_query", "gossip_response"];

function isPiggpinMessage(msg) {
  return msg && typeof msg.type === "string" && PIGGPIN_TYPES.includes(msg.type);
}

function addToInbox(msg, nodeNum) {
  // Skip self-echoes from serial radio (meshNodeNum), allow WS relay (0) and others
  if (!nodeNum && nodeNum !== 0) return;
  if (nodeNum === meshNodeNum) return;

  // Deduplicate: same type + pin_id/drawing_id
  const dedupKey = msg.data?.pin_id || msg.data?.drawing_id || "";
  if (dedupKey) {
    const dupe = meshInbox.find(e => e.type === msg.type && (e.data?.pin_id === dedupKey || e.data?.drawing_id === dedupKey));
    if (dupe) return;
  }

  const entry = {
    id: Date.now().toString(36) + crypto.randomUUID().slice(0, 8),
    type: msg.type,
    data: msg.data,
    from: nodeNum,
    ts: Date.now(),
    accepted: false,
  };
  const MAX_INBOX = 200;
  if (meshInbox.length >= MAX_INBOX) {
    meshInbox.shift();
  }
  meshInbox.push(entry);
  meshInboxUnread++;

  const peer = meshPeers.get(nodeNum);
  const peerName = peer?.name || `Node ${nodeNum}`;
  toast(`\u{1F4E5} ${escapeHtml(peerName)}: ${msg.type}`, "#7c3aed");
  console.log("[mesh] inbox ←", msg.type, "from", peerName);

  window._renderUI?.();
}

export function getInbox() {
  return meshInbox.slice().reverse();
}

export function getInboxUnread() {
  return meshInboxUnread;
}

export function acceptInboxItem(itemId) {
  const idx = meshInbox.findIndex(e => e.id === itemId);
  if (idx === -1) return;
  const item = meshInbox[idx];
  if (item.accepted) return;
  console.log("[mesh] accepting inbox item:", item.type, "data keys:", Object.keys(item.data || {}).join(","));
  item.accepted = true;
  if (meshInboxUnread > 0) meshInboxUnread--;
  const msg = { type: item.type, data: item.data };
  Sync.handleMessage(msg, item.from ? meshPeerConnId(item.from) : "mesh_unknown");
  toast(`✅ Imported ${item.type}`, "#16a34a");
  window._renderUI?.();
}

export function dismissInboxItem(itemId) {
  const idx = meshInbox.findIndex(e => e.id === itemId);
  if (idx === -1) return;
  if (!meshInbox[idx].accepted && meshInboxUnread > 0) meshInboxUnread--;
  meshInbox.splice(idx, 1);
  window._renderUI?.();
}

export async function acceptAllInbox() {
  for (const item of meshInbox) {
    if (!item.accepted) {
      item.accepted = true;
      const msg = { type: item.type, data: item.data };
      try { await Sync.handleMessage(msg, item.from ? meshPeerConnId(item.from) : "mesh_unknown"); } catch (_) {}
    }
  }
  meshInboxUnread = 0;
  toast(`✅ Imported all`, "#16a34a");
  window._renderUI?.();
}

window.addEventListener("pagehide", () => {
  disconnectMesh();
});
