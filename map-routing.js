import L from "leaflet";
import { state } from "./state.js";
import { toast, escapeHtml } from "./dialogs.js";

let _routingActive = false;
let _waypoints = [];
let _routeData = null;
let _routesGroup = null;
let _waypointMarkers = [];
let _panel = null;
let _currentProfile = "car";
let _modeBadge = null;
let _escapeHandler = null;

const PROFILES = {
  car:  { path: "driving", icon: "\u{1F697}", label: "Car" },
  foot: { path: "walking", icon: "\u{1F6B6}", label: "Walk" },
  bike: { path: "cycling", icon: "\u{1F6B2}", label: "Bike" },
};

const MANEUVERS = {
  "depart":            "\u25B6",
  "arrive":            "\u{1F3C1}",
  "continue":          "\u2191",
  "turn-left":         "\u2190",
  "turn-right":        "\u2192",
  "turn-slight-left":  "\u2196",
  "turn-slight-right": "\u2197",
  "turn-sharp-left":   "\u21B0",
  "turn-sharp-right":  "\u21B1",
  "uturn-left":        "\u21BA",
  "uturn-right":       "\u21BB",
  "roundabout":        "\u{1F504}",
  "merge":             "\u21AA",
  "fork":              "\u23C2",
  "roundabout-turn":   "\u{1F504}",
  "end-of-road":       "\u25A0",
};

const ALT_COLORS = ["#7c3aed", "#f97316", "#16a34a"];

// ─── Config ─────────────────────────────────────────────────────────

export function getRoutingServerUrl() {
  return localStorage.getItem("pins-osrm-url") || "https://routing.openstreetmap.de/routed-car";
}

const PROFILE_INSTANCES = {
  car:  "routed-car",
  foot: "routed-foot",
  bike: "routed-bike",
};

function getRoutingUrlForProfile(profile) {
  const saved = localStorage.getItem("pins-osrm-url");
  const url = saved || "https://routing.openstreetmap.de/routed-car";
  const instance = PROFILE_INSTANCES[profile] || "routed-car";
  return url.replace(/\/routed-[a-z]+$/, `/${instance}`);
}

export function isRoutingActive() { return _routingActive; }

// ─── Toggle ─────────────────────────────────────────────────────────

export function toggleRouting() {
  if (_routingActive) {
    exitRoutingMode();
  } else {
    enterRoutingMode();
  }
}

// ─── Mode entry/exit ────────────────────────────────────────────────

function enterRoutingMode() {
  if (state.placingPin) {
    state.placingPin = false;
    const btn = state.map.getContainer().querySelector("button");
    if (btn) { btn.textContent = "\u{1F4CC}"; btn.style.background = "var(--accent,#2563eb)"; }
  }
  if (state.streetViewing) {
    state.streetViewing = false;
    const btn = state.map.getContainer().querySelector("button[title*=\"Street\" i]");
    if (btn) btn.style.background = "#059669";
  }
  _routingActive = true;
  _waypoints = [];
  _routeData = null;
  _currentProfile = localStorage.getItem("pins-routing-profile") || "car";
  state.map.getContainer().style.cursor = "crosshair";
  removeRouteLayer();
  removePanel();
  removeWaypointMarkers();
  updateModeBadge();
  if (!_escapeHandler) {
    _escapeHandler = (e) => {
      if (e.key === "Escape" && _routingActive) {
        clearRoute();
      }
    };
    document.addEventListener("keydown", _escapeHandler, true);
  }
}

function exitRoutingMode() {
  _routingActive = false;
  state.map.getContainer().style.cursor = "";
  _waypoints = [];
  _routeData = null;
  removeRouteLayer();
  removePanel();
  removeWaypointMarkers();
  updateModeBadge();
  if (_escapeHandler) {
    document.removeEventListener("keydown", _escapeHandler, true);
    _escapeHandler = null;
  }
}

export function clearRoute() {
  exitRoutingMode();
}

// ─── Mode badge ──────────────────────────────────────────────────────

