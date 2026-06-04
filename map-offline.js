import * as DB from "./db.js";
import { toast, showProgressDialog, confirmDialog, escapeHtml } from "./dialogs.js";
import { state } from "./state.js";

// --- Region metadata ---

export async function getOfflineRegions() {
  return DB.getOfflineRegions() || [];
}

export async function deleteOfflineRegion(regionId) {
  await DB.deleteOfflineRegion(regionId);
}

export async function getCacheInfo() {
  try {
    const est = await navigator.storage.estimate();
    return { usedMB: Math.round(est.usage / 1024 / 1024), quotaMB: Math.round(est.quota / 1024 / 1024) };
  } catch (_) {
    return { usedMB: 0, quotaMB: 0 };
  }
}

// --- Tile enumeration ---

function lat2tile(lat, z) {
  const n = Math.pow(2, z);
  return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
}

function lng2tile(lng, z) {
  const n = Math.pow(2, z);
  return Math.floor((lng + 180) / 360 * n);
}

export function estimateTileCount(sw_lat, sw_lng, ne_lat, ne_lng, minZoom, maxZoom) {
  let count = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const tx1 = lng2tile(sw_lng, z), tx2 = lng2tile(ne_lng, z);
    const ty1 = lat2tile(ne_lat, z), ty2 = lat2tile(sw_lat, z);
    const tilesX = Math.abs(tx2 - tx1) + 1;
    const tilesY = Math.abs(ty2 - ty1) + 1;
    count += tilesX * tilesY;
  }
  return count;
}

const AVG_TILE_KB = 15;
export function estimateStorageMB(tileCount) {
  return Math.round(tileCount * AVG_TILE_KB / 1024);
}

// --- Download engine ---

export async function downloadRegion(sw_lat, sw_lng, ne_lat, ne_lng, minZoom, maxZoom, onProgress, signal) {
  let completed = 0;
  const total = estimateTileCount(sw_lat, sw_lng, ne_lat, ne_lng, minZoom, maxZoom);

  for (let z = minZoom; z <= maxZoom; z++) {
    if (signal?.aborted) break;
    const tx1 = lng2tile(sw_lng, z), tx2 = lng2tile(ne_lng, z);
    const ty1 = lat2tile(ne_lat, z), ty2 = lat2tile(sw_lat, z);
    const minX = Math.min(tx1, tx2), maxX = Math.max(tx1, tx2);
    const minY = Math.min(ty1, ty2), maxY = Math.max(ty1, ty2);

    for (let x = minX; x <= maxX; x++) {
      const batch = [];
      for (let y = minY; y <= maxY; y++) {
        batch.push(
          fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { mode: "no-cors", signal }).catch(() => {})
        );
        if (batch.length >= 10) {
          await Promise.all(batch);
          completed += batch.length;
          batch.length = 0;
          if (onProgress) onProgress(completed, total);
        }
      }
      if (batch.length > 0) {
        await Promise.all(batch);
        completed += batch.length;
        if (onProgress) onProgress(completed, total);
      }
    }
  }

  return { total, completed };
}

// --- Offline Download Modal ---

