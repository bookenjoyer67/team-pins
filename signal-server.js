// Minimal WebSocket signaling relay for piggPin — multi-peer rooms
// Run: node signal-server.js [port]
// Default port: 9000

import http from "http";
import { WebSocketServer } from "ws";

const PORT = parseInt(process.argv[2]) || 9000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("piggPin signal relay");
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function roomKey(url) {
  try { return new URL(url, "http://x").searchParams.get("room"); } catch (_) {}
  return null;
}

wss.on("connection", (ws, req) => {
  const room = roomKey(req.url);
  if (!room) { ws.close(4000, "missing ?room= param"); return; }
  if (/[^a-zA-Z0-9_-]/.test(room)) { ws.close(4001, "invalid room"); return; }

  let entry = rooms.get(room);
  if (!entry) {
    entry = { clients: new Map(), ts: Date.now() };
    rooms.set(room, entry);
  }

  const clientId = crypto.randomUUID().slice(0, 8);
  entry.clients.set(clientId, ws);
  entry.ts = Date.now();

  ws.send(JSON.stringify({ type: "welcome", clientId }));

  for (const [cid, c] of entry.clients) {
    if (cid !== clientId && c.readyState === 1) {
      c.send(JSON.stringify({ type: "peer_joined", clientId }));
    }
  }

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.to && entry.clients.has(msg.to)) {
        const target = entry.clients.get(msg.to);
        if (target.readyState === 1) target.send(data.toString());
      } else {
        for (const [cid, c] of entry.clients) {
          if (cid !== clientId && c.readyState === 1) c.send(data.toString());
        }
      }
    } catch (_) {}
  });

  ws.on("close", () => {
    entry.clients.delete(clientId);
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
}, 60_000);

server.listen(PORT, () => console.log(`signal relay on :${PORT}`));
