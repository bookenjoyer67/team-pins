import { state } from "./state.js";
import * as Map from "./map.js";
import L from "leaflet";
import { initFreeDraw, addFreeDrawButton as initFreeDrawSetup, enterDrawingMode, exitDrawingMode } from "./freeDraw.js";
import { escapeHtml, toast } from "./dialogs.js";
import { t, getLang, getSupported, setLang } from "./i18n.js";
import * as Relay from "./relay.js";
import * as Mesh from "./mesh.js";
import * as Sync from "./sync.js";
import * as DB from "./db.js";
import { generate_qr_svg } from "./core/pkg/e2e_core.js";

const COLLAPSED_WIDTH = "32px";
const EXPANDED_WIDTH = "200px";
let _expanded = false;
let _drawerEl = null;
let _overlayEl = null;
let _stripTop = null;
let _stripMinimal = false;

const SECTIONS = [
  {
    id: "data",
    label: "Data",
    items: [
      { id: "maps", icon: "🗺", label: "Maps", action: () => Map.showSetsModal() },
      { id: "layers", icon: "📑", label: "Layers", action: () => Map.showLayersModal() },
      { id: "schemas", icon: "📋", label: "Schemas", action: () => Map.showSchemaManagerModal() },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [
      { id: "pin", icon: "📌", label: "Pin", active: () => state.placingPin, action: togglePin },
      { id: "draw", icon: "✏️", label: "Draw", active: () => state.freeDrawing, action: toggleDraw },
      { id: "measure", icon: "📏", label: "Measure", active: () => state.measuring, action: toggleMeasure },
      { id: "select", icon: "⊞", label: "Select", active: () => state._selectionActive || false, action: toggleSelect },
      { id: "chains", icon: "🔗", label: "Chains", action: () => Map.showChainsModal() },
    ],
  },
  {
    id: "view",
    label: "View",
    items: [
      { id: "grid", icon: "▦", label: "Grid", active: () => state._gridEnabled || false, action: toggleGrid },
      { id: "time", icon: "⏳", label: "Time", active: () => state._timeSliderVisible || false, action: toggleTime },
      { id: "trust", icon: "🛡", label: "Trust", active: () => state._trustSliderVisible || false, action: toggleTrust },
      { id: "fullscreen", icon: "⛶", label: "Fullscreen", action: toggleFullscreen },
      { id: "slideshow", icon: "▶", label: "Slideshow", action: () => Map.startCurrentMapSlideshow?.() || Map.startSlideshow?.(state.markers.filter(m => m._pinId).map(m => m._pinId)) },
    ],
  },
  {
    id: "share",
    label: "Share",
    items: [
      { id: "host", icon: "📡", label: "Host", action: () => window._showHostModal?.() },
      { id: "join", icon: "🤝", label: "Join", action: () => window._showJoinModal?.() },
      { id: "discover", icon: "🔍", label: "Discover", action: () => Map.showDiscoverModal() },
      { id: "export", icon: "📤", label: "Export", action: () => Sync.exportSet() },
      { id: "import", icon: "📥", label: "Import", action: () => Sync.importSet() },
      { id: "share", icon: "↗", label: "Share", action: () => Sync.shareMap() },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      { id: "relay", icon: "⚡", label: "Relay", action: () => window._showIceDialog?.() },
      { id: "rotate", icon: "🔄", label: "Rotate Keys", action: () => Sync.rotateSetKeys() },
      { id: "name", icon: "👤", label: "Name", action: showNameModal },
      { id: "sound", icon: "🔊", label: "Sound",
        active: () => window._isSoundEnabled?.() || false,
        action: () => { const on = window._toggleSound?.(); toast(on ? "Sound ON" : "Sound MUTED", on ? "#16a34a" : "#9ca3af"); } },
      { id: "theme", icon: "🌓", label: "Theme", action: () => window._toggleTheme?.() },
      { id: "language", icon: "🌐", label: "Language", action: showLangChooser },
      { id: "github", icon: "🐙", label: "GitHub", action: () => window.open("https://github.com/bookenjoyer67/team-pins", "_blank") },
      { id: "donate", icon: "💸", label: "Donate", action: showDonateModal },
    ],
  },
];

// --- Toggle handlers ---

function togglePin() {
  state.placingPin = !state.placingPin;
  state.map.getContainer().style.cursor = state.placingPin ? "crosshair" : "";
  refreshToolStates();
}

function toggleDraw() {
  if (!state._drawInit) {
    state._drawInit = true;
    initFreeDraw(Map.showDrawingForm);
    initFreeDrawSetup();
    // Hide the floating toggle button that freeDraw.js creates — drawer has its own
    const oldBtn = state.map.getContainer().querySelector("button[title*=\"Draw\" i]");
    if (oldBtn) oldBtn.style.display = "none";
  }
  if (state.freeDrawing) {
    exitDrawingMode();
  } else {
    enterDrawingMode();
  }
  refreshToolStates();
}

function toggleMeasure() {
  if (state.measuring) {
    state.measuring = false;
    state.map.getContainer().style.cursor = "";
    if (state._measureLayer) { state.map.removeLayer(state._measureLayer); state._measureLayer = null; }
    if (state._measureMarkers) { state._measureMarkers.forEach(m => state.map.removeLayer(m)); state._measureMarkers = []; }
    state.map.off("click", state._measureClick);
  } else {
    state.measuring = true;
    state.map.getContainer().style.cursor = "crosshair";
    if (!state._measureMarkers) state._measureMarkers = [];
    let pointA = null;
    state._measureClick = (e) => {
      if (!state.measuring || state.freeDrawing) return;
      if (pointA) {
        // Clean up previous measure
        if (state._measureLayer) state.map.removeLayer(state._measureLayer);
        state._measureMarkers.forEach(m => state.map.removeLayer(m));
        state._measureMarkers = [];
        // Draw start and end points
        const startMarker = L.circleMarker(pointA, { radius: 5, color: "#0e7490", fillColor: "#0e7490", fillOpacity: 1, weight: 2, interactive: false }).addTo(state.map);
        const endMarker = L.circleMarker(e.latlng, { radius: 5, color: "#0e7490", fillColor: "#0e7490", fillOpacity: 1, weight: 2, interactive: false }).addTo(state.map);
        state._measureMarkers.push(startMarker, endMarker);
        // Draw line
        const d = pointA.distanceTo(e.latlng);
        const dist = d > 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`;
        state._measureLayer = L.polyline([pointA, e.latlng], { color: "#0e7490", weight: 2, dashArray: "6 4" }).addTo(state.map);
        state._measureLayer.bindTooltip(dist, { permanent: true, direction: "center", offset: [0, -6] }).openTooltip();
        pointA = null;
      } else {
        // Clean up previous and mark start
        if (state._measureLayer) state.map.removeLayer(state._measureLayer);
        state._measureMarkers.forEach(m => state.map.removeLayer(m));
        state._measureMarkers = [];
        pointA = e.latlng;
        const startMarker = L.circleMarker(pointA, { radius: 5, color: "#0e7490", fillColor: "#0e7490", fillOpacity: 1, weight: 2, interactive: false }).addTo(state.map);
        state._measureMarkers.push(startMarker);
      }
    };
    state.map.on("click", state._measureClick);
  }
  refreshToolStates();
}

function toggleSelect() {
  if (state._selectionActive) {
    _selecting = false;
    if (state._selectionCleanup) state._selectionCleanup();
    state._selectionActive = false;
    state.map.getContainer().style.cursor = "";
  } else {
    _selecting = true;
    state._selectionActive = true;
    state.map.getContainer().style.cursor = "crosshair";
    const cleanup = enableSelection();
    state._selectionCleanup = () => {
      _selecting = false;
      cleanup();
      state._selectionActive = false;
      state.map.getContainer().style.cursor = "";
    };
  }
  refreshToolStates();
}

let _selecting = false, _lassoMode = false, _selStart = null, _selRect = null, _selPoly = null;

function enableSelection() {
  let selMarkers = [];
  let selDrawings = [];
  let selBar = null;

  function clearSelLayer() {
    if (_selRect) { state.map.removeLayer(_selRect); _selRect = null; }
    if (_selPoly) { state.map.removeLayer(_selPoly); _selPoly = null; }
  }

  function clearSelection() {
    selMarkers.forEach(m => { const icon = m._icon; if (icon) icon.style.filter = ""; });
    selDrawings.forEach(l => { l.setStyle({ color: l._origColor || l.options?.color || "#2563eb" }); });
    selMarkers = []; selDrawings = []; if (selBar) { selBar.remove(); selBar = null; } clearSelLayer();
  }

  function showSelBar() {
    if (selBar) selBar.remove();
    const total = selMarkers.length + selDrawings.length;
    if (total === 0) return;
    selBar = document.createElement("div");
    selBar.style.cssText = "position:absolute;top:214px;right:48px;z-index:1001;display:flex;gap:4px;";
    const delBtn = document.createElement("button");
    delBtn.textContent = `Delete (${total})`;
    delBtn.style.cssText = "height:28px;border:none;border-radius:4px;background:#dc2626;color:white;cursor:pointer;font-size:12px;font-weight:600;padding:0 8px;white-space:nowrap;";
    delBtn.onclick = async () => {
      for (const m of selMarkers) await Map.deletePin(m._pinId);
      for (const l of selDrawings) await Map.deleteDrawing(l._drawingId || l._row?.drawing_id);
      clearSelection(); _selecting = false;
    };
    selBar.appendChild(delBtn); state.map.getContainer().appendChild(selBar);
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if ((polygon[i][1] > point[1]) !== (polygon[j][1] > point[1]) &&
        point[0] < (polygon[j][0] - polygon[i][0]) * (point[1] - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0]) inside = !inside;
    }
    return inside;
  }

  function selectionForBounds(bounds) {
    clearSelection();
    state.markers.forEach(m => { if (bounds.contains(m.getLatLng())) { selMarkers.push(m); const icon = m._icon; if (icon) icon.style.filter = "drop-shadow(0 0 4px #2563eb) brightness(1.2)"; } });
    state.drawingLayers.forEach(l => { try { const lb = l.getBounds(); if (lb && bounds.intersects(lb)) { selDrawings.push(l); l._origColor = l.options?.color || l._origColor; l.setStyle({ color: "#2563eb", weight: (l.options?.weight || 2) + 1 }); } } catch (_) {} });
    if (selMarkers.length + selDrawings.length > 0) showSelBar();
  }

  function selectionForPoly(latlngs) {
    clearSelection();
    const polyArr = latlngs.map(ll => [ll.lng, ll.lat]);
    state.markers.forEach(m => { const ll = m.getLatLng(); if (pointInPolygon([ll.lng, ll.lat], polyArr)) { selMarkers.push(m); const icon = m._icon; if (icon) icon.style.filter = "drop-shadow(0 0 4px #2563eb) brightness(1.2)"; } });
    state.drawingLayers.forEach(l => { try { const lb = l.getBounds(); if (lb) { const c = lb.getCenter(); if (pointInPolygon([c.lng, c.lat], polyArr)) { selDrawings.push(l); l._origColor = l.options?.color || l._origColor; l.setStyle({ color: "#2563eb", weight: (l.options?.weight || 2) + 1 }); } } } catch (_) {} });
    if (selMarkers.length + selDrawings.length > 0) showSelBar();
  }

  state.map.dragging.disable();

  const pointerdown = (e) => {
    if (!_selecting) return;
    if (e.target.closest("button")) return;
    e.preventDefault(); e.stopPropagation();
    const rc = state.map.getContainer().getBoundingClientRect();
    _selStart = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
    if (_lassoMode) _selPoly = L.polyline([[ _selStart.lat, _selStart.lng ]], { color: "#2563eb", weight: 1.5, dashArray: "4 4" }).addTo(state.map);
  };
  const pointermove = (e) => {
    if (!_selecting || !_selStart) return;
    const rc = state.map.getContainer().getBoundingClientRect();
    const curr = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
    if (_lassoMode && _selPoly) { const ll = _selPoly.getLatLngs(); ll.push([curr.lat, curr.lng]); _selPoly.setLatLngs(ll); }
    else if (!_lassoMode) { clearSelLayer(); _selRect = L.rectangle(L.latLngBounds(_selStart, curr), { color: "#2563eb", weight: 1.5, dashArray: "4 4", fillOpacity: 0.08 }).addTo(state.map); }
  };
  const pointerup = (e) => {
    if (!_selecting || !_selStart) return;
    const rc = state.map.getContainer().getBoundingClientRect();
    const curr = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
    if (_lassoMode && _selPoly) { const ll = _selPoly.getLatLngs(); if (ll.length > 3) selectionForPoly(ll); clearSelLayer(); }
    else if (!_lassoMode) { if (_selStart.distanceTo(curr) > 5) selectionForBounds(L.latLngBounds(_selStart, curr)); clearSelLayer(); }
    _selStart = null;
  };

  state.map.getContainer().addEventListener("pointerdown", pointerdown);
  state.map.getContainer().addEventListener("pointermove", pointermove);
  state.map.getContainer().addEventListener("pointerup", pointerup);

  const contextmenu = (e) => {
    if (!_selecting) return;
    e.preventDefault(); e.stopPropagation();
    _lassoMode = !_lassoMode;
  };
  state.map.getContainer().addEventListener("contextmenu", contextmenu);

  return () => {
    state.map.dragging.enable();
    state.map.getContainer().removeEventListener("pointerdown", pointerdown);
    state.map.getContainer().removeEventListener("pointermove", pointermove);
    state.map.getContainer().removeEventListener("pointerup", pointerup);
    state.map.getContainer().removeEventListener("contextmenu", contextmenu);
    clearSelLayer();
    clearSelection();
    _selStart = null; _selecting = false;
  };
}

function toggleGrid() {
  state._gridEnabled = !state._gridEnabled;
  if (state._gridEnabled) {
    drawGrid();
    state.map.on("moveend zoomend baselayerchange", drawGrid);
  } else {
    if (state._gridLayer) { state.map.removeLayer(state._gridLayer); state._gridLayer = null; }
    state.map.off("moveend zoomend baselayerchange", drawGrid);
  }
  refreshViewStates();
}

function drawGrid() {
  if (state._gridLayer) state.map.removeLayer(state._gridLayer);
  const bounds = state.map.getBounds();
  const zoom = state.map.getZoom();
  let step;
  if (zoom <= 3) step = 10;
  else if (zoom <= 6) step = 5;
  else if (zoom <= 9) step = 1;
  else step = 0.1;
  const lines = [];
  const style = { color: "#94a3b8", weight: 1, opacity: 0.25, dashArray: "6 4", interactive: false };
  const south = Math.floor(bounds.getSouth() / step) * step;
  const north = Math.ceil(bounds.getNorth() / step) * step;
  for (let lat = south; lat <= north; lat += step)
    lines.push(L.polyline([[lat, bounds.getWest()], [lat, bounds.getEast()]], style));
  const west = Math.floor(bounds.getWest() / step) * step;
  const east = Math.ceil(bounds.getEast() / step) * step;
  for (let lng = west; lng <= east; lng += step)
    lines.push(L.polyline([[bounds.getSouth(), lng], [bounds.getNorth(), lng]], style));
  state._gridLayer = L.layerGroup(lines).addTo(state.map);
}

function toggleTime() {
  state._timeSliderVisible = !state._timeSliderVisible;
  const el = document.getElementById("drawer-time-slider");
  if (el) el.style.display = state._timeSliderVisible ? "flex" : "none";
  if (!state._timeSliderVisible) {
    state.timeFrom = null; state.timeTo = null;
    Map.applyTimeFilter();
  }
  refreshViewStates();
}

function toggleTrust() {
  state._trustSliderVisible = !state._trustSliderVisible;
  const el = document.getElementById("drawer-trust-slider");
  if (el) el.style.display = state._trustSliderVisible ? "flex" : "none";
  if (!state._trustSliderVisible) {
    state.minTrustScore = null;
    Map.applyTrustFilter?.();
  }
  refreshViewStates();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}

function showNameModal() {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:280px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 12px;font-size:15px;">${t("displayName") || "Display Name"}</h3>
    <input id="name-modal-input" type="text" value="${escapeHtml(state.displayName)}" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:14px;box-sizing:border-box;margin-bottom:12px;" maxlength="100" />
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="name-modal-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;font-size:13px;">${t("cancel") || "Cancel"}</button>
      <button id="name-modal-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;">${t("save") || "Save"}</button>
    </div>
  </div>`;
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  document.body.appendChild(ov);

  const input = document.getElementById("name-modal-input");
  input.focus();
  input.select();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") ov.remove();
  });

  const save = async () => {
    const name = input.value.trim();
    if (!name) { toast(t("nameRequired") || "Name cannot be empty", "#dc2626"); return; }
    if (name === state.displayName) { ov.remove(); return; }
    state.displayName = name;
    try { await DB.saveProfile({ user_id: state.user.id, display_name: name }); } catch (_) {}
    toast(t("nameUpdated") || "Name updated", "#16a34a");
    ov.remove();
    window._renderUI?.();
  };

  document.getElementById("name-modal-save").onclick = save;
  document.getElementById("name-modal-cancel").onclick = () => ov.remove();
}

function showLangChooser() {
  const langs = getSupported();
  const items = langs.map(l => `<button class="drawer-lang-opt" data-lang="${l}" style="display:block;width:100%;padding:6px 12px;border:none;background:${l === getLang() ? "var(--bg-input)" : "transparent"};color:var(--text);cursor:pointer;font-size:12px;text-align:left;">${l.toUpperCase()}</button>`).join("");
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div style="background:var(--bg-card);padding:12px;border-radius:8px;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">${items}</div>`;
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  document.body.appendChild(ov);
  ov.querySelectorAll(".drawer-lang-opt").forEach(b => {
    b.onclick = () => { setLang(b.dataset.lang); ov.remove(); window._renderUI?.(); };
  });
}

function showDonateModal() {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
  const qrSvg = generate_qr_svg("https://cash.app/$catpeoplerock");
  ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:280px;box-shadow:0 4px 20px rgba(0,0,0,0.3);text-align:center;">
    <h3 style="margin:0 0 16px;font-size:16px;">Support piggPin</h3>
    <div style="display:inline-block;background:white;padding:12px;border-radius:8px;margin-bottom:12px;">${qrSvg}</div>
    <div style="font-size:18px;font-weight:600;margin-bottom:16px;color:var(--text);">$catpeoplerock</div>
    <div style="display:flex;gap:8px;justify-content:center;">
      <button id="donate-copy-tag" style="padding:8px 16px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;">Copy Tag</button>
      <button id="donate-close" style="padding:8px 16px;border:1px solid var(--border);background:var(--border-light);color:var(--text);border-radius:4px;cursor:pointer;font-size:13px;">Close</button>
    </div>
  </div>`;
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape") ov.remove(); });
  document.body.appendChild(ov);

  document.getElementById("donate-copy-tag").onclick = async () => {
    try {
      await navigator.clipboard.writeText("$catpeoplerock");
      toast("Copied to clipboard", "#16a34a");
    } catch {
      toast("Failed to copy", "#dc2626");
    }
  };
  document.getElementById("donate-close").onclick = () => ov.remove();
}

// --- Refresh active states ---

export function refreshToolStates() {
  const el = _drawerEl;
  if (!el) return;
  el.querySelectorAll(".drawer-tool-toggle").forEach(btn => {
    const section = SECTIONS.find(s => s.id === "tools") || SECTIONS.find(s => s.id === "settings");
    const item = section?.items.find(t => t.id === btn.dataset.tool);
    if (item?.active) {
      const on = item.active();
      btn.classList.toggle("drawer-active", !!on);
    }
  });
}

function refreshViewStates() {
  const el = _drawerEl;
  if (!el) return;
  el.querySelectorAll(".drawer-view-toggle").forEach(btn => {
    const section = SECTIONS.find(s => s.id === "view");
    const item = section?.items.find(t => t.id === btn.dataset.tool);
    if (item?.active) {
      const on = item.active();
      btn.classList.toggle("drawer-active", !!on);
    }
  });
}

// --- Build ---

export function init() {
  const ov = document.createElement("div");
  ov.id = "drawer-overlay";
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:1999;display:none;";
  ov.onclick = () => close();
  document.body.appendChild(ov);
  _overlayEl = ov;

  const d = document.createElement("div");
  d.id = "piggpin-drawer";
  d.style.cssText = `position:fixed;top:50%;right:0;z-index:2000;background:transparent;display:flex;flex-direction:column;overflow:hidden;transition:width 0.2s ease;width:${COLLAPSED_WIDTH};transform:translateY(-50%);`;
  document.body.appendChild(d);
  _drawerEl = d;

  renderCollapsed();
  renderExpanded();
}

function renderCollapsed() {
  const strip = document.createElement("div");
  strip.id = "drawer-collapsed";
  strip.style.cssText = "display:flex;flex-direction:column;align-items:center;padding:8px 2px;gap:6px;flex-shrink:0;width:32px;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.12);cursor:grab;";

  // ≡ toggle
  const toggle = document.createElement("button");
  toggle.id = "drawer-toggle";
  toggle.style.cssText = "width:26px;height:26px;border:none;background:transparent;color:var(--text-dim);cursor:pointer;font-size:16px;padding:0;border-radius:4px;flex-shrink:0;";
  toggle.textContent = "≡";
  toggle.onclick = (e) => { e.stopPropagation(); toggleDrawer(); };
  strip.appendChild(toggle);

  // Tool icons (always visible in collapsed state)
  const toolItems = SECTIONS.find(s => s.id === "tools").items;
  for (const t of toolItems) {
    const btn = document.createElement("button");
    btn.dataset.tool = t.id;
    btn.className = "drawer-tool-toggle";
    btn.title = t.label;
    btn.textContent = t.icon;
    btn.style.cssText = "width:26px;height:32px;border:none;background:transparent;color:var(--text-dim);cursor:pointer;font-size:14px;padding:0;border-radius:4px;flex-shrink:0;";
    btn.onclick = (e) => { e.stopPropagation(); t.action(); };
    if (t.active?.()) btn.classList.add("drawer-active");
    btn.classList.add("strip-collapsible");
    strip.appendChild(btn);
  }

  // Thin separator
  const sep = document.createElement("div");
  sep.style.cssText = "width:20px;height:1px;background:var(--border);flex-shrink:0;margin:4px 0;";
  sep.classList.add("strip-collapsible");
  strip.appendChild(sep);

  // Discover (quick access next-most-frequent)
  const discBtn = document.createElement("button");
  discBtn.title = "Discover";
  discBtn.textContent = "🔍";
  discBtn.style.cssText = "width:26px;height:32px;border:none;background:transparent;color:var(--text-dim);cursor:pointer;font-size:14px;padding:0;border-radius:4px;flex-shrink:0;";
  discBtn.onclick = () => Map.showDiscoverModal();
  discBtn.classList.add("strip-collapsible");
  strip.appendChild(discBtn);

  // Collapse triangle — toggles between full tools and minimal (≡ + triangle only)
  const collapseBtn = document.createElement("button");
  collapseBtn.title = _stripMinimal ? "Show tools" : "Hide tools";
  collapseBtn.textContent = _stripMinimal ? "▶" : "▼";
  collapseBtn.style.cssText = "width:26px;height:20px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;font-size:10px;padding:0;border-radius:4px;flex-shrink:0;opacity:0.6;";
  collapseBtn.onclick = (e) => {
    e.stopPropagation();
    _stripMinimal = !_stripMinimal;
    collapseBtn.textContent = _stripMinimal ? "▶" : "▼";
    collapseBtn.title = _stripMinimal ? "Show tools" : "Hide tools";
    strip.querySelectorAll(".strip-collapsible").forEach(el => {
      el.style.display = _stripMinimal ? "none" : "";
    });
    // Re-center after height change
    if (!_stripTop) {
      strip.parentElement.style.top = "50%";
      strip.parentElement.style.transform = "translateY(-50%)";
    }
  };
  strip.appendChild(collapseBtn);

  // Grip handle — indicates draggable, sits below the triangle
  const grip = document.createElement("div");
  grip.style.cssText = "width:14px;height:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;opacity:0.4;flex-shrink:0;padding:4px 0;";
  grip.innerHTML = `<span style="width:12px;height:1px;background:var(--text-dim);border-radius:1px;"></span><span style="width:8px;height:1px;background:var(--text-dim);border-radius:1px;"></span><span style="width:12px;height:1px;background:var(--text-dim);border-radius:1px;"></span>`;
  strip.appendChild(grip);

  // Apply initial minimal state
  if (_stripMinimal) {
    strip.querySelectorAll(".strip-collapsible").forEach(el => el.style.display = "none");
  }

  _drawerEl.appendChild(strip);

  // Make the collapsed strip draggable
  let _dragActive = false, _dragStartY = 0, _dragStartTop = 0;

  strip.addEventListener("mousedown", (e) => {
    if (e.target !== strip && e.target.tagName === "BUTTON") return;
    startDrag(e.clientY);
  });
  strip.addEventListener("touchstart", (e) => {
    if (e.target !== strip && e.target.tagName === "BUTTON") return;
    startDrag(e.touches[0].clientY);
  }, { passive: true });

  function startDrag(clientY) {
    _dragActive = true;
    _dragStartY = clientY;
    _dragStartTop = _stripTop ?? _drawerEl.getBoundingClientRect().top;
    _drawerEl.style.transition = "none";
    _drawerEl.style.transform = "none";
    _drawerEl.style.top = _dragStartTop + "px";
    document.body.style.userSelect = "none";
    strip.style.cursor = "grabbing";
  }

  document.addEventListener("mousemove", (e) => {
    if (!_dragActive) return;
    moveDrag(e.clientY);
  });
  document.addEventListener("touchmove", (e) => {
    if (!_dragActive) return;
    moveDrag(e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener("mouseup", endDrag);
  document.addEventListener("touchend", endDrag);

  function moveDrag(clientY) {
    const dy = clientY - _dragStartY;
    let newTop = _dragStartTop + dy;
    const stripH = strip.getBoundingClientRect().height;
    const maxTop = window.innerHeight - stripH - 8;
    newTop = Math.max(36, Math.min(newTop, maxTop));
    _drawerEl.style.top = newTop + "px";
    _stripTop = newTop;
  }

  function endDrag() {
    if (!_dragActive) return;
    _dragActive = false;
    _drawerEl.style.transition = "top 0.1s ease";
    document.body.style.userSelect = "";
    strip.style.cursor = "grab";
  }
}

function renderExpanded() {
  const panel = document.createElement("div");
  panel.id = "drawer-expanded";
  panel.style.cssText = "display:none;flex-direction:column;flex:1;overflow-y:auto;padding:0 8px 16px;";

  // Close button row
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:8px 4px;flex-shrink:0;";
  header.innerHTML = `<span style="font-size:13px;font-weight:600;color:var(--text-dim);">piggPin</span>`;
  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = "width:26px;height:26px;border:none;background:transparent;color:var(--text-dim);cursor:pointer;font-size:16px;padding:0;border-radius:4px;";
  closeBtn.textContent = "×";
  closeBtn.onclick = () => close();
  header.appendChild(closeBtn);
  panel.appendChild(header);

  for (const section of SECTIONS) {
    const secDiv = document.createElement("div");
    secDiv.style.cssText = "margin-bottom:4px;";

    const secHeader = document.createElement("div");
    secHeader.style.cssText = "padding:6px 4px;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;cursor:pointer;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;";
    secHeader.innerHTML = `<span>${section.label}</span>`;
    const collapseIcon = document.createElement("span");
    collapseIcon.style.cssText = "font-size:10px;";
    collapseIcon.textContent = "▼";
    secHeader.appendChild(collapseIcon);

    const secBody = document.createElement("div");
    secBody.style.cssText = "display:block;";

    for (const item of section.items) {
      const btn = document.createElement("button");
      btn.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:12px;text-align:left;border-radius:4px;";
      btn.innerHTML = `<span style="width:20px;text-align:center;font-size:14px;">${item.icon}</span><span>${escapeHtml(item.label)}</span>`;
      btn.onclick = (e) => { e.stopPropagation(); item.action(); };

      const isToggle = item.id === "pin" || item.id === "draw" || item.id === "measure" || item.id === "select";
      if (isToggle) btn.classList.add("drawer-tool-toggle");
      if (section.id === "view" && item.active) btn.classList.add("drawer-view-toggle");

      if (item.active?.()) btn.classList.add("drawer-active");

      secBody.appendChild(btn);
    }

    secHeader.onclick = () => {
      const show = secBody.style.display === "none";
      secBody.style.display = show ? "block" : "none";
      collapseIcon.textContent = show ? "▼" : "▶";
    };

    secDiv.appendChild(secHeader);
    secDiv.appendChild(secBody);
    panel.appendChild(secDiv);
  }

  _drawerEl.appendChild(panel);
}

// --- Time slider (created by drawer) ---

function createTimeSlider() {
  const el = document.createElement("div");
  el.id = "drawer-time-slider";
  el.style.cssText = "display:none;position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:1000;align-items:center;gap:8px;padding:6px 12px;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:6px;box-shadow:0 1px 5px var(--shadow);font-size:12px;white-space:nowrap;";
  el.innerHTML = `
    <span style="color:var(--text-dim);">⏳</span>
    <input id="drawer-time-from" type="number" placeholder="-∞" style="width:70px;padding:3px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;text-align:center;">
    <span style="color:var(--text-dim);">–</span>
    <input id="drawer-time-to" type="number" placeholder="∞" style="width:70px;padding:3px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;text-align:center;">
    <button id="drawer-time-reset" style="padding:3px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;">reset</button>
    <button id="drawer-time-apply" style="padding:3px 8px;border:none;background:#2563eb;color:white;border-radius:3px;cursor:pointer;font-size:11px;">apply</button>
  `;
  state.map.getContainer().appendChild(el);
  document.getElementById("drawer-time-reset").onclick = () => {
    document.getElementById("drawer-time-from").value = "";
    document.getElementById("drawer-time-to").value = "";
    state.timeFrom = null; state.timeTo = null;
    Map.applyTimeFilter();
  };
  document.getElementById("drawer-time-apply").onclick = () => {
    const f = document.getElementById("drawer-time-from")?.value;
    const t = document.getElementById("drawer-time-to")?.value;
        state.timeFrom = f ? parseInt(f, 10) : null;
        state.timeTo = t ? parseInt(t, 10) : null;
    Map.applyTimeFilter();
  };
}

// --- Trust slider ---

function createTrustSlider() {
  const el = document.createElement("div");
  el.id = "drawer-trust-slider";
  el.style.cssText = "display:none;position:absolute;bottom:42px;left:50%;transform:translateX(-50%);z-index:1000;align-items:center;gap:8px;padding:6px 12px;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:6px;box-shadow:0 1px 5px var(--shadow);font-size:12px;white-space:nowrap;";
  el.innerHTML = `
    <span style="color:var(--text-dim);">🛡</span>
    <input id="drawer-trust-slider-input" type="range" min="0" max="10" value="0" style="width:100px;">
    <span id="drawer-trust-slider-label" style="min-width:24px;text-align:right;font-size:11px;color:var(--text-dim);">off</span>
  `;
  state.map.getContainer().appendChild(el);
  const slider = document.getElementById("drawer-trust-slider-input");
  const label = document.getElementById("drawer-trust-slider-label");
  slider.oninput = () => {
    const v = parseInt(slider.value, 10);
    state.minTrustScore = v > 0 ? v / 10 : null;
    label.textContent = v > 0 ? (v / 10).toFixed(1) : "off";
    Map.applyTrustFilter?.();
  };
}

// --- API ---

export function toggle() {
  _expanded ? close() : open();
}

function toggleDrawer() {
  _expanded ? close() : open();
}

export function open() {
  _expanded = true;
  // Save current strip position if not already dragged
  if (_stripTop === null && _drawerEl) {
    _stripTop = _drawerEl.getBoundingClientRect().top;
  }
  _drawerEl.style.top = "0";
  _drawerEl.style.height = "100%";
  _drawerEl.style.transform = "none";
  _drawerEl.style.width = EXPANDED_WIDTH;
  _drawerEl.style.background = "var(--bg-card)";
  _drawerEl.style.borderLeft = "1px solid var(--border)";
  const collapsed = document.getElementById("drawer-collapsed");
  if (collapsed) collapsed.style.display = "none";
  const expanded = document.getElementById("drawer-expanded");
  if (expanded) expanded.style.display = "flex";
  _overlayEl.style.display = "block";
  document.body.classList.add("drawer-expanded");
  refreshToolStates();
  refreshViewStates();
}

export function close() {
  _expanded = false;
  if (_stripTop !== null) {
    _drawerEl.style.top = _stripTop + "px";
    _drawerEl.style.transform = "none";
  } else {
    _drawerEl.style.top = "50%";
    _drawerEl.style.transform = "translateY(-50%)";
  }
  _drawerEl.style.height = "auto";
  _drawerEl.style.width = COLLAPSED_WIDTH;
  _drawerEl.style.background = "transparent";
  _drawerEl.style.borderLeft = "none";
  const collapsed = document.getElementById("drawer-collapsed");
  if (collapsed) collapsed.style.display = "flex";
  const expanded = document.getElementById("drawer-expanded");
  if (expanded) expanded.style.display = "none";
  _overlayEl.style.display = "none";
  document.body.classList.remove("drawer-expanded");
}

// Called from main.js after map is initialized
export function initSliders() {
  createTimeSlider();
  createTrustSlider();
}
