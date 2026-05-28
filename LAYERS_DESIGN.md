# piggPin — Layers & Schemas Design

## Core Philosophy: Asymmetric Cartography

**Google Maps answers: "What is here?" — according to Google.**

It's a singular, authoritative, commercially-optimized representation of reality. One producer, billions of consumers. You read. You don't write.

**piggPin answers: "What matters here?" — according to us.**

Billions of producers, each with their own overlays. The map doesn't orbit a single authority. It orbits every person and community. You write. You read what trusted peers wrote.

The asymmetry isn't just technical (P2P vs centralized). It's **epistemological**. Google presents one authoritative reality. piggPin enables multiple overlapping, sometimes contradictory, lived realities on the same geography.

| Google Maps | piggPin |
|---|---|
| Read-heavy ("search this location") | Write-heavy ("draw, mark, annotate this location") |
| One official representation | Multiple overlapping representations per map view |
| Data owned by Google | Encrypted, user-owned, local-first |
| Server-mediated | P2P mesh: WebRTC + radio + Reticulum |
| Account-required identity | Cryptographic identity (key pairs), no accounts |
| Commercial layer (sponsored pins, ads) | Community layers (shared encrypted sets) |

### The palimpsest concept

A single location isn't one thing. It's many things to many people. A building is simultaneously: a Starbucks (commercial layer), the site of the old cinema that closed in '94 (memory layer), a good public bathroom (urban survival layer), built on unceded indigenous land (decolonial layer), where I had my first kiss (personal layer).

The same coordinates host incompatible truths. Google flattens this. piggPin layers it — choose which lens you're looking through, or see them all overlapping. A location becomes a stack of meanings, not a single pin.

---

## Layers

Layers organize pins into named categories **within a single map**. Each layer has its own color, visibility toggle, opacity slider, and optional schema binding.

### Data model

**Layer object** (stored in `layers` IndexedDB store, keyed by `team_id`):
```js
{
  layer_id: "uuid",       // unique identifier
  name: "Birding",        // display name
  color: "#16a34a",      // layer color (for UI badges and dots)
  visible: true,          // currently shown on map?
  opacity: 1.0,           // 0.1–1.0, controls pin/drawing transparency
  default_schema_id: null // optional: schema to auto-apply for new pins on this layer
}
```

### State

- `state.layers: Layer[]` — layers for the current set, loaded from DB on `switchSet()`
- `state.activeLayerId: string | null` — which layer new pins land on. Set in Layers modal by clicking a layer name (●). Shown in tab bar as `→ LayerName`.

### Visibility and opacity

- **Visible layers**: pins/drawings display at their layer's opacity
- **Hidden layers**: pins/drawings have 0 opacity (not removed, just invisible)
- **Active layer**: pins render at full opacity regardless of slider (always the dominant visual layer)
- Non-active visible layers render at `opacity × 1.0` (the slider is absolute, not multiplied)

### Active layer

The active layer is the editing target:
- New pins default to the active layer in the pin form dropdown
- If the active layer has a `default_schema_id`, the pin form auto-populates that schema's custom fields
- Changing the pin form's layer dropdown syncs the schema dropdown to the new layer's default
- Active layer indicator appears in the tab bar: `→ LayerName` in the layer's color

### API (map.js)

| Function | Purpose |
|---|---|
| `loadLayersForSet(teamId)` | Load layers from DB, auto-create default layer if none exist |
| `createLayer(name)` | Create new layer, auto-assign color from palette |
| `renameLayer(layerId, name)` | Rename a layer |
| `deleteLayer(layerId)` | Delete layer, reassign all its pins to first remaining layer |
| `toggleLayer(layerId)` | Toggle visibility |
| `setLayerOpacity(layerId, value)` | Change opacity, apply to all markers/drawings immediately |

---

## Schemas

Schemas define **custom typed fields for pins**. They are global — created once, reusable across any map. When a schema is bound to a layer's `default_schema_id`, new pins on that layer show the schema's custom form.

### Data model

**Schema object** (stored in `schemas` IndexedDB store, keyed by `schema_id`):
```js
{
  schema_id: "uuid",       // unique identifier
  name: "Bird Sighting",   // display name
  fields: [
    { key: "species", label: "Species", type: "text" },
    { key: "count", label: "Count", type: "number" },
    { key: "behavior", label: "Behavior", type: "choice", options: ["Flying","Perched","Nesting"] },
    { key: "seen_at", label: "Seen At", type: "time" }
  ]
}
```

Schemas are **global** — not scoped to any map. `getSchemas()` returns all schemas. `saveSchema()` persists globally. `deleteTeam()` does NOT delete schemas. Schemas travel with exports and sync between peers.

### Custom data storage

Pin custom data is stored as an encrypted blob alongside the pin:

```
pins row:
  schema_id: "uuid"        // which schema was used
  custom_data: {            // encrypted with set's DEK
    ciphertext: "hex",
    nonce: "hex"
  }
```

