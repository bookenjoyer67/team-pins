// Minimal WebSocket signaling relay for piggPin — multi-peer rooms
// Run: node signal-server.js [port]
// Default port: 9000

import http from "http";
import { WebSocketServer } from "ws";

const PORT = parseInt(process.argv[2]) || 9000;
const MAX_MSG_SIZE = 51200; // 50KB
const MAX_MSGS_PER_SEC = 20;
const MAX_CLIENTS_PER_IP = 10;
const MAX_CLIENTS_PER_ROOM = 50;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("piggPin signal relay");
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MSG_SIZE });
const rooms = new Map();
const ipCounts = new Map();

function roomKey(url) {
  try { return new URL(url, "http://x").searchParams.get("room"); } catch (_) {}
  return null;
}

wss.on("connection", (ws, req) => {
  const room = roomKey(req.url);
  if (!room) { ws.close(4000, "missing ?room= param"); return; }
  if (/[^a-zA-Z0-9_-]/.test(room)) { ws.close(4001, "invalid room"); return; }

  // Rate limit connections per IP
  const ip = req.socket.remoteAddress || "unknown";
  const ipCount = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, ipCount);
  if (ipCount > MAX_CLIENTS_PER_IP) { ws.close(4002, "too many connections"); return; }

  let entry = rooms.get(room);
  if (!entry) {
    entry = { clients: new Map(), ts: Date.now() };
    rooms.set(room, entry);
  }
  if (entry.clients.size >= MAX_CLIENTS_PER_ROOM) { ws.close(4003, "room full"); return; }

  const clientId = crypto.randomUUID().slice(0, 8);
  entry.clients.set(clientId, ws);
  entry.ts = Date.now();

  // Per-client rate limiting
  let msgCount = 0;
  let msgWindow = Date.now();

  ws.send(JSON.stringify({ type: "welcome", clientId }));

  for (const [cid, c] of entry.clients) {
    if (cid !== clientId && c.readyState === 1) {
      c.send(JSON.stringify({ type: "peer_joined", clientId }));
    }
  }

  ws.on("message", (data) => {
    try {
      // Rate limit: max messages per second per client
      const now = Date.now();
      if (now - msgWindow > 1000) { msgCount = 0; msgWindow = now; }
      if (++msgCount > MAX_MSGS_PER_SEC) return;

      const raw = typeof data === "string" ? data : data.toString();
      // Size limit per message (re-check even with maxPayload)
      if (Buffer.byteLength(raw) > MAX_MSG_SIZE) return;

      const msg = JSON.parse(raw);
      if (msg.to && entry.clients.has(msg.to)) {
        const target = entry.clients.get(msg.to);
        if (target.readyState === 1) target.send(raw);
      } else {
        for (const [cid, c] of entry.clients) {
          if (cid !== clientId && c.readyState === 1) c.send(raw);
        }
      }
    } catch (_) {}
  });

  ws.on("close", () => {
    entry.clients.delete(clientId);
    const currentIpCount = ipCounts.get(ip) || 0;
    if (currentIpCount <= 1) ipCounts.delete(ip);
    else ipCounts.set(ip, Math.max(0, currentIpCount - 1));
    if (entry.clients.size === 0) rooms.delete(room);
    else {
      for (const [, c] of entry.clients) {
        if (c.readyState === 1) c.send(JSON.stringify({ type: "peer_left", clientId }));
      }
    }
  });

  ws.on("error", () => {});
});

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [room, entry] of rooms) {
    if (entry.ts < cutoff && entry.clients.size === 0) rooms.delete(room);
  }
  ipCounts.clear(); // Reset IP counts periodically
}, 60_000);

server.listen(PORT, () => console.log(`signal relay on :${PORT}`));