function updateModeBadge() {
  if (!_routingActive) {
    if (_modeBadge) { _modeBadge.remove(); _modeBadge = null; }
    return;
  }

  if (!_modeBadge) {
    _modeBadge = document.createElement("div");
    _modeBadge.id = "routing-mode-badge";
    _modeBadge.style.cssText = "position:absolute;bottom:40px;left:50%;transform:translateX(-50%);z-index:1001;padding:6px 14px;background:var(--bg-glass);backdrop-filter:blur(4px);border:1px solid #2563eb;border-radius:20px;font-size:13px;color:var(--text);box-shadow:0 2px 8px rgba(0,0,0,0.15);white-space:nowrap;pointer-events:none;";
    state.map.getContainer().appendChild(_modeBadge);
  }

  if (_waypoints.length === 0) {
    _modeBadge.textContent = "\u{1F6E3} Click to set start point";
  } else if (_waypoints.length === 1) {
    _modeBadge.textContent = "\u{1F6E3} Start set \u2014 click destination";
  } else if (_routeData?.routes?.[0]) {
    const r = _routeData.routes[0];
    const dist = r.distance >= 1000 ? `${(r.distance/1000).toFixed(1)} km` : `${Math.round(r.distance)} m`;
    const time = r.duration >= 3600 ? `${Math.round(r.duration/3600)}h ${Math.round((r.duration%3600)/60)}min` : `${Math.round(r.duration/60)} min`;
    _modeBadge.textContent = `\u{1F6E3} ${dist} \u00b7 ${time} \u2022 ${_waypoints.length} waypoints \u2022 drag to adjust`;
  } else {
    _modeBadge.textContent = `\u{1F6E3} ${_waypoints.length} waypoints \u2022 drag to adjust`;
  }
}

// ─── Waypoint management ────────────────────────────────────────────

export function addWaypoint(lat, lng) {
  if (!_routingActive) return;
  if (!isFinite(lat) || !isFinite(lng)) return;
  _waypoints.push({ lat, lng, label: String.fromCharCode(65 + _waypoints.length) });
  renderWaypointMarkers();
  updateModeBadge();
  if (_waypoints.length >= 2) {
    fetchAndRenderRoute();
  }
}

export function routeToPin(lat, lng, title) {
  if (!_routingActive) enterRoutingMode();
  if (_waypoints.length === 0) {
    const center = state.map.getCenter();
    _waypoints.push({ lat: center.lat, lng: center.lng, label: "A" });
  }
  _waypoints.push({ lat, lng, label: String.fromCharCode(65 + _waypoints.length), pinTitle: title });
  renderWaypointMarkers();
  updateModeBadge();
  fetchAndRenderRoute();
}

// ─── Profile switching ──────────────────────────────────────────────

export function setRoutingProfile(profile) {
  if (!PROFILES[profile]) return;
  _currentProfile = profile;
  localStorage.setItem("pins-routing-profile", profile);
  if (_waypoints.length >= 2) fetchAndRenderRoute();
}

// ─── GPX Export ─────────────────────────────────────────────────────

