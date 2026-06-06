import L from "leaflet";
import { toast, escapeHtml } from "./dialogs.js";
import { t } from "./i18n.js";

let _notesLayerGroup = null;
let _notesEnabled = false;
let _notesTimer = null;

function getProxyUrl() {
  return localStorage.getItem("pins-osm-proxy") || "";
}

function osmFetch(path) {
  const proxy = getProxyUrl();
  const url = proxy ? `${proxy.replace(/\/$/, "")}/${path}` : null;
  if (!url) return Promise.reject(new Error("No OSM proxy configured"));
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
}

export function initOSMNotesLayer(map) {
  _notesLayerGroup = L.layerGroup();
  return _notesLayerGroup;
}

export function isNotesEnabled() { return _notesEnabled; }
export function toggleNotesEnabled() { _notesEnabled = !_notesEnabled; return _notesEnabled; }

export async function queryOSMNotes() {
  if (!_notesEnabled || !_notesLayerGroup) return;
  const proxy = getProxyUrl();
  if (!proxy) { console.warn("[osm-notes] No proxy configured"); return; }

  const map = _notesLayerGroup._map;
  if (!map) return;
  const bounds = map.getBounds();
  if (!bounds.isValid()) return;

  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

  try {
    const data = await osmFetch(`api/0.6/notes.json?bbox=${bbox}&limit=100&closed=0`);
    if (!data.features) return;

    _notesLayerGroup.clearLayers();

    for (const note of data.features) {
      const [lon, lat] = note.geometry.coordinates;
      const props = note.properties;
      const isOpen = props.status === "open";
      const commentCount = props.comments?.length || 0;
      const firstComment = props.comments?.[0]?.text || "(no description)";
      const firstUser = props.comments?.[0]?.user || "anonymous";
      const bg = isOpen ? "#dc2626" : "#16a34a";
      const sym = isOpen ? "!" : "\u2713";

      const icon = L.divIcon({
        className: "osm-note-marker",
        html: `<div style="font-size:12px;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:9px;background:${bg};color:white;box-shadow:0 1px 3px rgba(0,0,0,0.2);font-weight:bold;">${sym}</div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      const marker = L.marker([lat, lon], { icon, zIndexOffset: -100, interactive: true });
      marker.bindPopup(`
        <div style="max-width:280px;">
          <b>${isOpen ? "\uD83D\uDD34 Open" : "\uD83D\uDFE2 Closed"} Note #${props.id}</b>
          <div style="font-size:12px;margin-top:4px;max-height:80px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;">${escapeHtml(firstComment.slice(0, 300))}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
            by ${escapeHtml(firstUser)} \u00b7 ${commentCount} comment${commentCount !== 1 ? "s" : ""}
          </div>
          <a href="https://www.openstreetmap.org/note/${props.id}" target="_blank" style="font-size:11px;color:#2563eb;">View on osm.org</a>
        </div>
      `);

      _notesLayerGroup.addLayer(marker);
    }
  } catch (e) { console.warn("[osm-notes] query failed:", e.message); }
}

export function scheduleNotesRefresh() {
  if (_notesTimer) clearTimeout(_notesTimer);
  _notesTimer = setTimeout(() => queryOSMNotes(), 3000);
}

export function clearNotesTimer() {
  if (_notesTimer) { clearTimeout(_notesTimer); _notesTimer = null; }
}

export function showCreateNoteDialog(lat, lng) {
  const proxy = getProxyUrl();
  if (!proxy) { toast(t("osmProxyNeeded"), "#dc2626"); return; }

  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:400px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 8px;">\uD83D\uDCDD Report a problem</h3>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
      Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}
    </div>
    <textarea id="osm-note-text" placeholder="Describe the issue (e.g. road closed, missing path)..." rows="4" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;resize:vertical;background:var(--bg-input);color:var(--text);font-size:13px;font-family:inherit;"></textarea>
    <div style="font-size:10px;color:var(--text-dim);margin-bottom:10px;">
      This will be submitted to OpenStreetMap as an anonymous note. <a href="https://www.openstreetmap.org/login" target="_blank" style="color:#2563eb;">Log in to OSM</a> to have your name attached.
    </div>
    <div style="display:flex;gap:6px;">
      <button id="osm-note-submit" style="flex:1;padding:6px;border:none;background:#dc2626;color:white;border-radius:4px;cursor:pointer;font-size:13px;">Submit Note</button>
      <button id="osm-note-cancel" style="flex:1;padding:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:13px;">Cancel</button>
    </div>
  </div>`;
  document.body.appendChild(ov);

  const clean = () => ov.remove();
  ov.onclick = (e) => { if (e.target === ov) clean(); };
  document.getElementById("osm-note-cancel").onclick = clean;

  document.getElementById("osm-note-submit").onclick = async () => {
    const text = document.getElementById("osm-note-text").value.trim();
    if (!text) { toast(t("osmNoteDesc"), "#dc2626"); return; }
    if (text.length < 10) { toast(t("osmNoteShort"), "#dc2626"); return; }

    const btn = document.getElementById("osm-note-submit");
    btn.disabled = true;
    btn.textContent = "Submitting...";

    try {
      const proxyUrl = getProxyUrl().replace(/\/$/, "");
      const resp = await fetch(`${proxyUrl}/api/0.6/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ lat, lon: lng, text }),
      });
      if (resp.ok) {
        toast(t("osmNoteSuccess"), "#16a34a");
        clean();
        queryOSMNotes();
      } else {
        toast(t("osmNoteFail"), "#dc2626");
      }
    } catch (e) {
      toast(t("osmNoteFail"), "#dc2626");
    }
    btn.disabled = false;
    btn.textContent = "Submit Note";
  };
}
