# Rust/WASM Architecture Overhaul Plan

## Current Architecture

```
┌─────────────────────────────────────────────────┐
│  e2e_core_bg.wasm (Rust)                        │
│  ═══ PURE FUNCTIONS ONLY ═══                    │
│  crypto | compress | serialize | geometry | QR  │
│  27+ exported functions, ~1073 lines lib.rs     │
└──────────┬──────────────────────────────────────┘
           │ Uint8Array / String in, result out
┌──────────▼──────────────────────────────────────┐
│  JS Application (6,000+ lines)                  │
│  ═══ ALL STATE, NETWORK, UI HERE ═══            │
│  state.js → mutable proxy over Maps/Arrays      │
│  sync.js  → JSON tree walk, chunking, export    │
│  peer.js  → WebRTC orchestration                │
│  relay.js → WebSocket orchestration             │
│  mesh.js  → Meshtastic/BLE orchestration        │
│  window._* globals → lazy cross-module calls    │
└─────────────────────────────────────────────────┘
```

**Problem**: JS manages 12+ unbounded Maps/Arrays, 30+ hardcoded constants, ~124 silent catch blocks, 0 ownership semantics.

---

## Memory Safety Issues Found

### Unbounded Map Growth

| Collection | File:Line | Growth Pattern | Severity |
|---|---|---|---|
| `state.peers` (Map) | `state.js:31` | +1 per unique peer, never evicted | Medium |
| `meshPeers` (Map) | `mesh.js:14` | +1 per unique mesh node, never evicted | Medium |
| `meshMarkers` (Map) | `mesh.js:15` | +1 per node, only cleared on disconnect | Medium |
| `_peerLocations` (Map) | `sync.js:609` | +1 per connId per map_view, never cleaned | Medium |
| `meshInbox` (Array) | `mesh.js:29` | Accepted items never removed from array | Low |
| `discoveryCache` (Map) | `gossip.js:8` | Capped at 500, no time TTL | Low |

### Event Listener Leaks

| Location | Issue |
|---|---|
| `freeDraw.js:472-617` | 5 pointer listeners never removed (but gated by state flag) |
| `freeDraw.js:232` | Width popout dismiss listener never removed |
| `drawer.js:601-611` | Drag listeners on document persist for entire session |
| `main.js:568` | `onEngage` click listener may persist indefinitely |

### Timer Leaks

| Location | Issue |
|---|---|
| `main.js:148` | `sendAll` timeout fires even if connection drops |
| `sync.js:296` | `sendAll` timeout fires for stale connId |
| `mesh.js:750,770,786` | Chunk send timeouts not cleared on disconnect |
| `main.js:562` | `showInstallBanner` timeout fires after user leaves |

### Silent Error Swallowing (~124 instances)

| Location | Impact |
|---|---|
| `sync.js:769` | Delete broadcasts proceed without Ed25519 signature |
| `sync.js:66` | Corrupted chunk reassembly loses data permanently |
| `relay.js:88,96,263` | WS send failures silently lose data |
| `main.js:506,521,555` | Community join failures show nothing to user |
| `main.js:946-1095` | Single catch wraps 150-line click handler |

---

## Performance Issues Found

| Issue | File:Line | Impact |
|---|---|---|
| `String.fromCharCode(...spread)` base64 | `sync.js:131-143` | MB-scale buffers every export/share |
| Sequential `await DB.importPin()` | `sync.js:656-662` | 500 pins = 500 IndexedDB transactions |
| `compactStoredMedia` on main thread | `sync.js:198-220` | 30+ seconds blocking for large sets |
| O(n*m) bbox checks in gossip | `gossip.js:113-143` | No spatial index |
| Search on every keystroke | `main.js:1131` | No debounce |
| ~400 lines duplicated community join | `main.js:455-555,714-830` | Maintenance burden |

---

## Phase 1: Base64 to WASM (3 hours)

**Why**: The `base64` crate is already in `Cargo.toml:26` but only used in `mesh_chunk_encode`. Meanwhile `sync.js:131-143` does the slow `String.fromCharCode(...spread)` pattern on MB-scale data.

**New WASM exports in `core/src/lib.rs`:**
```rust
#[wasm_bindgen] pub fn base64_encode(data: &[u8]) -> String
#[wasm_bindgen] pub fn base64_decode(base64: &str) -> Vec<u8>
#[wasm_bindgen] pub fn compress_gzip_to_base64(data: &[u8]) -> String
```