The `custom_data` blob contains `{ species: "Bald Eagle", count: "3", behavior: "Flying" }` — a flat JSON object keyed by field keys. Title/note always exist as universal fallback regardless of schema.

### Field types

| Type | Renders as | Stored as |
|---|---|---|
| `text` | `<input type="text">` | string |
| `number` | `<input type="number">` | string |
| `choice` | `<select>` dropdown | string |
| `date` | `<input type="date">` | string (YYYY-MM-DD) |
| `time` | `<input type="time">` | string (HH:MM) |
| `boolean` | `<select>` true/false | string "true"/"false" |

### Dynamic pin form

When a pin is placed on a layer with a schema:
1. The pin form renders the schema's fields between the layer dropdown and the media section
2. Each field renders as its type-specific HTML input
3. On save, field values are collected and stored in `custom_data`
4. In the pin popup, custom data is displayed as labeled field:value pairs

Title and note are **always present** — they are the universal fallback independent of schema.

### Schema editor

The schema manager (📋 button in tab bar) lists all global schemas. The editor supports:
- Field add/delete with ▲▼ reorder
- Type selection (text, number, choice, date, time, boolean)
- Choice options via comma-separated input
- Keys auto-generated from labels (e.g., "Species Name" → `species_name`)

### API (map.js)

| Function | Purpose |
|---|---|
| `loadSchemasForSet()` | Load all schemas into `state.schemas` (global, no filter) |
| `showSchemaManagerModal()` | List all schemas with edit/delete |
| `showSchemaEditorModal(schemaId?)` | Create or edit a schema with fields |
| `renderSchemaFieldsById(schemaId, containerId, existingData?)` | Render form fields for a schema |
| `collectSchemaData(containerId)` | Read form values back into flat object |
| `buildCustomDataHTML(pinData, customDataEnc, layerId, layerName, pinSchemaId)` | Render custom data in popup |

### State

- `state.schemas: Schema[]` — all schemas in the global pool, loaded once

---

## Import from Map

Copies all pins and drawings from a source map's layer into a target layer in the current map.

### Flow

1. Open Layers (📑) → click 📥 Import
2. Select a source map from the dropdown
3. Source map's layers appear with pin/drawing counts
4. Click a source layer to select it
5. Select a target layer in the current map
6. Click Import Layer

### What it does

- Decrypts source data with the source map's DEK
- Re-encrypts with the current map's DEK
- Assigns new `pin_id`/`drawing_id` (UUIDs)
- Assigns the target `layer_id`
- Inherits the target layer's `default_schema_id` (if set)
- Copies media (decrypted with source DEK, re-encrypted with target DEK)
- Imports any referenced schemas not yet in the global pool
- Shows progress feedback for imports with 20+ items
- Reports skipped items in the toast

### API (map.js)

| Function | Purpose |
|---|---|
| `importLayerFromMap(sourceTeamId, sourceLayerId, targetLayerId, sourceSchemas)` | Execute import |
| `showImportFromMapModal()` | Show the import UI |

---

## Export / Import

The `.piggpin` export format includes:
- `keys` — public/secret keys and wrapped DEK
- `layers` — all layers with their config (colors, opacity, schema bindings)
- `schemas` — all schemas referenced by the map's pins
- `pins` — all pins with `layer_id`, `schema_id`, `custom_data`, and media
- `drawings` — all drawings with `layer_id`, `schema_id`, `custom_data`, and media

On import, layers and pins are recreated. Schemas are merged into the global pool (duplicates skipped by `schema_id`).

---

## Database Schema (v7)

| Store | Key | Indexes | Purpose |
|---|---|---|---|
| `pins` | `pin_id` | `team_id`, `layer_id` | Encrypted pins with layer/schema metadata |
| `drawings` | `drawing_id` | `team_id`, `layer_id` | Encrypted GeoJSON with layer/schema metadata |
| `teams` | `team_id` | — | Map encryption keys |
| `layers` | `team_id` | — | Per-map layer definitions |
| `schemas` | `schema_id` | — | Global schema definitions |
| `settings` | `team_id` | — | Per-map settings (viewport, slide order) |
| `profile` | `"me"` | — | User identity |
| `known_peers` | `user_id` | — | Remembered peers |

---

## Seven axes of deeper asymmetry (roadmap)

1. **Palimpsest Cartography** — Contradictory maps on the same ground ✅ (layers)
2. **Temporal Cartography** — The map as time machine (upcoming)
3. **Counter-Cartography** — Mapping what power wants unmapped (upcoming)
4. **Trust Webs** — Validation by community, not corporation (upcoming)
5. **Federated Ontologies** — Every community defines its own schema ✅ (schemas)
6. **The Map as Physical Artifact** — Beyond the screen, into mesh radio (partial — Meshtastic/RNode/Reticulum)
7. **Narrative Cartography** — Stories, not facts (upcoming)
