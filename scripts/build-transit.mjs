#!/usr/bin/env node
// piggpin transit map builder
//
// Downloads a GTFS static feed and produces a .piggpin file with
// all routes, stops, schedules, route drawings, bidirectional
// chains with forks, and transit hub convergence chains.
//
// Usage:
//   node scripts/build-transit.mjs [gtfs-url] [output-path] [map-name] [map-desc]
//
// Examples:
//   node scripts/build-transit.mjs \\
//     "https://example.com/gtfs.zip" \\
//     "my-city.piggpin" \\
//     "My City Transit" \\
//     "Bus routes and schedules for My City" \\
//     38.6270 -90.1994
//
// Then drag the resulting .piggpin file into piggPin to import.
//
// Requirements: Node.js 18+ (uses built-in fetch, zlib, fs).
// Zero external dependencies beyond piggPin's bundled WASM.
//
// Output (varies by feed size):
//   Stop pins with departure schedules (weekday/Sat/Sun array_time)
//   Route drawings as colored LineString polylines
//   Route chains with Inbound/Outbound direction forks
//   Transit hub convergence chains at major transfer points
//   Layers per route + shared stops layer
//   "Bus Stop" schema with typed fields

import { readFileSync, writeFileSync } from "fs";
import { inflateRawSync } from "zlib";

import * as wasmMod from "../core/pkg/e2e_core.js";

const {
  generate_dek, generate_uuid, generate_user_keypair, wrap_dek,
  encrypt_pin_data, encrypt_geojson, encrypt_raw_bytes, encode_hex,
  compact_and_pack_json, compress_gzip,
} = wasmMod;

const GTFS_URL = process.argv[2];
const OUTPUT   = process.argv[3];
const MAP_NAME = process.argv[4];
const MAP_DESC = process.argv[5];
const MAP_LAT  = parseFloat(process.argv[6]);
const MAP_LNG  = parseFloat(process.argv[7]);

const usage = `Usage: node scripts/build-transit.mjs <gtfs-url> <output-path> <map-name> <map-desc> <center-lat> <center-lng>

Example:
  node scripts/build-transit.mjs \\
    "https://example.com/gtfs.zip" \\
    "my-city.piggpin" \\
    "My City Transit" \\
    "Bus routes and schedules for My City" \\
    38.6270 -90.1994

Then drag the resulting .piggpin file into piggPin to import.`;

if (!GTFS_URL || !OUTPUT || !MAP_NAME || isNaN(MAP_LAT) || isNaN(MAP_LNG)) {
  console.error(usage);
  process.exit(1);
}

const PALETTE = ["#2563eb","#ef4444","#16a34a","#f97316","#eab308","#7c3aed","#ec4899","#0891b2"];
const STOP_EMOJI = "\u{1F68F}";
const MAP_CENTER = { lat: MAP_LAT, lng: MAP_LNG };

// ─── ZIP parser ────────────────────────────────────────────

function parseZip(buf) {
  const view = new DataView(buf);
  const len = buf.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("No EOCD found");
  const cdOffset = view.getUint32(eocd + 16, true);
  const total = view.getUint16(eocd + 10, true);
  let pos = cdOffset;
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOff = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, pos + 46, nameLen));
    entries.push({ name, method, compSize, localOff });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  const files = {};
  for (const e of entries) {
    const fn = e.name.split("/").pop();
    if (!fn || !fn.endsWith(".txt")) continue;
    let lp = e.localOff;
    if (view.getUint32(lp, true) !== 0x04034b50) continue;
    const lnLen = view.getUint16(lp + 26, true);
    const leLen = view.getUint16(lp + 28, true);
    const dataOff = lp + 30 + lnLen + leLen;
    const raw = new Uint8Array(buf, dataOff, e.compSize);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = inflateRawSync(raw);
    else continue;
    files[fn] = new TextDecoder().decode(data);
  }
  return files;
}

// ─── CSV parser ────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"(.*)"$/s, "$1"));
  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line.trim()) continue;
    const obj = {};
    let i = 0, fi = 0;
    while (i < line.length && fi < headers.length) {
      let val;
      if (line[i] === "\"") {
        const end = line.indexOf("\"", i + 1);
        if (end === -1) { val = line.slice(i + 1); i = line.length; }
        else { val = line.slice(i + 1, end); i = end + 1; }
        if (line[i] === ",") i++;
      } else {
        const end = line.indexOf(",", i);
        if (end === -1) { val = line.slice(i); i = line.length; }
        else { val = line.slice(i, end); i = end + 1; }
      }
      obj[headers[fi]] = val;
      fi++;
    }
    rows.push(obj);
  }
  return rows;
}

