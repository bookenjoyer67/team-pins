import L from "leaflet";

let _poiLayerGroup = null;
let _poiEnabled = false;
let _poiQueryTimer = null;
let _activeCategories = new Set(["food_drink", "health", "services", "outdoor", "transport"]);
let _map = null;

const CATEGORIES = [
  { id: "food_drink", label: "Food & Drink", icon: "\u{1F37D}", query: 'node[amenity~"restaurant|cafe|fast_food|pub|bar|biergarten"]({bbox});' },
  { id: "health", label: "Health", icon: "\u{1F3E5}", query: 'node[amenity~"hospital|pharmacy|clinic|doctors|dentist|veterinary"]({bbox});' },
  { id: "services", label: "Services", icon: "\u{1F3E7}", query: 'node[amenity~"atm|bank|post_office|fuel|charging_station"]({bbox});' },
  { id: "outdoor", label: "Outdoor", icon: "\u{1F6B0}", query: 'node[amenity~"drinking_water|toilets|shelter|bench|waste_basket"]({bbox});' },
  { id: "transport", label: "Transport", icon: "\u{1F687}", query: 'node[railway~"station|subway_entrance|tram_stop|halt"]({bbox});node[amenity~"bus_station|parking|bicycle_parking|ferry_terminal"]({bbox});' },
  { id: "shopping", label: "Shopping", icon: "\u{1F6D2}", query: 'node[shop~"supermarket|convenience|bakery|mall|department_store|chemist"]({bbox});' },
  { id: "attractions", label: "Attractions", icon: "\u{1F3DB}", query: 'node[tourism~"attraction|museum|viewpoint|picnic_site|camp_site|hotel|hostel|guest_house|zoo"]({bbox});' },
];

const POI_ICONS = {
  restaurant: "\u{1F37D}", cafe: "\u2615", fast_food: "\u{1F354}", pub: "\u{1F37A}", bar: "\u{1F378}", biergarten: "\u{1F37B}",
  hospital: "\u{1F3E5}", pharmacy: "\u{1F48A}", clinic: "\u{1F3E5}", doctors: "\u{1FA7A}", dentist: "\u{1F9B7}", veterinary: "\u{1F43E}",
  atm: "\u{1F3E7}", bank: "\u{1F3E6}", post_office: "\u{1F4EE}", fuel: "\u26FD", charging_station: "\u{1F50C}",
  drinking_water: "\u{1F6B0}", toilets: "\u{1F6BD}", shelter: "\u{1F3D5}", bench: "\u{1FA91}",
  station: "\u{1F682}", subway_entrance: "\u{1F687}", tram_stop: "\u{1F68A}", bus_station: "\u{1F68C}", parking: "\u{1F17F}\uFE0F", bicycle_parking: "\u{1F6B2}", ferry_terminal: "\u26F4",
  supermarket: "\u{1F6D2}", convenience: "\u{1F3EA}", bakery: "\u{1F950}", mall: "\u{1F3EC}",
  attraction: "\u{1F3A1}", museum: "\u{1F3DB}", viewpoint: "\u{1F52D}", picnic_site: "\u{1FAD6}", camp_site: "\u26F0", hotel: "\u{1F3E8}", hostel: "\u{1F6CD}", guest_house: "\u{1F3E0}", zoo: "\u{1F981}",
};

function getPOIIcon(tags) {
  if (!tags) return "\u{1F4CD}";
  const keys = ["amenity", "shop", "tourism", "railway"];
  for (const key of keys) {
    if (tags[key] && POI_ICONS[tags[key]]) return POI_ICONS[tags[key]];
  }
  return "\u{1F4CD}";
}

export function initPOILayer(map) {
  _map = map;
  _poiLayerGroup = L.markerClusterGroup({
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: false,
    disableClusteringAtZoom: 18,
    chunkedLoading: true,
  });

  return _poiLayerGroup;
}

export function togglePOIEnabled() {
  _poiEnabled = !_poiEnabled;
  return _poiEnabled;
}

export function isPOIEnabled() { return _poiEnabled; }

export function setActiveCategories(cats) {
  _activeCategories = new Set(cats);
  if (_poiEnabled) queryPOIs();
}

export function getActiveCategories() { return new Set(_activeCategories); }

export function getCategories() { return CATEGORIES; }

