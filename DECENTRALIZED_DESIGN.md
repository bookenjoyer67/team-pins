# piggPin — Decentralized Asymmetric Cartography: Full Design

## Core Thesis

Google Maps answers **"What is here?"** — according to Google.
piggPin answers **"What matters here?"** — according to the communities who live it.

There is no single truth about a place. A building is simultaneously a Starbucks (commercial layer), the site of the old cinema (memory layer), a good public bathroom (survival layer), built on unceded land (decolonial layer). Google flattens this into one authoritative pin. piggPin lets every community maintain its own map of the world, overlapping and contradicting freely.

**The asymmetry**: Google Maps has one producer and billions of consumers. piggPin has billions of producers organized into communities, each with their own ontology, governance, and trust model. You don't consume a map — you participate in one.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    piggPin Node (PWA)                      │
├──────────────────────────────────────────────────────────┤
│  Local State (IndexedDB)                                  │
│  ├── Communities[]         ← governance + membership      │
│  ├── Layers[]              ← per-community visual org     │
│  ├── Pins[] / Drawings[]   ← encrypted map data           │
│  ├── Schemas[]             ← community ontologies         │
│  ├── TrustGraph{}          ← local trust relationships    │
│  └── PeerRegistry[]        ← known peers + capabilities   │
├──────────────────────────────────────────────────────────┤
│  Sync Engine                                              │
│  ├── WebRTC (P2P direct)                                  │
│  ├── Reticulum (self-sovereign mesh)                      │
│  ├── LoRa/RNode (radio mesh)                              │
│  ├── Gossip Protocol (geographic discovery)               │
│  └── Community Relay Nodes (persistent availability)      │
├──────────────────────────────────────────────────────────┤
│  Crypto Layer (Rust/WASM)                                 │
│  ├── X25519 key exchange                                  │
│  ├── ChaCha20Poly1305 encryption                          │
│  ├── Ed25519 signatures (attestations)                    │
│  └── BLAKE3 hashing (content addressing)                  │
└──────────────────────────────────────────────────────────┘
         │              │              │
         ▼              ▼              ▼
  ┌─────────────┐ ┌──────────┐ ┌────────────────┐
  │ Peer Nodes  │ │ LoRa Mesh│ │ Community Relay │
  │ (other PWAs)│ │ (radio)  │ │ Nodes (opt-in) │
  └─────────────┘ └──────────┘ └────────────────┘
```

---

## Phase A: Community Identity & Governance

### What changes

The current "team/set" model (UUID + DEK + name) becomes a **Community** — a self-sovereign entity with identity, membership, and rules.

### Data Model

```js
Community {
  community_id: BLAKE3(genesis_public_key),  // deterministic, unforgeable
  name: "Mutual Aid PDX",
  description: "Free resources in Portland metro",
  genesis_key: { public_key, created_at },   // founder identity
  
  // Encryption (backwards-compat with current DEK model)
  public_key,        // community-level X25519
  wrapped_dek,       // DEK wrapped for community key
  
  // Membership
  members: [
    { 
      pubkey: "ed25519_hex",
      display_name: "Alice",
      role: "founder" | "maintainer" | "contributor" | "reader",
      joined_at: timestamp,
      vouched_by: pubkey | null,  // who invited them
    }
  ],
  
  // Governance
  governance: {
    contribution: "open",          // default: anyone with key can write
    validation: "none",            // "none" | "quorum(N)" | "maintainer_approve"
    schema_authority: "any_member", // who can create/edit schemas
    key_rotation: "founder_only",  // who can rotate DEK
    fork_policy: "allowed",        // can members fork and take data?
  },
  
  // Geographic scope (optional)
  bounds: GeoJSON | null,          // "this community covers Portland metro"
  
  // Ontology
  schemas: [Schema],               // what this community maps
  
  // Relay configuration
  relay_nodes: [                    // community-designated always-on nodes
    { url: "wss://relay.mutualaid.pdx", pubkey, role: "mirror" }
  ],
}
```

### Migration from current model

- Existing "teams" become communities with `governance: { contribution: "open" }` and a single member (the device owner as founder).
- `team_id` maps to `community_id`.
- DEK/key model unchanged — backwards compatible.
- No account creation required. Identity is still just a key pair.

### IndexedDB changes

New store: `communities` (keyPath: `community_id`). Replaces reliance on `teams` for governance metadata. The `teams` store remains for crypto material (backwards compat).

---

## Phase B: Trust Web & Peer Attestation

### The Problem

In Google Maps, Google says "this is verified." In piggPin, **the community** verifies. But "community" isn't monolithic — trust is a graph, not a hierarchy.

### Design

Every pin/drawing gains an **attestation chain**:

```js
Pin {
  ...existing fields,
  attestations: [
    {
      pubkey: "ed25519_of_attester",
      type: "created" | "confirmed" | "disputed" | "updated" | "flagged",
      timestamp,
      signature: sign(pin_id + type + timestamp, attester_secret_key),
      note: "I verified this fridge is still stocked" | null,
    }
  ]
}
```

### Trust Score Computation (local, per-viewer)

Each viewer computes trust scores locally based on their own trust graph:

```
trust_score(pin) = Σ (attestation.weight × trust_distance(attester))