export function exportRouteGPX() {
  if (!_routeData) return;
  const name = window._names?.[state.currentSet] || "Route";
  const coords = _routeData.geometry.coordinates;

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  gpx += `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  gpx += `<metadata><name>${escapeXml(name)}</name></metadata>\n`;
  gpx += `<trk><name>${escapeXml(name)}</name><trkseg>\n`;
  for (const [lng, lat] of coords) {
    gpx += `<trkpt lat="${lat}" lon="${lng}"><ele>0</ele></trkpt>\n`;
  }
  gpx += `</trkseg></trk></gpx>`;

  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^a-zA-Z0-9 _-]/g, "_") + "_route.gpx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Route exported as GPX", "#16a34a");
}

// ─── OSRM Client ────────────────────────────────────────────────────

async function fetchAndRenderRoute() {
  if (_waypoints.length < 2) return;

  const base = getRoutingUrlForProfile(_currentProfile).replace(/\/$/, "");
  const profilePath = PROFILES[_currentProfile]?.path || "driving";
  const coords = _waypoints.map(w => `${w.lng},${w.lat}`).join(";");
  const url = `${base}/route/v1/${profilePath}/${coords}?overview=full&geometries=geojson&steps=true&alternatives=3${localStorage.getItem("pins-routing-avoid-mw") === "1" ? "&exclude=motorway" : ""}`;

  if (_waypoints.some(w => !isFinite(w.lat) || !isFinite(w.lng))) {
    console.warn("[routing] skipping — invalid waypoint coordinates");
    return;
  }

  console.log("[routing] URL:", url);
  console.log("[routing] waypoints:", _waypoints);

  try {
    removePanel();
    const loading = document.createElement("div");
    loading.id = "routing-loading";
    loading.style.cssText = "position:absolute;top:10px;right:50px;z-index:1000;padding:8px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text);box-shadow:0 2px 8px rgba(0,0,0,0.15);";
    loading.textContent = "\u23F3 Calculating route...";
    state.map.getContainer().appendChild(loading);

    const resp = await fetch(url);
    loading.remove();
    if (!resp.ok) {
      const body = await resp.text();
      console.error("[routing] response:", resp.status, body);
      throw new Error(`OSRM ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    if (data.code !== "Ok" || !data.routes?.length) throw new Error("No route found");

    _routeData = data;
    removeRouteLayer();
    renderAllRoutes(data);
    createOrUpdatePanel();
    updateModeBadge();
    const route = data.routes[0];
    const dist = route.distance >= 1000 ? `${(route.distance/1000).toFixed(1)} km` : `${Math.round(route.distance)} m`;
    const time = route.duration >= 3600 ? `${Math.round(route.duration/3600)}h ${Math.round((route.duration%3600)/60)}min` : `${Math.round(route.duration/60)} min`;
    toast(`\u{1F6E3} ${dist} \u00b7 ${time}`, "#16a34a");
  } catch (e) {
    const existing = document.getElementById("routing-loading");
    if (existing) existing.remove();
    toast("Routing failed \u2014 check server or try different points", "#dc2626");
    console.warn("[routing]", e.message);
  }
}

// ─── Route rendering ────────────────────────────────────────────────

function renderAllRoutes(data) {
  _routesGroup = L.layerGroup().addTo(state.map);

  const primary = data.routes[0];
  const alts = data.routes.slice(1);

  renderPrimaryRoute(primary.geometry.coordinates);
  renderRouteArrows(primary.geometry.coordinates);

  alts.forEach((r, i) => {
    const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const poly = L.polyline(coords, {
      color: ALT_COLORS[i] || "#9ca3af",
      weight: 3,
      opacity: 0.5,
      dashArray: "8 6",
    }).addTo(_routesGroup);

    poly.on("click", () => selectAlternativeRoute(i + 1));
  });
}

function renderPrimaryRoute(geometryCoords) {
  const coords = geometryCoords.map(([lng, lat]) => [lat, lng]);

  _routesGroup.addLayer(L.polyline(coords, { color: "rgba(0,0,0,0.15)", weight: 8, opacity: 1 }));
  _routesGroup.addLayer(L.polyline(coords, { color: "#ffffff", weight: 5, opacity: 0.9 }));

  const primaryLine = L.polyline(coords, { color: "#2563eb", weight: 3, opacity: 1, className: "routing-route-line" });
  primaryLine.on("click", (e) => {
    L.DomEvent.stopPropagation(e.originalEvent);
    let closestIdx = 0, closestDist = Infinity;
    for (let i = 0; i < geometryCoords.length; i++) {
      const d = L.latLng(e.latlng.lat, e.latlng.lng).distanceTo(L.latLng(geometryCoords[i][1], geometryCoords[i][0]));
      if (d < closestDist) { closestDist = d; closestIdx = i; }
    }
    const idx = closestIdx >= geometryCoords.length - 1 ? _waypoints.length - 1 : closestIdx + 1;
    _waypoints.splice(idx, 0, { lat: e.latlng.lat, lng: e.latlng.lng, label: String.fromCharCode(65 + _waypoints.length) });
    renderWaypointMarkers();
    updateModeBadge();
    fetchAndRenderRoute();
  });
  _routesGroup.addLayer(primaryLine);
}

