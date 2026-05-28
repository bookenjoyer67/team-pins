# piggPin

Peer-to-peer encrypted collaborative cartography. Place pins, draw shapes, define custom schemas, organize into layers — synced directly between peers via WebRTC. Decentralized. No accounts. No cloud.

## How it works

- **Create maps** — each is an independent encrypted collection with its own keys
- **Layers** — organize pins into named layers within a map: visibility toggles, opacity, active layer for editing
- **Schemas** — define custom pin forms with typed fields (text, number, choice, date, time, boolean). Global pool shared across all maps
- **Import between maps** — copy pins and drawings from any map into another at the layer level
- **Host a group** — generates a connection code / QR / link. Share it with a peer.
- **Join a peer** — scan their QR, paste their code, or use a relay link. Data syncs automatically.
- **Mesh network** — peers auto-connect to each other, not just the host
- **Export/Import** — share entire maps as portable encrypted blobs (optional password). Layers, schemas, and custom data travel together.

Everything is encrypted client-side (ChaCha20Poly1305, X25519). Keys and data never leave your device.

## Features

- **Pins** — drop pins with title, note, custom schema fields, photo/video attachments, emoji, and colors
- **Layers** — organize pins into categories with per-layer color coding, visibility toggles, opacity sliders, and an active editing target
- **Schemas** — custom typed fields per pin (text, number, choice, date, time, boolean). Define once, reuse on any map. Schema sync between peers
- **Import from Map** — copy pins and drawings between your maps at the layer level. Re-encrypted for the target map with progress feedback
- **Drawings** — polygon, polyline, rectangle, circle, and freehand with custom colors
- **Free draw** — click and drag to sketch any path on the map, with auto-shape detection
- **Circle metrics** — circumference, diameter, and area automatically calculated
- **All drawing metrics** — length, perimeter, and area shown in popups
- **Metric/imperial toggle** — switch units inline per drawing (m/km vs yd/mi)
- **Drawing attachments** — attach files to any drawing
- **Edit pins & drawings** — update title, note, color, layer, schema, and arrow after creation
- **Pin search** — filter pins by title or note text
- **Pin slideshow** — animated fly-through of all pins with reorderable slide order
- **Multiple maps** — independent tabs with separate encryption keys and layers
- **Color presets** — 8 colors for pins and drawings
- **Touch-friendly** — custom 36×36px draw toolbar with SVG icons
- **ICE / TURN config** — custom STUN/TURN servers and WebSocket relay
- **Follow toggle** — sync map position across connected peers
- **Offline tiles** — tiles cached by service worker for offline access
- **Offline mesh** — Meshtastic, RNode, and Reticulum radio mesh support
- **PWA** — installable on desktop and mobile
- **10 languages** — en, es, fr, de, pt, zh, ja, ar, ru, uk

## Architecture

```
main.js        Entry point, UI rendering, history, tabs, event delegation
map.js         Map, pins, drawings, layers, schemas, forms, import, metrics
sync.js        WebRTC messages, broadcast, host/join, export/import, key rotation
dialogs.js     QR dialogs, password, progress, toast
state.js       Shared reactive state (layers, schemas, active layer)
peer.js        WebRTC peer connection manager
db.js          IndexedDB storage (8 object stores)
qr.js          Camera-based QR scanner
core/src/lib.rs  Rust → WASM crypto (X25519, ChaCha20Poly1305, ECIES)
style.css      All styles
```

## Tech stack

- **Frontend:** Vanilla JS + Vite + Leaflet + Leaflet-draw + Leaflet.markercluster
- **Crypto:** Rust → WASM (X25519, ChaCha20Poly1305, ECIES, gzip, QR generation)
- **Storage:** IndexedDB (zero server)
- **Networking:** WebRTC data channels (P2P mesh)
- **Mobile:** Capacitor (Android APK / iOS)
- **Desktop:** Tauri (Linux, macOS, Windows)
- **Signaling relay:** Rust (Tokio + Tungstenite + MQTT + RNode + Reticulum bridges)

## Setup

```bash
npm install
cd core && wasm-pack build --target web && cd ..
npm run dev        # http://localhost:5173
```

### Relay server (optional — enables one-link multi-peer rooms)

```bash
cd signal-server
cargo build --release
./target/release/piggpin-signal [config.toml]   # defaults to port 9000
```

Configure ICE settings in the app (gear ⚙ button) to point to your relay URL (`ws://your-server:9000`).

## Build

```bash
npm run build      # → dist/

# Android APK
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

## License

MIT