**JS changes:**
- `sync.js:131-143` — Replace `bytesToBase64`/`base64ToBytes` with WASM calls
- `peer.js:109-115` — Replace gzip→spread→btoa with single `compress_gzip_to_base64`
- `map.js:1080`, `map.js:1158`, `sync.js:1196` — Same replacement

---

## Phase 2: Bounded State Containers in WASM (12 hours)

**Why**: The memory safety analysis found 4 unbounded Maps plus 3 chunk stores with only time-based eviction. Rust ownership eliminates this class of bug.

**New Rust module `core/src/store.rs`:**
```rust
#[wasm_bindgen]
pub struct Store { ... }

impl Store {
    pub fn new(max_entries: u32, ttl_ms: u64) -> Store
    pub fn get(&self, key: &str) -> JsValue
    pub fn set(&self, key: &str, value: JsValue, ttl_ms: Option<u64>)
    pub fn delete(&self, key: &str)
    pub fn size(&self) -> u32
    pub fn evict_expired(&self) -> u32
    pub fn values(&self) -> JsValue
    pub fn entries(&self) -> JsValue
}
```

**Replace these unbounded collections:**

| JS Collection | File:Line | Max Size | TTL | New WASM Store |
|---|---|---|---|---|
| `state.peers` | `state.js:31` | 500 | 24h | `peerStore` |
| `meshPeers` | `mesh.js:14` | 100 | 1h | `meshPeerStore` |
| `meshMarkers` | `mesh.js:15` | 100 | 1h | (merged into meshPeerStore) |
| `_peerLocations` | `sync.js:609` | 200 | 120s | `peerLocationStore` |
| `meshInbox` | `mesh.js:29` | 200 | 7d | `meshInboxStore` |
| `chunkStore` | `sync.js:18` | 500 | 60s | `chunkStore` |
| `syncBatchStore` | `sync.js:21` | 200 | 30s | `batchStore` |
| `meshChunkStore` | `mesh.js:37` | 200 | 60s | `meshChunkStore` |
| `discoveryCache` | `gossip.js:8` | 500 | 10m | `discoveryStore` |
| `_history` | `state.js:35` | 50 | — | `historyStore` (FIFO) |
| `votedPins` | `main.js:19` | — | session | `voteStore` (per-set) |

**Eviction strategy:**
- `peerStore`: LRU + 24h TTL + remove on disconnect
- `meshPeerStore`: 1h TTL + remove on disconnect
- `chunkStore`: 60s TTL + max 500 entries
- `discoveryStore`: 10m TTL + max 500 entries
- `historyStore`: FIFO ring buffer, 50 max

---

## Phase 3: Unified Sync Pipeline in WASM (8 hours)

**Why**: Export/share traverses the entire dataset through JS 3 times: `stripEmpties` (recursive), `packHexFields` (recursive with per-field hex→b64), then `JSON.stringify`. One WASM pass does all three.

**New WASM exports:**
```rust
#[wasm_bindgen] pub fn pack_json_for_transfer(json: &str) -> String
#[wasm_bindgen] pub fn unpack_json_from_transfer(packed: &str) -> String
#[wasm_bindgen] pub fn export_dataset_to_bytes(json: &str) -> Vec<u8>
```

**JS changes:**
- `sync.js:96-170` — Replace `stripEmpties`/`packHexFields`/`unpackHexFields`/`bytesToBase64`/`base64ToBytes`/`hexToBytes`/`walkHexFields` (~75 lines) with single WASM calls
- `sync.js:1042-1102` — `exportSet` reduced to: `DB.getAll → WASM.export_dataset_to_bytes → Blob → download`
- Also fixes the `base64ToBytes`→`encode_hex` roundtrip in `unpackHexFields:169`

---

## Phase 4: Error & Cleanup Infrastructure (6 hours)

### 4a. Connection Lifecycle Manager

Create `connection-lifecycle.js`:
```js
export class ConnectionLifecycle {
    constructor(id)
    addTimer(fn, ms)          // tracked, cancelled on close()
    addListener(el, ev, fn)   // tracked, removed on close()
    close()                    // cancels all timers, removes all listeners
}
```

Used by: `peer.js`, `relay.js`, `mesh.js` connections.

### 4b. Replace silent catches with structured logging

