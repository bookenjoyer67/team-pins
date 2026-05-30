// Test setup: load WASM and mock browser APIs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "fake-indexeddb/auto";

// Mock localStorage for jsdom (Node 22+ may not have it)
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(String(k)) ?? null,
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
}

// Load the WASM module synchronously
const wasmPath = resolve(import.meta.dirname, "../dist/assets/e2e_core_bg-B1xls2O6.wasm");
const wasmBuffer = readFileSync(wasmPath);

// Initialize the WASM module
const { initSync } = await import("../core/pkg/e2e_core.js");
initSync({ module: wasmBuffer });

// Mock browser APIs that don't exist in jsdom
if (!globalThis.navigator.storage?.estimate) {
  Object.defineProperty(globalThis.navigator, "storage", {
    value: { estimate: async () => ({ quota: 1e9, usage: 0 }) },
    configurable: true,
    writable: true,
  });
}

if (!globalThis.navigator.vibrate) {
  globalThis.navigator.vibrate = () => {};
}

// Mock Leaflet (browser-specfic map library)
const L = {
  map: () => L,
  tileLayer: () => L,
  icon: () => L,
  divIcon: () => L,
  marker: () => ({ addTo: () => {}, bindPopup: () => {}, setLatLng: () => {}, on: () => {}, setIcon: () => {}, getLatLng: () => ({ lat: 0, lng: 0 }), _icon: {} }),
  geoJSON: () => ({ addTo: () => {}, getBounds: () => L }),
  markerClusterGroup: () => ({ addLayer: () => {}, clearLayers: () => {} }),
  latLng: (a, b) => ({ lat: a, lng: b }),
  featureGroup: () => ({ addTo: () => {}, eachLayer: () => {}, clearLayers: () => {} }),
  layerGroup: () => ({ addTo: () => {}, clearLayers: () => {} }),
  circle: () => ({ addTo: () => {} }),
  polygon: () => ({ addTo: () => {} }),
  polyline: () => ({ addTo: () => {} }),
  rectangle: () => ({ addTo: () => {} }),
  control: { layers: () => ({ addTo: () => {} }), zoom: () => ({ addTo: () => {} }) },
  DomEvent: { on: () => {}, off: () => {}, stopPropagation: () => {}, preventDefault: () => {} },
  DomUtil: { get: () => {}, create: () => {}, addClass: () => {}, removeClass: () => {} },
  Browser: { mobile: false, touch: false, ie: false, edge: false },
  CRS: { EPSG3857: { code: "EPSG:3857" }, EPSG4326: { code: "EPSG:4326" } },
  LatLngBounds: function() { return { extend: () => {}, isValid: () => true, getCenter: () => ({ lat: 0, lng: 0 }) }; },
  Point: function(x, y) { return { x, y }; },
};
globalThis.L = L;
