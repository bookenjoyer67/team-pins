import {
  encrypt_pin_data,
  decrypt_pin_data,
  encrypt_geojson,
  decrypt_geojson,
  encrypt_raw_bytes,
  decrypt_raw_bytes,
  generate_uuid,
} from "./core/pkg/e2e_core.js";
import * as DB from "./db.js";
import { state } from "./state.js";
import { escapeHtml, toast, showProgressDialog } from "./dialogs.js";
import { t } from "./i18n.js";
import { loadSchemasForSet } from "./map-schemas.js";
import { loadPins, loadDrawings } from "./map.js";

// --- Import from another map ---

export async function importLayerFromMap(sourceTeamId, sourceLayerId, targetLayerId, sourceSchemas) {
  if (!state.dek || !state.currentSet) return;

  const srcTeam = await DB.getTeam(sourceTeamId);
  if (!srcTeam) { toast("Cannot access source map", "#dc2626"); return; }
  const srcDek = window._unwrap_dek(srcTeam.wrapped_dek, srcTeam.secret_key);
  if (!srcDek) { toast("Cannot decrypt source map", "#dc2626"); return; }

  let importedPins = 0, importedDrawings = 0;
  let erroredPins = 0, erroredDrawings = 0;

  const allPins = await DB.getPins(sourceTeamId);
  const allDrawings = await DB.getDrawings(sourceTeamId);
  const sourcePins = allPins.filter(p => p.layer_id === sourceLayerId || (!p.layer_id && !sourceLayerId));
  const sourceDrawings = allDrawings.filter(d => d.layer_id === sourceLayerId || (!d.layer_id && !sourceLayerId));

  const totalItems = sourcePins.length + sourceDrawings.length;
  const prog = totalItems > 20 ? showProgressDialog("Importing...") : null;
  let done = 0;

  for (const row of sourcePins) {
    try {
      const pin = decrypt_pin_data(row.ciphertext, row.nonce, srcDek);
      const enc = encrypt_pin_data(pin.title, pin.note, pin.lat, pin.lng, pin.color || "#2563eb", state.dek);
      const newPin = {
        pin_id: generate_uuid(),
        team_id: state.currentSet,
        layer_id: targetLayerId || (state.layers[0] ? state.layers[0].layer_id : null),
        ciphertext: enc.ciphertext,
        nonce: enc.nonce,
        created_at: Date.now(),
        map_zoom: row.map_zoom || 13,
      };
      if (row.emoji) newPin.emoji = row.emoji;
      const tgtLayer = state.layers.find(l => l.layer_id === targetLayerId);
      if (tgtLayer && tgtLayer.default_schema_id) newPin.schema_id = tgtLayer.default_schema_id;
      else if (row.schema_id) newPin.schema_id = row.schema_id;
      if (row.custom_data) {
        const decCustom = decrypt_raw_bytes(row.custom_data.ciphertext, row.custom_data.nonce, srcDek);
        const encCustom = encrypt_raw_bytes(decCustom, state.dek);
        newPin.custom_data = { ciphertext: encCustom.ciphertext, nonce: encCustom.nonce };
      }
      if (row.media) {
        const decMedia = decrypt_raw_bytes(row.media.ciphertext, row.media.nonce, srcDek);
        const encMedia = encrypt_raw_bytes(decMedia, state.dek);
        newPin.media = { type: row.media.type, name: row.media.name, ciphertext: encMedia.ciphertext, nonce: encMedia.nonce };
      }
      await DB.savePin(newPin);
      importedPins++;
    } catch (_) { erroredPins++; }
    done++;
    if (prog && done % 5 === 0) prog.update(Math.round(done / totalItems * 90), `Importing ${done}/${totalItems}`);
  }

  for (const row of sourceDrawings) {
    try {
      const g = JSON.parse(decrypt_geojson(row.encrypted_geojson, row.nonce, srcDek));
      const enc = encrypt_geojson(JSON.stringify(g), state.dek);
      const newDrawing = {
        drawing_id: generate_uuid(),
        team_id: state.currentSet,
        layer_id: targetLayerId || (state.layers[0] ? state.layers[0].layer_id : null),
        encrypted_geojson: enc.ciphertext,
        nonce: enc.nonce,
      };
      const tgtLayer2 = state.layers.find(l => l.layer_id === targetLayerId);
      if (tgtLayer2 && tgtLayer2.default_schema_id) newDrawing.schema_id = tgtLayer2.default_schema_id;
      else if (row.schema_id) newDrawing.schema_id = row.schema_id;
      if (row.custom_data) {
        const decCustom = decrypt_raw_bytes(row.custom_data.ciphertext, row.custom_data.nonce, srcDek);
        const encCustom = encrypt_raw_bytes(decCustom, state.dek);
        newDrawing.custom_data = { ciphertext: encCustom.ciphertext, nonce: encCustom.nonce };
      }
      if (row.media) {
        const decMedia = decrypt_raw_bytes(row.media.ciphertext, row.media.nonce, srcDek);
        const encMedia = encrypt_raw_bytes(decMedia, state.dek);
        newDrawing.media = { type: row.media.type, name: row.media.name, ciphertext: encMedia.ciphertext, nonce: encMedia.nonce };
      }
      await DB.saveDrawing(newDrawing);
      importedDrawings++;
    } catch (_) { erroredDrawings++; }
    done++;
    if (prog && done % 5 === 0) prog.update(Math.round(done / totalItems * 90), `Importing ${done}/${totalItems}`);
  }

  if (prog) prog.done();

  await loadPins();
  await loadDrawings();

  // Import source schemas into global pool
  const allSchemas = await DB.getSchemas();
  const schemaIds = new Set();
  for (const p of sourcePins) { if (p.schema_id) schemaIds.add(p.schema_id); }
  for (const d of sourceDrawings) { if (d.schema_id) schemaIds.add(d.schema_id); }
  for (const sid of schemaIds) {
    if (!allSchemas.find(s => s.schema_id === sid)) {
      const srcSchema = sourceSchemas?.find(s => s.schema_id === sid);
      if (srcSchema) await DB.saveSchema({ schema_id: srcSchema.schema_id, name: srcSchema.name, fields: srcSchema.fields || [] });
    }
  }
  await loadSchemasForSet(state.currentSet);

  window._renderUI?.();
  let msg = `Imported ${importedPins} pin${importedPins !== 1 ? "s" : ""}, ${importedDrawings} drawing${importedDrawings !== 1 ? "s" : ""}`;
  if (erroredPins + erroredDrawings > 0) msg += ` (${erroredPins + erroredDrawings} skipped)`;
  toast(msg, (importedPins + importedDrawings > 0) ? "#16a34a" : "#f97316");
}