Priority order:
1. `sync.js:769` — Security: deletes MUST NOT proceed without signature
2. `sync.js:66` — Data loss: chunk reassembly must retry or notify
3. `main.js:506,521,555` — UX: community join failures must show error
4. `relay.js:88,96,263` — Data loss: WS send failures should queue retry

### 4c. Remove `window._*` globals (message bus)

Replace 70+ `window._*` functions with `MessageBus`:
```js
// Instead of: window._relayPushDelta?.(set, pins, ...)
// Use:        bus.emit("relay:push-delta", { set, pins, annotations, ... })
```

Benefits:
- Static analysis of message flows
- Testability without `window` mocking
- Explicit subscribe/unsubscribe (fixes listener leaks)

---

## Phase 5: Deduplication & Refactoring (6 hours)

### 5a. Community join logic
- `main.js:455-555` and `main.js:714-830` → single `joinCommunity(community, options)`
- Fix `pending-community` not cleared on failure (ghost re-join)

### 5b. Media compression
- `map.js:147-200` and `helpers.js:97-140` → single `compressMedia()` module
- Move to Web Worker (Canvas→WebP already hardware-accelerated)

### 5c. Relay delta handlers
- `handleSyncDelta:394-456` and `handleIncomingDelta:345-392` → single handler

### 5d. Relay connection logic
- `hostGroupViaRelay:822` and `joinPeerViaRelay:907` → shared WS setup utility

---

## Phase 6: Performance Fixes (4 hours)

| Issue | File:Line | Fix |
|---|---|---|
| Sequential DB writes | `sync.js:656-662` | Batch IndexedDB (1 transaction per 100 items) |
| O(n*m) gossip bbox | `gossip.js:113-143` | Spatial hash grid or Leaflet built-in index |
| No search debounce | `main.js:1131` | Add 200ms debounce |
| Giant click handler | `main.js:946-1095` | Split into per-action handlers |

---

## Execution Order & Dependencies

```
Phase 1 (base64 WASM)     ──┐
                             ├── No dependencies, can start immediately
Phase 4c (remove globals)  ──┤
                             │
Phase 2 (Store container)  ──┤
                             ├── Depends on Phase 1 (base64 in WASM ready)
Phase 3 (sync pipeline)   ──┤    Store provides bounded peer/mesh/chunk collections
                             │
Phase 4ab (cleanup infra)  ──┤
                             ├── Depends on Phase 2 (Store handles cleanup auto)
Phase 5 (dedup)            ──┤    Phase 4c message bus enables clean modules
                             │
Phase 6 (perf)            ──┘
```

**Total estimated effort: ~39 hours**

---

## What Stays in JS (and why)

| Module | Why |
|---|---|
| `db.js` (IndexedDB) | WASM can't access IndexedDB |
| `peer.js` (WebRTC) | WASM can't access `RTCPeerConnection` |
| `relay.js` (WebSocket) | WASM can't access `WebSocket` |
| `mesh.js` (BLE/Serial) | Requires Web Bluetooth / Web Serial APIs |
| `map.js` (Leaflet) | WASM can't access DOM or Canvas |
| `main.js` (UI) | WASM can't access DOM |
| `dialogs.js` (modals) | WASM can't access DOM |

JS remains the **I/O and rendering layer**. Rust/WASM becomes the **state, data transformation, and crypto layer**.

---

## NOT Worth Porting to WASM

| Operation | Why not |
|---|---|
| Media compression (images/video) | Browser Canvas/MediaRecorder use hardware codecs. WASM encoder would be slower and worse quality. Use Web Worker instead. |
| Protobuf | Already handled by `@meshtastic/core` npm library |
| KISS framing (mesh_rnode.js) | Sub-millisecond CPU on 256-byte frames |
| IndexedDB operations | Browser API, inherently async |

---

## Key Dependencies Already in Cargo.toml

| Crate | Currently Used | Phase |
|---|---|---|
| `base64` 0.22 | Only in `mesh_chunk_encode` | Phase 1 |
| `serde_json` 1 | Serialization, container parsing | Phase 3 |
| `flate2` 1 | `compress_gzip`, `decompress_gzip` | Phase 1, 3 |
| `chacha20poly1305` 0.10 | All encrypt/decrypt | (already used) |
| `ed25519-dalek` 2 | Sign/verify | (already used) |
| `x25519-dalek` 2 | Key exchange, ECIES | (already used) |
| `pbkdf2` 0.12 | Password-based key derivation | (already used) |