// ─── Helpers ───────────────────────────────────────────────

function parseTime(t) {
  if (!t) return null;
  const parts = t.split(":");
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function fmtTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log("Downloading GTFS data...");
  const resp = await fetch(GTFS_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const zipBuf = Buffer.from(await resp.arrayBuffer()).buffer;
  const files = parseZip(zipBuf);
  for (const fn of ["routes.txt","stops.txt","shapes.txt","trips.txt","stop_times.txt","calendar.txt"]) {
    if (!files[fn]) throw new Error(`Missing ${fn}`);
  }
  console.log(`Parsed ${Object.keys(files).length} files`);

  const routes    = parseCSV(files["routes.txt"]);
  const stops     = parseCSV(files["stops.txt"]);
  const shapes    = parseCSV(files["shapes.txt"]);
  const trips     = parseCSV(files["trips.txt"]);
  const stopTimes = parseCSV(files["stop_times.txt"]);
  const calendar  = parseCSV(files["calendar.txt"]);

  console.log(`Routes: ${routes.length}, Stops: ${stops.length}, Trips: ${trips.length}, StopTimes: ${stopTimes.length}, Shapes: ${shapes.length}, Calendars: ${calendar.length}`);

  // Init WASM
  console.log("Initializing crypto...");
  const wasmPath = new URL("../core/pkg/e2e_core_bg.wasm", import.meta.url);
  wasmMod.initSync({ module: readFileSync(wasmPath) });

  // Generate keys
  const dek = generate_dek();
  const communityKp = generate_user_keypair();
  const memberKp = generate_user_keypair();
  const publicKey = encode_hex(communityKp.public);
  const secretKey = encode_hex(memberKp.secret);
  const wrappedDek = wrap_dek(dek, encode_hex(memberKp.public));

  // ─── Build indexes ───────────────────────────────────────

  console.log("Building indexes...");
  const tripsById = {};
  for (const t of trips) tripsById[t.trip_id] = t;

  const calendarByService = {};
  for (const c of calendar) calendarByService[c.service_id] = c;

  const stopTimesByStop = {};
  const stopTimesByTrip = {};
  for (const st of stopTimes) {
    if (!stopTimesByStop[st.stop_id]) stopTimesByStop[st.stop_id] = [];
    stopTimesByStop[st.stop_id].push(st);
    if (!stopTimesByTrip[st.trip_id]) stopTimesByTrip[st.trip_id] = [];
    stopTimesByTrip[st.trip_id].push(st);
  }
  for (const tid of Object.keys(stopTimesByTrip)) {
    stopTimesByTrip[tid].sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
  }

  const shapePointsById = {};
  for (const s of shapes) {
    if (!shapePointsById[s.shape_id]) shapePointsById[s.shape_id] = [];
    shapePointsById[s.shape_id].push(s);
  }
  for (const sid of Object.keys(shapePointsById)) {
    shapePointsById[sid].sort((a, b) => parseInt(a.shape_pt_sequence, 10) - parseInt(b.shape_pt_sequence, 10));
  }

  const tripsByRoute = {};
  for (const t of trips) {
    if (!tripsByRoute[t.route_id]) tripsByRoute[t.route_id] = [];
    tripsByRoute[t.route_id].push(t);
  }

  const shapeRoute = {};
  for (const t of trips) {
    if (t.shape_id && !shapeRoute[t.shape_id]) shapeRoute[t.shape_id] = t.route_id;
  }

  // ─── Build Schemas ───────────────────────────────────────

  const busStopSchemaId = generate_uuid();
  const schemas = [{
    schema_id: busStopSchemaId,
    name: "Bus Stop",
    fields: [
      { key: "stop_code", label: "Stop Code", type: "text" },
      { key: "routes_served", label: "Routes", type: "text" },
      { key: "direction", label: "Direction", type: "choice", options: ["Northbound","Southbound","Eastbound","Westbound"] },
      { key: "dep_weekday", label: "Weekday", type: "array_time" },
      { key: "dep_saturday", label: "Saturday", type: "array_time" },
      { key: "dep_sunday", label: "Sunday", type: "array_time" },
    ],
    community_id: null,
  }];

  // ─── Build Layers ────────────────────────────────────────

  const routeLayers = routes.map((r, i) => ({
    layer_id: generate_uuid(),
    name: [r.route_short_name, r.route_long_name].filter(Boolean).join(" ") || r.route_id,
    color: PALETTE[i % PALETTE.length],
    visible: true,
    opacity: 1.0,
  }));
  const routeLayerMap = {};
  routes.forEach((r, i) => { routeLayerMap[r.route_id] = routeLayers[i]; });

  const stopsLayerId = generate_uuid();
  const layers = [
    ...routeLayers,
    {
      layer_id: stopsLayerId,
      name: "MetroBus Stops",
      color: "#6b7280",
      visible: true,
      opacity: 1.0,
      default_schema_id: busStopSchemaId,
    },
  ];

  // ─── Build Stop Pins ─────────────────────────────────────

  console.log("Building stop pins...");
  const stopPinMap = {};
  const allPins = [];

  const stopRoutes = {};
  for (const st of stopTimes) {
    const trip = tripsById[st.trip_id];
    if (!trip) continue;
    if (!stopRoutes[st.stop_id]) stopRoutes[st.stop_id] = new Set();
    stopRoutes[st.stop_id].add(trip.route_id);
  }

  for (const stop of stops) {
    const pinId = generate_uuid();
    stopPinMap[stop.stop_id] = pinId;

    const servingRoutes = stopRoutes[stop.stop_id] || new Set();
    const routeNames = [...servingRoutes]
      .map(rid => routeLayerMap[rid]?.name || rid)
      .join(", ");

    const dayDeps = { weekday: new Set(), saturday: new Set(), sunday: new Set() };
    const stEntries = stopTimesByStop[stop.stop_id] || [];
    for (const st of stEntries) {
      const trip = tripsById[st.trip_id];
      if (!trip) continue;
      const cal = calendarByService[trip.service_id];
      if (!cal) continue;
      const mins = parseTime(st.departure_time);
      if (mins === null) continue;
      const timeStr = fmtTime(mins);
      if (cal.monday === "1" && cal.tuesday === "1" && cal.wednesday === "1" && cal.thursday === "1" && cal.friday === "1") {
        dayDeps.weekday.add(timeStr);
      }
      if (cal.saturday === "1") dayDeps.saturday.add(timeStr);
      if (cal.sunday === "1") dayDeps.sunday.add(timeStr);
    }

    const sortTimes = (s) => [...s].map(t => parseTime(t)).filter(n => n !== null).sort((a,b) => a - b).map(fmtTime);
    const depWeekday = sortTimes(dayDeps.weekday).slice(0, 100);
    const depSaturday = sortTimes(dayDeps.saturday).slice(0, 100);
    const depSunday = sortTimes(dayDeps.sunday).slice(0, 100);

    const primaryRoute = [...servingRoutes][0];
    const primaryColor = primaryRoute ? routeLayerMap[primaryRoute]?.color : "#6b7280";

    const enc = encrypt_pin_data(
      stop.stop_name,
      routeNames ? `Routes: ${routeNames}` : "",
      parseFloat(stop.stop_lat),
      parseFloat(stop.stop_lon),
      primaryColor,
      dek,
    );

    const customData = {};
    if (stop.stop_code) customData.stop_code = stop.stop_code;
    customData.routes_served = routeNames;
    if (stop.stop_desc) customData.description = stop.stop_desc;
    const dirMap = { "0": "Northbound", "1": "Southbound", "2": "Eastbound", "3": "Westbound" };
    const st0 = stEntries[0];
    if (st0) {
      const t0 = tripsById[st0.trip_id];
      if (t0 && t0.direction_id !== undefined) customData.direction = dirMap[t0.direction_id] || "";
    }
    customData.dep_weekday = depWeekday;
    customData.dep_saturday = depSaturday;
    customData.dep_sunday = depSunday;
    const cdEnc = encrypt_raw_bytes(new TextEncoder().encode(JSON.stringify(customData)), dek);

    allPins.push({
      pin_id: pinId,
      team_id: "PLACEHOLDER",
      layer_id: stopsLayerId,
      ciphertext: enc.ciphertext,
      nonce: enc.nonce,
      created_at: Date.now(),
      map_zoom: 13,
      schema_id: busStopSchemaId,
      emoji: STOP_EMOJI,
      custom_data: { ciphertext: cdEnc.ciphertext, nonce: cdEnc.nonce },
    });
  }
  console.log(`Created ${allPins.length} stop pins`);

  // ─── Build Drawings (route shapes) ───────────────────────

  console.log("Building route drawings...");
  const drawings = [];
  const processedShapes = new Set();

  for (const [shapeId, pts] of Object.entries(shapePointsById)) {
    if (processedShapes.has(shapeId) || pts.length < 2) continue;
    processedShapes.add(shapeId);
    const routeId = shapeRoute[shapeId];
    const layer = routeId ? routeLayerMap[routeId] : null;
    if (!layer) continue;

    const coords = pts.map(p => [parseFloat(p.shape_pt_lon), parseFloat(p.shape_pt_lat)]);
    const geojson = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: { title: layer.name, color: layer.color, arrow: false },
    };
    const dEnc = encrypt_geojson(JSON.stringify(geojson), dek);

    drawings.push({
      drawing_id: generate_uuid(),
      team_id: "PLACEHOLDER",
      layer_id: layer.layer_id,
      encrypted_geojson: dEnc.ciphertext,
      nonce: dEnc.nonce,
    });
  }
  console.log(`Created ${drawings.length} route drawings`);

  // ─── Build Chains ────────────────────────────────────────

  console.log("Building chains...");
  const chains = [];
  const dirLabel = { "0": "Outbound", "1": "Inbound" };

  for (const [routeId, routeTrips] of Object.entries(tripsByRoute)) {
    const layer = routeLayerMap[routeId];
    if (!layer) continue;

    // Split trips by direction
    const tripsByDir = {};
    for (const t of routeTrips) {
      const d = t.direction_id != null ? String(t.direction_id) : "0";
      if (!tripsByDir[d]) tripsByDir[d] = [];
      tripsByDir[d].push(t);
    }
    const dirs = Object.keys(tripsByDir);

    // Find longest trip per direction
    const bestTrips = {};
    for (const d of dirs) {
      let best = null, bestCount = 0;
      for (const t of tripsByDir[d]) {
        const sts = stopTimesByTrip[t.trip_id] || [];
        if (sts.length > bestCount) { bestCount = sts.length; best = t; }
      }
      if (best && bestCount >= 2) bestTrips[d] = { trip: best, count: bestCount };
    }

    if (Object.keys(bestTrips).length === 0) continue;

    // Build per-direction entry data
    const dirNames = Object.keys(bestTrips);
    const dirEntries = {};
    const dirFirstStop = {};
    const dirLastStop = {};

    for (const d of dirNames) {
      const sts = stopTimesByTrip[bestTrips[d].trip.trip_id] || [];
      const entries = [];
      for (let i = 0; i < sts.length; i++) {
        const st = sts[i];
        const pinId = stopPinMap[st.stop_id];
        if (!pinId) continue;
        const stopObj = stops.find(s => s.stop_id === st.stop_id);
        const stopName = stopObj ? stopObj.stop_name : st.stop_id;
        const depTime = parseTime(st.departure_time);
        const timeLabel = depTime !== null ? fmtTime(depTime) : "";
        entries.push({
          pin_id: pinId,
          narrative: `${stopName}${timeLabel ? " \u00b7 " + timeLabel : ""}`,
          idx: i,
        });
      }
      if (entries.length >= 2) {
        dirEntries[d] = entries;
        dirFirstStop[d] = entries[0].pin_id;
        dirLastStop[d] = entries[entries.length - 1].pin_id;
      }
    }

    // Build flat pin_entries list
    const pinEntries = [];
    const dirStartIdx = {}; // dir → first entry index in pinEntries
    const dirEndIdx = {};   // dir → last entry index in pinEntries

    for (const d of dirNames) {
      const entries = dirEntries[d];
      if (!entries) continue;
      dirStartIdx[d] = pinEntries.length;
      for (const e of entries) {
        pinEntries.push({
          pin_id: e.pin_id,
          narrative: `${dirLabel[d] || d} stop ${e.idx + 1}: ${e.narrative}`,
          audio_ciphertext: null,
          audio_nonce: null,
          audio_type: null,
          branches: [],
        });
      }
      dirEndIdx[d] = pinEntries.length - 1;
    }

    // For multi-direction routes: add forks at direction transition points
    if (dirNames.length >= 2) {
      for (let di = 0; di < dirNames.length; di++) {
        const d = dirNames[di];
        const nextD = dirNames[(di + 1) % dirNames.length];
        const fromIdx = dirEndIdx[d];
        const toPin = dirFirstStop[nextD];
        if (fromIdx >= 0 && toPin && pinEntries[fromIdx]) {
          pinEntries[fromIdx].branches.push({
            label: dirLabel[nextD] || nextD,
            next_pin_id: toPin,
          });
        }
      }
    }

    if (pinEntries.length < 2) continue;

    const dirCounts = dirNames.map(d => `${dirLabel[d] || d}: ${bestTrips[d].count} stops`).join(", ");
    chains.push({
      chain_id: generate_uuid(),
      community_id: "PLACEHOLDER",
      name: layer.name,
      description: `${layer.name} — ${dirCounts}`,
      cover_pin_id: pinEntries[0]?.pin_id || null,
      author_pubkey: "",
      author_display_name: "",
      tags: [(layer.name.includes("MetroLink") ? "metrolink" : "bus"), layer.name.replace(/\s+/g, "-").toLowerCase()],
      pin_entries: pinEntries,
      pin_ids: pinEntries.map(e => e.pin_id),
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }

  // ─── Build Transit Center Convergence Chains ──────────────

  console.log("Building convergence chains...");
  // Identify major transit centers (stops with many serving routes)
  const hubThreshold = 6;
  for (const [stopId, routeSet] of Object.entries(stopRoutes)) {
    if (routeSet.size < hubThreshold) continue;
    const hubPinId = stopPinMap[stopId];
    if (!hubPinId) continue;
    const hubStop = stops.find(s => s.stop_id === stopId);
    const hubName = hubStop ? hubStop.stop_name : stopId;
    const hubRoutes = [...routeSet].map(rid => routeLayerMap[rid]?.name).filter(Boolean).sort();

    const hubEntries = [{
      pin_id: hubPinId,
      narrative: `Hub: ${hubName}`,
      audio_ciphertext: null,
      audio_nonce: null,
      audio_type: null,
      branches: [],
    }];

    for (const routeName of hubRoutes.slice(0, 12)) {
      const routeChain = chains.find(c => c.name === routeName);
      if (!routeChain) continue;
      // Find the hub stop's entry within this route chain
      const hubEntry = routeChain.pin_entries.find(e => e.pin_id === hubPinId);
      const targetPin = hubEntry ? hubEntry.pin_id : routeChain.pin_entries[0]?.pin_id;
      if (targetPin) {
        hubEntries[0].branches.push({
          label: routeName,
          next_pin_id: targetPin,
        });
      }
    }

    if (hubEntries[0].branches.length >= 2) {
      chains.push({
        chain_id: generate_uuid(),
        community_id: "PLACEHOLDER",
        name: `\u{1F3E2} ${hubName}`,
        description: `Transit hub serving ${hubRoutes.length} routes: ${hubRoutes.slice(0, 8).join(", ")}...`,
        cover_pin_id: hubPinId || null,
        author_pubkey: "",
        author_display_name: "",
        tags: ["hub", "transit-center"],
        pin_entries: hubEntries,
        pin_ids: hubEntries.map(e => e.pin_id),
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }
  }

  console.log(`Created ${chains.length} chains`);

  // ─── Assemble .piggpin ───────────────────────────────────

  console.log("Assembling .piggpin...");
  const data = {
    name: MAP_NAME,
    keys: {
      public_key: publicKey,
      secret_key: secretKey,
      wrapped_dek: wrappedDek,
      key_derivation: "random",
    },
    map_center: MAP_CENTER,
    map_zoom: 13,
    layers,
    schemas,
    community: {
      name: MAP_NAME,
      description: MAP_DESC || MAP_NAME,
      governance: {},
      bounds: null,
      relay_nodes: [],
    },
    pins: allPins,
    drawings,
    chains,
  };

  const json = compact_and_pack_json(JSON.stringify(data));
  const gzipped = compress_gzip(new TextEncoder().encode(json));
  writeFileSync(OUTPUT, gzipped);
  console.log(`\nDone! Wrote ${OUTPUT} (${(gzipped.length / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  ${allPins.length} stops, ${drawings.length} drawings, ${chains.length} chains, ${layers.length} layers`);
}

main().catch(e => { console.error("Error:", e.message || e); process.exit(1); });