where:
  trust_distance(peer) = {
    self: 1.0,
    direct_peer: 0.8,
    vouched_by_peer: 0.5,
    community_member: 0.3,
    unknown: 0.1,
  }
  
  attestation.weight = {
    created: 0.5,
    confirmed: 1.0,
    disputed: -0.8,
    flagged: -1.0,
  }
```

### Visual representation

- Pins with high trust: full opacity, solid outline
- Pins with moderate trust: normal opacity
- Pins with low/negative trust: faded, dashed outline, "disputed" badge
- User can set minimum trust threshold to filter

### No central reputation

Every device computes its own view. Alice might trust a pin that Bob disputes. They see different maps. This IS the asymmetry.

---

## Phase C: Gossip-Based Discovery

### The Problem

Google Maps: type "coffee" → results. piggPin: how do you find data you don't already have?

### Geographic Gossip Protocol

When peers connect (via any transport), they exchange **capability advertisements**:

```js
GossipAnnounce {
  type: "gossip_capabilities",
  peer_id: pubkey,
  communities: [
    {
      community_id,
      name: "Mutual Aid PDX",
      bounds: simplified_geojson,   // where this community has data
      pin_count: 247,
      categories: ["free_fridge", "water", "shelter"],  // from ontology
      last_updated: timestamp,
      access: "open" | "request" | "invite_only",
    }
  ],
  interests: ["mutual_aid", "urban_exploration"],  // what I'm looking for
}
```

### Discovery Flow

1. **Passive**: When connected to relay/mesh, receive announces from other communities
2. **Active**: Pan map to new area → query connected peers: "anyone have data for [bbox]?"
3. **Subscription**: "I want to subscribe to community X" → peer shares community key + data

### Geographic Queries

```js
GossipQuery {
  type: "gossip_query",
  bbox: [sw_lat, sw_lng, ne_lat, ne_lng],
  categories: ["free_fridge"],          // optional filter
  min_trust: 0.3,                       // minimum trust score from querier's perspective
  max_age: 86400000,                    // only data updated in last 24h
}