function renderRouteArrows(geometryCoords) {
  const interval = 2000;
  let accumulated = 0;

  for (let i = 0; i < geometryCoords.length - 1; i++) {
    const [lng1, lat1] = geometryCoords[i];
    const [lng2, lat2] = geometryCoords[i + 1];
    const segDist = L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));

    if (accumulated + segDist >= interval || i === geometryCoords.length - 2) {
      const midLat = (lat1 + lat2) / 2;
      const midLng = (lng1 + lng2) / 2;
      const angle = Math.atan2(lat2 - lat1, lng2 - lng1) * (180 / Math.PI);

      L.marker([midLat, midLng], {
        icon: L.divIcon({
          className: "route-arrow",
          html: `<div style="font-size:10px;color:#2563eb;transform:rotate(${angle + 90}deg);opacity:0.7;">\u25B2</div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
        interactive: false,
      }).addTo(_routesGroup);
      accumulated = 0;
    } else {
      accumulated += segDist;
    }
  }
}

function selectAlternativeRoute(index) {
  if (!_routeData?.routes?.[index]) return;
  [_routeData.routes[0], _routeData.routes[index]] = [_routeData.routes[index], _routeData.routes[0]];
  removeRouteLayer();
  renderAllRoutes(_routeData);
  createOrUpdatePanel();
}

function removeRouteLayer() {
  if (_routesGroup) { state.map.removeLayer(_routesGroup); _routesGroup = null; }
}

// ─── Waypoint markers ───────────────────────────────────────────────

function renderWaypointMarkers() {
  removeWaypointMarkers();

  _waypoints.forEach((wp, i) => {
    const color = i === 0 ? "#16a34a" : i === _waypoints.length - 1 && _waypoints.length >= 2 ? "#dc2626" : "#f97316";
    const label = wp.label;

    const icon = L.divIcon({
      className: "routing-waypoint",
      html: `<div style="width:24px;height:24px;border-radius:12px;background:${color};color:white;font-size:12px;font-weight:bold;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.3);">${escapeHtml(label)}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const marker = L.marker([wp.lat, wp.lng], { icon, draggable: true, zIndexOffset: 500 }).addTo(state.map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      _waypoints[i].lat = pos.lat;
      _waypoints[i].lng = pos.lng;
      fetchAndRenderRoute();
    });

    _waypointMarkers.push(marker);
  });
}

function removeWaypointMarkers() {
  _waypointMarkers.forEach(m => state.map.removeLayer(m));
  _waypointMarkers = [];
}

// ─── Panel ──────────────────────────────────────────────────────────

function createOrUpdatePanel() {
  removePanel();
  if (!_routeData?.routes?.[0]) return;

  const route = _routeData.routes[0];
  const dist = formatDistance(route.distance);
  const time = formatDuration(route.duration);

  _panel = document.createElement("div");
  _panel.id = "routing-panel";
  _panel.style.cssText = "position:absolute;top:10px;right:50px;z-index:1000;width:300px;max-height:65vh;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.25);display:flex;flex-direction:column;overflow:hidden;font-family:inherit;";

  _panel.innerHTML = buildPanelHTML(route, dist, time);
  _panel.addEventListener("click", (e) => e.stopPropagation());
  state.map.getContainer().appendChild(_panel);
  wirePanelEvents();
}

function buildPanelHTML(route, dist, time) {
  const alts = _routeData.routes.slice(1);
  const profileTabs = Object.entries(PROFILES).map(([k, v]) =>
    `<button class="routing-profile-tab ${k === _currentProfile ? "active" : ""}" data-profile="${k}" style="flex:1;padding:3px 6px;border:1px solid ${k === _currentProfile ? "#2563eb" : "var(--border)"};background:${k === _currentProfile ? "#2563eb" : "var(--bg-input)"};color:${k === _currentProfile ? "white" : "var(--text)"};border-radius:3px;cursor:pointer;font-size:11px;">${v.icon} ${v.label}</button>`
  ).join("");

  const altChips = alts.length > 0
    ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">${alts.map((a, i) =>
        `<button class="routing-alt-chip" data-index="${i + 1}" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:3px;cursor:pointer;font-size:11px;">${formatDistance(a.distance)} \u00b7 ${formatDuration(a.duration)}</button>`
      ).join("")}</div>`
    : "";

  const steps = route.legs?.[0]?.steps || [];
  const stepsHTML = steps.length > 0
    ? steps.map(s => {
        const icon = MANEUVERS[s.maneuver?.type] || "\u25CF";
        const d = formatDistance(s.distance);
        const name = s.name || "";
        return `<div class="routing-step" style="display:flex;align-items:flex-start;gap:6px;padding:4px 0;border-bottom:1px solid var(--border-light);font-size:12px;"><span style="flex-shrink:0;width:20px;text-align:center;">${icon}</span><span style="flex:1;color:var(--text);">${escapeHtml(name || "Unnamed road")}</span><span style="flex-shrink:0;color:var(--text-dim);font-size:11px;">${d}</span></div>`;
      }).join("")
    : `<div style="text-align:center;color:var(--text-dim);padding:12px;">No turn-by-turn steps available</div>`;

  return `<div class="routing-panel-header" style="padding:8px 10px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;"><span>\u{1F6E3} ${dist} \u00b7 ${time}</span><button id="routing-collapse" style="background:none;border:none;font-size:16px;cursor:pointer;color:var(--text-dim);padding:0 2px;line-height:1;">\u25BC</button></div><div style="padding:6px 10px;display:flex;gap:4px;">${profileTabs}</div>${altChips ? `<div style="padding:0 10px;">${altChips}</div>` : ""}<div class="routing-steps" style="padding:6px 10px;overflow-y:auto;flex:1;">${stepsHTML}</div><div style="padding:4px 10px;border-top:1px solid var(--border);"><label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--text-dim);"><input type="checkbox" id="routing-avoid-motorway" ${localStorage.getItem("pins-routing-avoid-mw") === "1" ? "checked" : ""} style="width:14px;height:14px;" /> Avoid motorways</label></div><div style="padding:6px 10px;border-top:1px solid var(--border);display:flex;gap:4px;"><button id="routing-reverse" style="flex:1;padding:4px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:3px;cursor:pointer;font-size:11px;">\u{1F504} Reverse</button><button id="routing-export-gpx" style="flex:1;padding:4px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:3px;cursor:pointer;font-size:11px;">\u{1F4E4} Export GPX</button><button id="routing-clear" style="flex:1;padding:4px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">\u2715 Clear</button></div>`;
}