export function showOfflineDownloadModal(map) {
  if (!map) return;
  const existing = document.getElementById("offline-dl-modal");
  if (existing) { existing.remove(); return; }

  const cur = map.getBounds();
  let selectedBounds = {
    sw_lat: cur.getSouth(), sw_lng: cur.getWest(),
    ne_lat: cur.getNorth(), ne_lng: cur.getEast(),
  };

  const rel = (v) => v.toFixed(4);

  const ov = document.createElement("div");
  ov.id = "offline-dl-modal";
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";

  function buildSelect(id, defVal) {
    let opts = "";
    for (let i = 6; i <= 18; i++) {
      opts += `<option value="${i}" ${i === defVal ? "selected" : ""}>Zoom ${i}</option>`;
    }
    return `<select id="${id}" style="padding:4px;border:1px solid var(--border);border-radius:3px;font-size:13px;background:var(--bg-input);color:var(--text);">${opts}</select>`;
  }

  function updateEstimate() {
    const minZ = parseInt(document.getElementById("offline-minzoom")?.value || "10");
    const maxZ = parseInt(document.getElementById("offline-maxzoom")?.value || "16");
    const count = estimateTileCount(selectedBounds.sw_lat, selectedBounds.sw_lng, selectedBounds.ne_lat, selectedBounds.ne_lng, minZ, maxZ);
    const mb = estimateStorageMB(count);
    const el = document.getElementById("offline-estimate");
    if (el) el.textContent = `~${count.toLocaleString()} tiles \u00b7 ~${mb} MB`;
  }

  function renderAreaInfo() {
    const el = document.getElementById("offline-area-info");
    if (el) el.innerHTML = `Area: ${rel(selectedBounds.sw_lat)},${rel(selectedBounds.sw_lng)} \u2192 ${rel(selectedBounds.ne_lat)},${rel(selectedBounds.ne_lng)} <button id="offline-use-viewport" style="border:none;background:none;color:#2563eb;cursor:pointer;font-size:11px;padding:0;margin-left:6px;">Use current view</button>`;
    // Re-wire button since we just replaced it
    setTimeout(() => {
      document.getElementById("offline-use-viewport")?.addEventListener("click", () => {
        const b = map.getBounds();
        selectedBounds = { sw_lat: b.getSouth(), sw_lng: b.getWest(), ne_lat: b.getNorth(), ne_lng: b.getEast() };
        renderAreaInfo();
        updateEstimate();
      });
    }, 0);
  }

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:380px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 8px;">Download Offline Map</h3>
    <div id="offline-area-info" style="font-size:11px;color:var(--text-dim);margin-bottom:8px;"></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
      <span style="font-size:13px;">From:</span>${buildSelect("offline-minzoom", 10)}
      <span style="font-size:13px;">To:</span>${buildSelect("offline-maxzoom", 16)}
    </div>
    <div style="font-size:13px;margin-bottom:8px;color:var(--text-dim);">
      <input id="offline-name" placeholder="Region name (optional)" style="width:100%;padding:5px;border:1px solid var(--border);border-radius:3px;font-size:13px;box-sizing:border-box;background:var(--bg-input);color:var(--text);" />
    </div>
    <div id="offline-estimate" style="font-size:14px;font-weight:600;margin-bottom:10px;"></div>
    <button id="offline-dl-start" style="display:block;width:100%;padding:8px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:14px;margin-bottom:6px;">Start Download</button>
    <button id="offline-dl-manage" style="display:block;width:100%;padding:6px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:4px;cursor:pointer;font-size:12px;">Manage Offline Maps</button>
    <button id="offline-dl-cancel" style="display:block;width:100%;padding:6px;margin-top:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:13px;">Cancel</button>
  </div>`;
  document.body.appendChild(ov);

  renderAreaInfo();
  updateEstimate();

  const clean = () => ov.remove();
  ov.onclick = (e) => { if (e.target === ov) clean(); };
  document.getElementById("offline-dl-cancel").onclick = clean;
  document.getElementById("offline-minzoom").onchange = updateEstimate;
  document.getElementById("offline-maxzoom").onchange = updateEstimate;

  document.getElementById("offline-dl-manage").onclick = () => {
    clean();
    showOfflineManagerModal();
  };

  document.getElementById("offline-dl-start").onclick = async () => {
    const minZ = parseInt(document.getElementById("offline-minzoom").value);
    const maxZ = parseInt(document.getElementById("offline-maxzoom").value);
    const name = document.getElementById("offline-name").value.trim() || "Region " + new Date().toLocaleDateString();
    if (minZ > maxZ) { toast("Min zoom must be \u2264 max zoom", "#dc2626"); return; }

    const tileCount = estimateTileCount(selectedBounds.sw_lat, selectedBounds.sw_lng, selectedBounds.ne_lat, selectedBounds.ne_lng, minZ, maxZ);
    const estMB = estimateStorageMB(tileCount);

    try {
      const est = await navigator.storage.estimate();
      const freeMB = Math.round((est.quota - est.usage) / 1024 / 1024);
      if (estMB > freeMB * 0.9) {
        toast(`Low storage: ${freeMB}MB free, need ~${estMB}MB`, "#f97316");
        return;
      }
    } catch (_) {}

    const ok = await confirmDialog(`Download ~${tileCount.toLocaleString()} tiles (~${estMB} MB) for offline use?`);
    if (!ok) return;

    clean();
    const prog = showProgressDialog("Downloading tiles...");
    const controller = new AbortController();
    const regionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    try {
      const { completed } = await downloadRegion(
        selectedBounds.sw_lat, selectedBounds.sw_lng, selectedBounds.ne_lat, selectedBounds.ne_lng,
        minZ, maxZ,
        (done, total) => prog.update(Math.round(done / total * 90), `Downloaded ${done}/${total} tiles`),
        controller.signal
      );

      prog.update(95, "Saving...");
      await DB.saveOfflineRegion({
        id: regionId,
        name,
        sw_lat: selectedBounds.sw_lat, sw_lng: selectedBounds.sw_lng,
        ne_lat: selectedBounds.ne_lat, ne_lng: selectedBounds.ne_lng,
        minZoom: minZ, maxZoom: maxZ,
        tileCount: completed,
        downloadedAt: Date.now(),
        sizeBytes: completed * AVG_TILE_KB * 1024,
      });

      prog.update(100, "Done");
      setTimeout(prog.done, 600);
      toast(`Downloaded ${completed} tiles (~${Math.round(completed * AVG_TILE_KB / 1024)} MB)`, "#16a34a");
    } catch (e) {
      prog.done();
      toast("Download cancelled", "#9ca3af");
    }
  };
}

// --- Offline Manager Modal ---

export function showOfflineManagerModal() {
  const existing = document.getElementById("offline-mgr-modal");
  if (existing) { existing.remove(); return; }

  const ov = document.createElement("div");
  ov.id = "offline-mgr-modal";
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";

  getOfflineRegions().then(async (regions) => {
    const info = await getCacheInfo();

    const items = regions.length === 0
      ? `<div style="text-align:center;color:var(--text-dim);padding:20px;">No offline regions downloaded yet.</div>`
      : regions.map(r => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13px;">${escapeHtml(r.name || "Region")}</div>
          <div style="font-size:11px;color:var(--text-dim);">${r.tileCount} tiles \u00b7 z${r.minZoom}-z${r.maxZoom} \u00b7 ${new Date(r.downloadedAt).toLocaleDateString()}</div>
        </div>
        <button class="offline-delete" data-id="${r.id}" style="padding:3px 8px;border:1px solid #dc2626;color:#dc2626;background:transparent;border-radius:3px;cursor:pointer;font-size:11px;">Delete</button>
      </div>`).join("");

    ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:380px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 4px;">Offline Maps</h3>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">Storage: ${info.usedMB} MB used / ${info.quotaMB} MB quota</div>
      <div id="offline-list">${items}</div>
      <button id="offline-mgr-close" style="display:block;width:100%;padding:7px;margin-top:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:13px;">Close</button>
    </div>`;
    document.body.appendChild(ov);

    const clean = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) clean(); };
    document.getElementById("offline-mgr-close").onclick = clean;

    ov.querySelectorAll(".offline-delete").forEach(btn => {
      btn.onclick = async () => {
        await deleteOfflineRegion(btn.dataset.id);
        clean();
        showOfflineManagerModal();
      };
    });
  });
}