GossipResponse {
  type: "gossip_response", 
  community_id,
  preview: [                            // metadata only, not full encrypted pins
    { lat, lng, category, last_attested, attestation_count }
  ],
  offer: "full_sync" | "subscribe_key", // what the responder can offer
}
```

The viewer sees: "Community 'Mutual Aid PDX' has 12 pins in this area. [Request access]"

### No index, no directory

Discovery happens through the network itself. The more peers you connect to, the more communities you can discover. Like word of mouth, not like a search engine.

---

## Phase D: Federated Ontologies

### The Problem

Google says the world consists of: Restaurants, Gas Stations, Hotels, Parks. Communities say: free fridges, safe sleeping spots, indigenous sacred sites, accessible bathrooms, good skateboarding spots.

### Design: Schemas as Living Documents

Building on the existing schema system, schemas become:

```js
Schema {
  schema_id,
  community_id,           // who created this
  name: "Mutual Aid Resource",
  version: 3,             // increments on edit
  forked_from: { community_id, schema_id, version } | null,
  
  fields: [
    { key: "resource_type", label: "Type", type: "choice", 
      options: ["fridge", "pantry", "water", "shelter", "wifi", "power", "tools"] },
    { key: "hours", label: "Available hours", type: "text" },
    { key: "last_verified", label: "Last verified", type: "date" },
    { key: "capacity", label: "Capacity", type: "number" },
    { key: "needs_restock", label: "Needs restock?", type: "boolean" },
  ],
  
  // How this schema maps to other schemas (interop)
  mappings: [
    { target_schema_id, field_map: { "resource_type": "category" } }
  ],
}
```

### Schema Operations

- **Publish**: Share schema with peers → they can adopt it for their community
- **Fork**: Copy another community's schema, modify for your context
- **Subscribe**: Automatically receive schema updates from source community
- **Map**: Define how fields in schema A correspond to fields in schema B (lossy interop)

### Cross-community search

When you search "water" across subscribed communities:
- Community A (schema: "Mutual Aid Resource") matches on `resource_type = "water"`
- Community B (schema: "Urban Survival") matches on `amenity = "drinking_water"`
- Both show on your map, each with their community badge

### No universal schema

There is no "correct" way to categorize the world. A church is simultaneously: "community space" (mutual aid), "historical building" (preservation), "unsafe" (queer survival map), "sacred" (religious community). The schemas don't reconcile — they coexist.

---

## Phase E: Community Relay Nodes

### The Problem

Current: if no peers are online, you can't sync. Communities need availability.

### Design: Designated Relay Nodes

A community can designate one or more **relay nodes** — always-on servers that:
1. Store the community's encrypted data (they hold the DEK, or encrypted blobs if untrusted)
2. Serve data to new members on connect
3. Accept writes from authorized members
4. Gossip with other relay nodes (federation)

```
┌─────────┐     ┌─────────────────┐     ┌─────────┐
│ Alice    │────▶│ Community Relay  │◀────│  Bob    │
│ (mobile) │     │ relay.mutualaid  │     │ (laptop)│
└─────────┘     └────────┬────────┘     └─────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Carol (offline) │  ← syncs next time online
                └─────────────────┘
```

### Relay Node Roles

```rust
RelayNode {
    community_id: String,
    role: "trusted_mirror" | "encrypted_store" | "gossip_bridge",
    // trusted_mirror: holds DEK, can decrypt, can validate attestations
    // encrypted_store: holds encrypted blobs only, cannot read data
    // gossip_bridge: only advertises community metadata, doesn't store pins
    
    storage: {
        max_pins: u64,
        max_drawings: u64,
        max_media_bytes: u64,
        retention_days: u32,
    },
    
    access_control: {
        write: "community_members",    // verify Ed25519 signature
        read: "community_members",     // verify membership
        admin: [pubkey],               // who can change relay config
    },
}
```

### Implementation: Extend Signal Server

The existing `signal-server` (Rust, WebSocket) becomes the reference relay implementation:
- Add community registration endpoint
- Add pin/drawing storage (encrypted blobs in SQLite or sled)
- Add membership verification (check Ed25519 signatures)
- Add gossip federation (relay-to-relay sync)
- Keep share functionality (already exists)

### Self-hostable

Any community member can spin up a relay for their community. Multiple relays can serve the same community (redundancy). No single point of failure.

### Sync Protocol

```
Client connects to relay:
  1. Authenticate: sign(timestamp, my_secret_key) → prove membership
  2. Request state: "give me all changes since timestamp X"
  3. Receive delta: relay sends new/updated/deleted pins since X
  4. Push changes: client sends local changes → relay stores + broadcasts to other connected clients
  5. Gossip: relay sends community capability advertisement