export function showImportFromMapModal() {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";

  let sourceLayers = [], sourcePins = [], sourceDrawings = [], sourceSchemas = [];
  let selectedTeamId = null, selectedSourceLayerId = null;

  function renderSourceLayers() {
    if (!sourceLayers.length) {
      listEl.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:16px;font-size:12px;">No layers in source map</div>';
      return;
    }
    const rows = sourceLayers.map(layer => {
      const pinCount = sourcePins.filter(p => p.layer_id === layer.layer_id || (!p.layer_id && !layer.layer_id)).length;
      const dwgCount = sourceDrawings.filter(d => d.layer_id === layer.layer_id || (!d.layer_id && !layer.layer_id)).length;
      const sel = layer.layer_id === selectedSourceLayerId ? "selected" : "";
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-light);cursor:pointer;" class="im-layer-row" data-id="${layer.layer_id}">
        <span class="layer-dot" style="background:${layer.color || '#7c3aed'};${sel ? 'box-shadow:0 0 0 2px #2563eb;' : ''}"></span>
        <span style="flex:1;font-size:13px;${sel ? 'font-weight:600;' : ''}">${escapeHtml(layer.name)}</span>
        <span style="font-size:11px;color:var(--text-dim);">${pinCount} pin${pinCount !== 1 ? 's' : ''}${dwgCount ? ', ' + dwgCount + ' drawing' + (dwgCount !== 1 ? 's' : '') : ''}</span>
      </div>`;
    }).join("");
    listEl.innerHTML = rows;

    listEl.querySelectorAll(".im-layer-row").forEach(row => {
      row.onclick = () => {
        selectedSourceLayerId = row.dataset.id;
        renderSourceLayers();
      };
    });
  }

  function buildMapSelect() {
    const ids = Object.keys(window._names || {});
    return ids.filter(id => id !== state.currentSet).length > 0
      ? ids.filter(id => id !== state.currentSet).map(id => `<option value="${id}" ${id === selectedTeamId ? "selected" : ""}>${escapeHtml((window._names[id] || id).slice(0, 30))}</option>`).join("")
      : '<option value="" disabled>No other maps available</option>';
  }

  const layerOpts = state.layers.map(l => `<option value="${l.layer_id}">${escapeHtml(l.name)}</option>`).join("");

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:340px;max-width:420px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">📥 ${t("importFromMap") || "Import from Map"}</h3>
      <button id="im-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div style="margin-bottom:4px;font-size:12px;color:var(--text-dim);">${t("importSourceMap") || "Source map:"}</div>
    <select id="im-map-select" style="width:100%;padding:6px;margin-bottom:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${buildMapSelect()}</select>
    <div style="margin-bottom:4px;font-size:12px;color:var(--text-dim);">${t("importSourceLayer") || "Source layer:"}</div>
    <div id="im-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;max-height:200px;padding:4px 8px;margin-bottom:8px;">
      <div style="color:var(--text-dim);text-align:center;padding:16px;font-size:12px;">${t("importSelectMap") || "Select a source map above"}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <span style="font-size:12px;color:var(--text-dim);">${t("targetLayer") || "To layer:"}</span>
      <select id="im-target-layer" style="flex:1;padding:5px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${layerOpts}</select>
    </div>
    <button id="im-do-btn" style="width:100%;padding:10px;border:none;background:#16a34a;color:white;border-radius:4px;cursor:pointer;font-size:14px;font-weight:600;">${t("importLayer") || "Import Layer"}</button>
  </div>`;

  document.body.appendChild(ov);

  const listEl = document.getElementById("im-list");
  const clean = () => { ov.remove(); delete window._importSrcDek; };

  document.getElementById("im-close").onclick = clean;
  ov.onclick = (e) => { if (e.target === ov) clean(); };

  const mapSelect = document.getElementById("im-map-select");
  if (mapSelect && mapSelect.options.length > 0 && !mapSelect.options[0].disabled) {
    mapSelect.dispatchEvent(new Event("change"));
  }

  document.getElementById("im-map-select").onchange = async () => {
    const tid = document.getElementById("im-map-select").value;
    if (!tid) { sourceLayers = []; sourcePins = []; sourceDrawings = []; listEl.innerHTML = ""; return; }
    selectedTeamId = tid;
    selectedSourceLayerId = null;
    listEl.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:16px;font-size:12px;">Loading...</div>';
    try {
      const t = await DB.getTeam(tid);
      if (!t) { listEl.innerHTML = '<div style="color:#dc2626;text-align:center;padding:16px;font-size:12px;">Cannot read source map</div>'; return; }
      window._importSrcDek = window._unwrap_dek(t.wrapped_dek, t.secret_key);
      sourcePins = await DB.getPins(tid);
      sourceDrawings = await DB.getDrawings(tid);
      sourceSchemas = await DB.getSchemas();
      sourceLayers = await DB.getLayers(tid) || [];
      if (sourceLayers.length === 0) {
        sourceLayers = [{ layer_id: null, name: "Default", color: "#7c3aed", visible: true, opacity: 1.0 }];
      }
      renderSourceLayers();
    } catch (e) {
      listEl.innerHTML = `<div style="color:#dc2626;text-align:center;padding:16px;font-size:12px;">Error: ${escapeHtml(e.message || "unknown")}</div>`;
    }
  };

  document.getElementById("im-do-btn").onclick = async () => {
    if (!selectedTeamId) { toast("No source map selected", "#f97316"); return; }
    const sourceLayer = selectedSourceLayerId || (sourceLayers[0] ? sourceLayers[0].layer_id : null);
    const targetLayer = document.getElementById("im-target-layer").value;
    clean();
    await importLayerFromMap(selectedTeamId, sourceLayer, targetLayer, sourceSchemas);
  };
}