function wirePanelEvents() {
  if (!_panel) return;

  const collapse = _panel.querySelector("#routing-collapse");
  const steps = _panel.querySelector(".routing-steps");
  if (collapse && steps) {
    collapse.onclick = () => {
      const hidden = steps.style.display === "none";
      steps.style.display = hidden ? "block" : "none";
      collapse.textContent = hidden ? "\u25BC" : "\u25B6";
    };
  }

  _panel.querySelectorAll(".routing-profile-tab").forEach(btn => {
    btn.onclick = () => setRoutingProfile(btn.dataset.profile);
  });

  _panel.querySelectorAll(".routing-alt-chip").forEach(btn => {
    btn.onclick = () => selectAlternativeRoute(parseInt(btn.dataset.index));
  });

  const reverseBtn = _panel.querySelector("#routing-reverse");
  if (reverseBtn) {
    reverseBtn.addEventListener("click", () => {
      _waypoints.reverse();
      _waypoints.forEach((wp, i) => wp.label = String.fromCharCode(65 + i));
      renderWaypointMarkers();
      fetchAndRenderRoute();
    });
  }

  const exportBtn = _panel.querySelector("#routing-export-gpx");
  if (exportBtn) exportBtn.addEventListener("click", exportRouteGPX);

  const clearBtn = _panel.querySelector("#routing-clear");
  if (clearBtn) clearBtn.addEventListener("click", clearRoute);

  const avoidMw = _panel.querySelector("#routing-avoid-motorway");
  if (avoidMw) {
    avoidMw.addEventListener("change", () => {
      localStorage.setItem("pins-routing-avoid-mw", avoidMw.checked ? "1" : "0");
      fetchAndRenderRoute();
    });
  }
}

function removePanel() {
  if (_panel) { _panel.remove(); _panel = null; }
}

// ─── Formatting helpers ─────────────────────────────────────────────

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

function escapeXml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
