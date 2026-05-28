import { decrypt_raw_bytes, generate_uuid } from "./core/pkg/e2e_core.js";
import * as DB from "./db.js";
import { state } from "./state.js";
import { escapeHtml, toast, confirmDialog } from "./dialogs.js";
import { t } from "./i18n.js";

// --- Schema system ---

export async function loadSchemasForSet(teamId) {
  try {
    const schemas = await DB.getSchemas();
    state.schemas = schemas || [];
  } catch (_) { state.schemas = []; }
}

function findLayerSchema(layerId) {
  const layer = state.layers.find(l => l.layer_id === layerId);
  if (!layer || !layer.default_schema_id) return null;
  return state.schemas.find(s => s.schema_id === layer.default_schema_id) || null;
}

export function renderSchemaFieldsById(schemaId, containerId, existingCustomDataEnc) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const schema = schemaId ? state.schemas.find(s => s.schema_id === schemaId) : null;
  if (!schema || !schema.fields || schema.fields.length === 0) {
    container.innerHTML = state.schemas.length > 0 ? '<div style="font-size:11px;color:var(--text-dim);">no schema selected</div>' : "";
    return;
  }
  let existingData = {};
  if (existingCustomDataEnc && state.dek) {
    try {
      const raw = decrypt_raw_bytes(existingCustomDataEnc.ciphertext, existingCustomDataEnc.nonce, state.dek);
      existingData = JSON.parse(new TextDecoder().decode(raw));
    } catch (_) {}
  }
  container.innerHTML = `<div style="border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:4px;">
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">📋 ${escapeHtml(schema.name)}</div>
    ${schema.fields.map(f => {
      const val = existingData[f.key] !== undefined ? existingData[f.key] : "";
      const valAttr = escapeHtml(String(val));
      if (f.type === "choice" && f.options) {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <select name="sf_${f.key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">
          ${f.options.map(o => `<option value="${escapeHtml(o)}" ${String(val) === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
          </select></div>`;
      }
      if (f.type === "boolean") {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <select name="sf_${f.key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">
          <option value="true" ${val === "true" || val === true ? "selected" : ""}>true</option>
          <option value="false" ${val === "false" || val === false ? "selected" : ""}>false</option>
          </select></div>`;
      }
      if (f.type === "date") {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="date" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
      }
      if (f.type === "time") {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="time" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
      }
      if (f.type === "number") {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="number" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
      }
      return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
        <input type="text" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
    }).join("")}
  </div>`;
}

function renderSchemaFieldsForLayer(layerSelectId, containerId, existingCustomDataEnc) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sel = document.getElementById(layerSelectId);
  const layerId = sel ? sel.value : null;
  const schema = layerId ? findLayerSchema(layerId) : null;
  if (!schema || !schema.fields || schema.fields.length === 0) {
    container.innerHTML = "";
    return;
  }
  let existingData = {};
  if (existingCustomDataEnc && state.dek) {
    try {
      const raw = decrypt_raw_bytes(existingCustomDataEnc.ciphertext, existingCustomDataEnc.nonce, state.dek);
      existingData = JSON.parse(new TextDecoder().decode(raw));
    } catch (_) {}
  }
  container.innerHTML = `<div style="border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:4px;">
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">📋 ${escapeHtml(schema.name)}</div>
    ${schema.fields.map(f => {
      const val = existingData[f.key] !== undefined ? existingData[f.key] : "";
      const valAttr = escapeHtml(String(val));
      if (f.type === "choice" && f.options) {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <select name="sf_${f.key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">
          ${f.options.map(o => `<option value="${escapeHtml(o)}" ${String(val) === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
          </select></div>`;
      }
      if (f.type === "boolean") {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <select name="sf_${f.key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">
          <option value="true" ${val === "true" || val === true ? "selected" : ""}>true</option>
          <option value="false" ${val === "false" || val === false ? "selected" : ""}>false</option>
          </select></div>`;
      }
      if (f.type === "date") {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="date" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
      }
      if (f.type === "time") {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="time" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
      }
      if (f.type === "number") {
        return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="number" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
      }
      // text (default)
      return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
        <input type="text" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
    }).join("")}
  </div>`;
}

export function collectSchemaData(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container.children.length === 0) return null;
  const data = {};
  const inputs = container.querySelectorAll("[name^='sf_']");
  let hasAny = false;
  inputs.forEach(el => {
    const key = el.name.slice(3);
    const val = el.value;
    if (val !== "" && val !== null && val !== undefined) hasAny = true;
    data[key] = val;
  });
  return hasAny ? data : null;
}

export function buildCustomDataHTML(pinData, customDataEnc, layerId, layerName, pinSchemaId) {
  if (!customDataEnc || !state.dek) return "";
  try {
    const raw = decrypt_raw_bytes(customDataEnc.ciphertext, customDataEnc.nonce, state.dek);
    const data = JSON.parse(new TextDecoder().decode(raw));
    if (!data || Object.keys(data).length === 0) return "";
    const schema = pinSchemaId ? state.schemas.find(s => s.schema_id === pinSchemaId) : (layerId ? findLayerSchema(layerId) : null);
    const fields = schema ? schema.fields : null;
    const rows = Object.entries(data).map(([key, val]) => {
      const field = fields ? fields.find(f => f.key === key) : null;
      const label = field ? field.label : key;
      const displayVal = field?.type === "boolean" ? (val === "true" || val === true ? "✓" : "✗") : String(val);
      return `<div style="font-size:11px;color:var(--text-dim);"><b>${escapeHtml(label)}:</b> ${escapeHtml(displayVal)}</div>`;
    }).join("");
    return `<div style="margin:4px 0;padding:4px 6px;background:var(--bg-input);border-radius:3px;border:1px solid var(--border-light);">${rows}</div>`;
  } catch (_) { return ""; }
}

export function showSchemaManagerModal() {
  if (!state.currentSet) return;
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";

  function renderList() {
    const rows = state.schemas.length > 0
      ? state.schemas.map(s => {
        const fieldCount = s.fields ? s.fields.length : 0;
        const layers = state.layers.filter(l => l.default_schema_id === s.schema_id);
        const layerNames = layers.map(l => l.name).join(", ");
        return `<div class="schema-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border-light);">
          <div style="flex:1;">
            <span style="font-size:13px;font-weight:500;">📋 ${escapeHtml(s.name)}</span>
            <span style="font-size:10px;color:var(--text-dim);margin-left:8px;">${fieldCount} field${fieldCount !== 1 ? "s" : ""}</span>
            ${layerNames ? `<br><span style="font-size:10px;color:var(--text-dim);">used by: ${escapeHtml(layerNames)}</span>` : ""}
          </div>
          <button class="sch-edit-btn" data-id="${s.schema_id}" style="padding:3px 8px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:12px;">✎</button>
          <button class="sch-del-btn" data-id="${s.schema_id}" style="padding:3px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:14px;line-height:1;">×</button>
        </div>`;
      }).join("")
      : '<div style="padding:12px;color:var(--text-dim);text-align:center;">No schemas defined yet</div>';
    listEl.innerHTML = rows;

    listEl.querySelectorAll(".sch-edit-btn").forEach(btn => {
      btn.onclick = () => {
        showSchemaEditorModal(btn.dataset.id);
        ov.remove();
      };
    });
    listEl.querySelectorAll(".sch-del-btn").forEach(btn => {
      btn.onclick = async () => {
        if (!(await confirmDialog("Delete schema? Existing pins keep their data."))) return;
        await DB.deleteSchema(btn.dataset.id);
        // Clear schema reference on layers
        for (const l of state.layers) {
          if (l.default_schema_id === btn.dataset.id) l.default_schema_id = null;
        }
        await DB.saveLayers(state.currentSet, state.layers);
        await loadSchemasForSet(state.currentSet);
        renderList();
        window._renderUI?.();
      };
    });
  }

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:360px;max-width:440px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">📋 ${t("schemas") || "Schemas"}</h3>
      <button id="sch-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <p style="font-size:11px;color:var(--text-dim);margin:0 0 8px;">Define custom data structures. Assign schemas to layers for custom pin forms.</p>
    <div id="sch-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;margin-bottom:8px;"></div>
    <button id="sch-new-btn" style="width:100%;padding:8px;border:1px dashed #059669;background:transparent;color:#059669;border-radius:4px;cursor:pointer;font-size:13px;">+ ${t("newSchema") || "New Schema"}</button>
  </div>`;

  document.body.appendChild(ov);

  const listEl = document.getElementById("sch-list");
  const clean = () => ov.remove();
  document.getElementById("sch-close").onclick = clean;
  ov.onclick = (e) => { if (e.target === ov) clean(); };

  document.getElementById("sch-new-btn").onclick = () => {
    showSchemaEditorModal(null);
    ov.remove();
  };

  renderList();
}

export function showSchemaEditorModal(schemaId) {
  if (!state.currentSet) return;
  const existing = schemaId ? state.schemas.find(s => s.schema_id === schemaId) : null;
  const fields = existing ? [...existing.fields] : [];

  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";

  function renderFieldsList() {
    const rows = fields.map((f, i) => `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border-light);">
        <span style="font-size:11px;color:var(--text-dim);min-width:24px;">#${i + 1}</span>
        <input class="sch-fname" data-i="${i}" value="${escapeHtml(f.label)}" placeholder="Field label" style="flex:1;padding:3px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;" />
        <select class="sch-ftype" data-i="${i}" style="padding:3px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">
          <option value="text" ${f.type === "text" ? "selected" : ""}>text</option>
          <option value="number" ${f.type === "number" ? "selected" : ""}>number</option>
          <option value="choice" ${f.type === "choice" ? "selected" : ""}>choice</option>
          <option value="date" ${f.type === "date" ? "selected" : ""}>date</option>
          <option value="time" ${f.type === "time" ? "selected" : ""}>time</option>
          <option value="boolean" ${f.type === "boolean" ? "selected" : ""}>boolean</option>
          <option value="cross_reference" ${f.type === "cross_reference" ? "selected" : ""}>cross-reference</option>
        </select>
        <button class="sch-fup" data-i="${i}" style="padding:1px 4px;border:none;background:none;color:var(--text-dim);cursor:pointer;font-size:12px;${i === 0 ? "visibility:hidden;" : ""}">▲</button>
        <button class="sch-fdown" data-i="${i}" style="padding:1px 4px;border:none;background:none;color:var(--text-dim);cursor:pointer;font-size:12px;${i === fields.length - 1 ? "visibility:hidden;" : ""}">▼</button>
        <button class="sch-fdel" data-i="${i}" style="padding:2px 6px;border:none;background:none;color:#dc2626;cursor:pointer;font-size:14px;">×</button>
      </div>
      <div class="sch-choice-opts" data-i="${i}" style="${f.type === "choice" ? "" : "display:none;"}padding:2px 0 4px 70px;font-size:11px;">
        <span style="color:var(--text-dim);">options (comma):</span>
        <input class="sch-fopts" data-i="${i}" value="${escapeHtml((f.options || []).join(", "))}" style="width:calc(100% - 120px);margin-left:4px;padding:3px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;" />
      </div>
    `).join("");
    document.getElementById("sch-fields-list").innerHTML = rows || '<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:8px;">No fields yet — add one below</div>';

    document.querySelectorAll(".sch-fdel").forEach(btn => {
      btn.onclick = () => {
        fields.splice(parseInt(btn.dataset.i), 1);
        renderFieldsList();
      };
    });
    document.querySelectorAll(".sch-fup").forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.i);
        if (i > 0) { [fields[i], fields[i - 1]] = [fields[i - 1], fields[i]]; renderFieldsList(); }
      };
    });
    document.querySelectorAll(".sch-fdown").forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.i);
        if (i < fields.length - 1) { [fields[i], fields[i + 1]] = [fields[i + 1], fields[i]]; renderFieldsList(); }
      };
    });
    document.querySelectorAll(".sch-fname").forEach(inp => {
      inp.onchange = () => { fields[parseInt(inp.dataset.i)].label = inp.value; };
    });
    document.querySelectorAll(".sch-ftype").forEach(sel => {
      sel.onchange = () => {
        const i = parseInt(sel.dataset.i);
        fields[i].type = sel.value;
        if (sel.value !== "choice") fields[i].options = undefined;
        else fields[i].options = fields[i].options || [];
        renderFieldsList();
      };
    });
    document.querySelectorAll(".sch-fname").forEach(inp => {
      inp.onchange = () => { fields[parseInt(inp.dataset.i)].label = inp.value; };
    });
    document.querySelectorAll(".sch-fopts").forEach(inp => {
      inp.onchange = () => {
        const i = parseInt(inp.dataset.i);
        fields[i].options = inp.value.split(",").map(s => s.trim()).filter(Boolean);
      };
    });
  }

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:420px;max-width:520px;width:95%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">${existing ? (t("editSchema") || "Edit Schema") : (t("newSchema") || "New Schema")}</h3>
      <button id="sched-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <input id="sched-name" value="${escapeHtml(existing ? existing.name : "")}" placeholder="Schema name" style="width:100%;padding:6px;margin-bottom:8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;box-sizing:border-box;" />
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Fields</div>
    <div id="sch-fields-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:60px;max-height:180px;padding:4px 6px;margin-bottom:8px;"></div>
    <button id="sched-add-field" style="width:100%;padding:6px;border:1px dashed var(--border);background:transparent;color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;margin-bottom:8px;">+ Add Field</button>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="sched-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:13px;">${t("cancel")}</button>
      <button id="sched-save" style="padding:6px 14px;border:none;background:#059669;color:white;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;">${t("save")}</button>
    </div>
  </div>`;

  document.body.appendChild(ov);

  const clean = () => ov.remove();
  document.getElementById("sched-close").onclick = clean;
  document.getElementById("sched-cancel").onclick = clean;
  ov.onclick = (e) => { if (e.target === ov) clean(); };

  document.getElementById("sched-add-field").onclick = () => {
    const idx = fields.length + 1;
    fields.push({ key: "f" + idx, label: "Field " + idx, type: "text" });
    renderFieldsList();
  };

  document.getElementById("sched-save").onclick = async () => {
    const name = document.getElementById("sched-name").value.trim();
    if (!name) { toast("Schema name required", "#f97316"); return; }
    // Collect field data and auto-generate keys
    document.querySelectorAll(".sch-fname").forEach(inp => {
      const i = parseInt(inp.dataset.i);
      fields[i].label = inp.value || fields[i].label;
      if (!fields[i].key || /^f\d+$/.test(fields[i].key)) {
        fields[i].key = (inp.value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || ("f" + (i + 1));
      }
    });
    document.querySelectorAll(".sch-fopts").forEach(inp => {
      const i = parseInt(inp.dataset.i);
      fields[i].options = inp.value.split(",").map(s => s.trim()).filter(Boolean);
    });
    const sid = existing ? existing.schema_id : generate_uuid();
    const schema = {
      schema_id: sid,
      name,
      fields: fields.filter(f => f.key && f.label),
      community_id: existing?.community_id || state.currentSet || null,
    };
    await DB.saveSchema(schema);
    await loadSchemasForSet(state.currentSet);
    clean();
    showSchemaManagerModal();
    window._renderUI?.();
    toast(schema.name + " saved", "#16a34a");
  };

  renderFieldsList();
}