```

---

## Phase F: Offline-First Inversion

### Principle

Internet is a convenience, not a requirement. The app must work fully offline, sync opportunistically.

### Transport Priority (inverted from current)

1. **Local device** — always available (IndexedDB)
2. **LoRa/RNode/Meshtastic** — works without any infrastructure
3. **Reticulum** — self-sovereign internet mesh (no DNS, no CA)
4. **WebRTC** — direct browser-to-browser (requires STUN/TURN)
5. **Community Relay** — persistent store (requires internet + server)

### Store-and-Forward

When a node receives data from one peer but can't reach another:
- Cache the update locally
- Next time the unreachable peer connects (via any transport), forward the cached update
- Each update has a vector clock to prevent duplicates

### Conflict Resolution

With offline-first + eventual consistency, conflicts are inevitable:
- **Last-writer-wins** for simple edits (current behavior)
- **Attestation merge** for trust data (union of all attestations)
- **Fork** for irreconcilable differences (community splits into two)

---

## Implementation Order

```
Phase A: Community Identity (2-3 weeks)
  ├── Community data model in IndexedDB
  ├── Migration from teams → communities
  ├── Membership management UI
  ├── Open contribution governance (default)
  └── Community creation/join flow

Phase B: Trust Web (2-3 weeks)
  ├── Ed25519 signing in Rust/WASM core
  ├── Attestation model on pins/drawings
  ├── Local trust graph computation
  ├── Visual trust indicators on map
  └── Trust threshold filter

Phase C: Community Relay Nodes (3-4 weeks)
  ├── Extend signal-server with storage
  ├── Community registration endpoint
  ├── Membership verification (signatures)
  ├── Delta sync protocol
  ├── Client-side relay connection manager
  └── Multi-relay redundancy

Phase D: Gossip Discovery (2-3 weeks)
  ├── Capability advertisement protocol
  ├── Geographic query/response
  ├── Community discovery UI
  ├── Subscription flow (request access → receive key)
  └── Cross-community map overlay

Phase E: Federated Ontologies (2 weeks)
  ├── Schema publishing/forking
  ├── Schema subscription (auto-update)
  ├── Cross-schema field mapping
  └── Multi-schema search

Phase F: Offline-First Inversion (2 weeks)
  ├── Store-and-forward cache
  ├── Vector clock deduplication
  ├── Transport priority manager
  └── Conflict resolution policy
```

---

## Files Affected

| Area | Files | Scope |
|---|---|---|
| Community model | `db.js`, `state.js`, new `community.js` | Major — new stores, new state |
| Trust/signatures | `core/src/lib.rs` (add Ed25519) | Major — new WASM exports |
| Attestations | `map.js`, `sync.js` | Moderate — extend pin/drawing model |
| Relay persistence | `signal-server/src/` | Major — new storage + auth endpoints |
| Gossip protocol | `mesh.js`, `sync.js`, new `gossip.js` | Major — new protocol layer |
| Discovery UI | `main.js`, `map.js`, `style.css` | Moderate — new modals |
| Federated schemas | `map.js`, `db.js` | Moderate — extend existing schema system |

---

## Design Principles (Non-Negotiable)

1. **No accounts, ever.** Identity = key pair. Generated on first launch. Never leaves device.
2. **No central authority.** Not even "the piggPin team." Communities self-govern.
3. **Encryption by default.** Data is encrypted at rest and in transit. Relay nodes that are "encrypted_store" cannot read your pins.
4. **Forkable.** Any community member can fork and take their data. No lock-in.
5. **Internet-optional.** The app must work on LoRa + sneakernet alone.
6. **Contradictions welcome.** Two communities can map the same location with incompatible truths. Both are valid.