export async function queryPOIs() {
  if (!_poiEnabled || !_poiLayerGroup || !_poiLayerGroup._map) return;
  const map = _poiLayerGroup._map;
  if (!map) return;

  if (_activeCategories.size === 0) {
    _poiLayerGroup.clearLayers();
    return;
  }

  console.log("[poi] Querying categories:", [..._activeCategories]);

  const bounds = map.getBounds();
  if (!bounds.isValid()) return;
  if (map.getZoom() < 10) {
    _poiLayerGroup.clearLayers();
    return;
  }

  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;

  const parts = [];
  for (const cat of CATEGORIES) {
    if (_activeCategories.has(cat.id)) parts.push(cat.query.replace(/\{bbox\}/g, bbox));
  }
  if (parts.length === 0) return;

  const query = `[out:json][timeout:15];(${parts.join("")});out center 200;`;

  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "User-Agent": "piggPin/0.0.1" },
      body: query,
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data.elements) return;

    _poiLayerGroup.clearLayers();

    for (const el of data.elements) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;

      const tags = el.tags || {};
      const name = tags.name || tags.amenity || tags.shop || tags.tourism || tags.railway || "?";
      const icon = getPOIIcon(tags);

      const marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: "poi-marker",
          html: `<div style="font-size:16px;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:12px;background:rgba(255,255,255,0.85);box-shadow:0 1px 3px rgba(0,0,0,0.2);">${icon}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        zIndexOffset: -200,
        interactive: true,
      });
      marker.bindTooltip(name, { direction: "top", offset: [0, -14], opacity: 0.9 });
      _poiLayerGroup.addLayer(marker);
    }
  } catch (e) { console.warn("[poi] Overpass query failed:", e.message); }
}

export function schedulePOIQuery(map) {
  if (_poiQueryTimer) clearTimeout(_poiQueryTimer);
  _poiQueryTimer = setTimeout(() => queryPOIs(), 2000);
}

export function clearPOIQueryTimer() {
  if (_poiQueryTimer) { clearTimeout(_poiQueryTimer); _poiQueryTimer = null; }
}

export function showPOICategoryModal() {
  const existing = document.getElementById("poi-cat-modal");
  if (existing) { existing.remove(); return; }

  const ov = document.createElement("div");
  ov.id = "poi-cat-modal";
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
  const items = CATEGORIES.map(c => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:13px;">
      <input type="checkbox" value="${c.id}" ${_activeCategories.has(c.id) ? "checked" : ""} />
      <span>${c.icon}</span> <span>${c.label}</span>
    </label>
  `).join("");

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:280px;max-width:320px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 8px;font-size:14px;">POI Categories</h3>
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;margin-bottom:4px;font-size:13px;font-weight:600;cursor:pointer;">
      <input type="checkbox" id="poi-enable" ${_poiEnabled ? "checked" : ""} /> Enable OSM POI
    </label>
    <hr style="margin:4px 0 8px;border-color:var(--border);">
    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <button id="poi-cat-all" style="flex:1;padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:4px;cursor:pointer;font-size:11px;">Select All</button>
      <button id="poi-cat-none" style="flex:1;padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:4px;cursor:pointer;font-size:11px;">Clear All</button>
    </div>
    <div style="max-height:280px;overflow-y:auto;margin-bottom:8px;">
      ${items}
    </div>
    <button id="poi-cat-close" style="display:block;width:100%;padding:7px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;">Done</button>
  </div>`;
  document.body.appendChild(ov);

  const clean = () => ov.remove();
  ov.onclick = (e) => { if (e.target === ov) clean(); };
  document.getElementById("poi-enable").onchange = () => {
    if (_poiEnabled) {
      togglePOIEnabled();
      _poiLayerGroup.clearLayers();
      _map.removeLayer(_poiLayerGroup);
    } else {
      togglePOIEnabled();
      _map.addLayer(_poiLayerGroup);
      if (_activeCategories.size > 0) queryPOIs();
    }
  };
  document.getElementById("poi-cat-close").onclick = () => {
    const checks = ov.querySelectorAll("input[type=\"checkbox\"]:not(#poi-enable)");
    const cats = new Set();
    checks.forEach(c => { if (c.checked) cats.add(c.value); });
    setActiveCategories(cats);
    clean();
  };
  document.getElementById("poi-cat-all").onclick = () => {
    ov.querySelectorAll("input[type=\"checkbox\"]:not(#poi-enable)").forEach(c => c.checked = true);
  };
  document.getElementById("poi-cat-none").onclick = () => {
    ov.querySelectorAll("input[type=\"checkbox\"]:not(#poi-enable)").forEach(c => c.checked = false);
  };
}
