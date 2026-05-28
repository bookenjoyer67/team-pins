# piggPin Roadmap

## Completed

### Phase 1: Intra-Set Layers
Organize pins into named layers within a map. Each layer has a color, visibility toggle, and opacity slider. An active layer (●) determines where new pins land. Layers travel with exports. Backward-compatible — legacy maps get a single "Default" layer.

### Phase 2: Mark Schemas
Global schema pool with custom typed fields (text, number, choice, date, time, boolean). Dynamic pin forms that adapt to the active layer's bound schema. Schemas sync between peers and are reusable across all maps. Schema editor with field add/delete/reorder. Title/note always present as universal fallback alongside custom data.

### Import from Map
Copy pins and drawings between maps at the layer level. Decrypts source data, re-encrypts for target map. Imports referenced schemas into the global pool. Progress feedback for large imports. Target layer's schema is inherited by imported pins.

---

## Upcoming

### Phase 3: Temporal Cartography
Every mark gets optional `valid_from` and `valid_until` timestamps with recurrence patterns (seasonal, weekly, one-time). A time slider on the map filters marks by the visible time window. Marks fade in/out as they enter/leave. Seasonal farmers markets, historical buildings, future developments, recurring events — all visible on the same map across time.

### Phase 4: Trust Webs
Trust levels per known peer: trusted, neutral, untrusted. Marks from untrusted peers are hidden or shown with a warning badge. Web-of-trust propagation — if Alice trusts Bob and Bob trusts Carol, Alice sees Carol's marks with "via Bob" confidence. Selective sync — join a peer's group without displaying their marks. Visual confidence indicators on all peer-sourced data.

### Phase 5: Public Layers
Read-only subscription layers via relay. Publish a layer with a topic tag. Others subscribe and receive periodic sync updates. Layer curators publish updates; subscribers consume. Use cases: neighborhood watch maps, trail conditions, farmers market schedules, disaster response overlays, community-maintained resource directories.

### Mesh Completion
Finish offline mesh support. Meshtastic direct messaging between mapped nodes. RNode range testing and signal quality indicators. Reticulum announce-based peer discovery. Mesh-aware layer sync — changes propagate over radio as peers come within range.

---

## Long-term Vision

### Narrative Cartography
Audio notes pinned to locations — oral histories, field recordings, ambient sound. Mark chains: sequences of connected pins telling a story or documenting a route with waypoints. Rich text descriptions with media embedding. The map becomes a storytelling medium. Not just what is here, but what happened here, to whom, and why it matters.

### Counter-Cartography
Deliberately mapping what institutional and commercial maps omit: surveillance camera locations, pollution sources, eviction hotspots, informal paths, guerrilla gardens, mutual aid networks, safe consumption sites, protest routes. The map as a tool of witness and resistance. Anonymous mark placement. Community-vetted accuracy.

### Federated Governance
Community voting on shared public layers — DAO-like consensus for map data. Different communities define their own validation rules and schema governance. The map is governed by the people who live on it, not a corporation deciding what's important.

### Physical / Digital Bridge
QR codes at physical locations load that spot's community marks. LoRa relays carry updates between devices with no internet infrastructure. Geocaching-style physical markers that sync when someone with the app visits. The map escapes the screen and lives in the physical world.
