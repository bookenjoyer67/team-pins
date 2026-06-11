import { A as generate_dek, C as detect_freehand_shape, D as encrypt_pin_data, E as encrypt_geojson, F as generate_uuid, L as sign, N as generate_user_keypair, O as encrypt_raw_bytes, R as simplify_freehand, V as wrap_dek, b as decrypt_raw_bytes, g as decrypt_annotation, p as compute_geometry, s as base64url_encode, v as decrypt_geojson, w as encode_hex, y as decrypt_pin_data, z as unwrap_dek } from "./e2e_core2.js";
import { $ as saveSchema, A as getPinsByLayer, C as getCommunity, D as getLayers, G as saveChain, H as renameTeam, I as getTeam, J as saveDrawing$1, K as saveCollection, L as getTombstoneTargetIds, M as getSchemas, N as getSettings, S as getCollections, T as getDrawings, V as importPins, X as saveLayers, Z as savePin$1, a as deleteDrawing$1, b as getChainsByCommunity, et as saveSettings, h as getAllTeams, i as deleteCollection, k as getPins, l as deleteSchema, m as getAllSubscribedLayers, n as deleteAnnotation, ot as updateDrawingLayerId, q as saveCommunity, r as deleteChain, rt as saveTeam, s as deletePin$1, st as updatePinLayerId, t as addPinToCollection, u as deleteTeam, v as getAnnotationsByPin, x as getCollectionPins, y as getChain } from "./db2.js";
import { t as state } from "./state.js";
import { a as promptRoomPassword, i as hashCommunityPassword, l as showProgressDialog, m as toast, n as confirmDialog, o as promptSetPassword, r as escapeHtml } from "./dialogs.js";
import { a as t, r as getTutorialPin } from "./i18n.js";
import { t as leaflet_shim_default } from "./leaflet-shim.js";
import { a as validateHex, i as hueDotHTML, n as colorPresetsHTML, o as wireColorPicker, r as hexInputHTML, t as COLORS } from "./helpers.js";
import { a as indexMarker, n as clearMarkerGrid } from "./gossip2.js";
import { a as isRoutingActive, t as addWaypoint } from "./map-routing2.js";
import { i as pinTrustIndicator, n as computePinTrust, o as trustScoreColor, t as computeAnnotationScore } from "./trust2.js";
//#region map-schemas.js
async function loadSchemasForSet(teamId) {
	try {
		state.schemas = await getSchemas() || [];
	} catch (_) {
		state.schemas = [];
	}
}
function findLayerSchema(layerId) {
	const layer = state.layers.find((l) => l.layer_id === layerId);
	if (!layer || !layer.default_schema_id) return null;
	return state.schemas.find((s) => s.schema_id === layer.default_schema_id) || null;
}
function renderSchemaFieldsById(schemaId, containerId, existingCustomDataEnc) {
	const container = document.getElementById(containerId);
	if (!container) return;
	const schema = schemaId ? state.schemas.find((s) => s.schema_id === schemaId) : null;
	if (!schema || !schema.fields || schema.fields.length === 0) {
		container.innerHTML = state.schemas.length > 0 ? "<div style=\"font-size:11px;color:var(--text-dim);\">no schema selected</div>" : "";
		return;
	}
	let existingData = {};
	if (existingCustomDataEnc && state.dek) try {
		const raw = decrypt_raw_bytes(existingCustomDataEnc.ciphertext, existingCustomDataEnc.nonce, state.dek);
		existingData = JSON.parse(new TextDecoder().decode(raw));
	} catch (_) {}
	container.innerHTML = `<div style="border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:4px;">
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">📋 ${escapeHtml(schema.name)}</div>
    ${schema.fields.map((f) => {
		const val = existingData[f.key] !== void 0 ? existingData[f.key] : "";
		const valAttr = escapeHtml(String(val));
		if (f.type === "choice" && f.options) return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <select name="sf_${f.key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">
          ${f.options.map((o) => `<option value="${escapeHtml(o)}" ${String(val) === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
          </select></div>`;
		if (f.type === "boolean") return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <select name="sf_${f.key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">
          <option value="true" ${val === "true" || val === true ? "selected" : ""}>true</option>
          <option value="false" ${val === "false" || val === false ? "selected" : ""}>false</option>
          </select></div>`;
		if (f.type === "date") return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="date" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
		if (f.type === "time") return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="time" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
		if (f.type === "array_time") {
			const times = Array.isArray(val) ? val : val ? [val] : [];
			const key = f.key;
			return `<div style="margin-bottom:4px;">
          <span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <div class="sf-array" data-key="${escapeHtml(key)}">
            ${times.map((t, i) => `<div class="sf-array-row" style="display:flex;gap:4px;margin-top:2px;">
              <input type="time" name="sf_${escapeHtml(key)}[]" value="${escapeHtml(String(t))}" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" />
              <button type="button" class="sf-array-rm" style="padding:2px 6px;border:1px solid #dc2626;background:transparent;color:#dc2626;border-radius:3px;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;">×</button>
            </div>`).join("")}
            <button type="button" class="sf-array-add" style="margin-top:3px;padding:2px 8px;border:1px dashed var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;width:100%;">+ Add</button>
          </div>
        </div>`;
		}
		if (f.type === "number") return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
          <input type="number" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
		return `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span>
        <input type="text" name="sf_${f.key}" value="${valAttr}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
	}).join("")}
  </div>`;
	container.querySelectorAll(".sf-array-add").forEach((btn) => {
		btn.onclick = () => {
			const ct = btn.closest(".sf-array");
			const key = ct.dataset.key;
			const row = document.createElement("div");
			row.className = "sf-array-row";
			row.style.cssText = "display:flex;gap:4px;margin-top:2px;";
			row.innerHTML = `<input type="time" name="sf_${escapeHtml(key)}[]" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /><button type="button" class="sf-array-rm" style="padding:2px 6px;border:1px solid #dc2626;background:transparent;color:#dc2626;border-radius:3px;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;">×</button>`;
			ct.insertBefore(row, btn);
			row.querySelector(".sf-array-rm").onclick = () => row.remove();
		};
	});
	container.querySelectorAll(".sf-array-rm").forEach((btn) => {
		btn.onclick = () => btn.closest(".sf-array-row").remove();
	});
}
function collectSchemaData(containerId) {
	const container = document.getElementById(containerId);
	if (!container || container.children.length === 0) return null;
	const data = {};
	const inputs = container.querySelectorAll("[name^='sf_']:not([name$='[]'])");
	let hasAny = false;
	inputs.forEach((el) => {
		const key = el.name.slice(3);
		const val = el.value;
		if (val !== "" && val !== null && val !== void 0) hasAny = true;
		data[key] = val;
	});
	container.querySelectorAll(".sf-array").forEach((ct) => {
		const key = ct.dataset.key;
		const vals = Array.from(ct.querySelectorAll("input")).map((el) => el.value.trim()).filter(Boolean);
		if (vals.length > 0) {
			data[key] = vals;
			hasAny = true;
		}
	});
	return hasAny ? data : null;
}
function buildCustomDataHTML(pinData, customDataEnc, layerId, layerName, pinSchemaId) {
	if (!customDataEnc || !state.dek) return "";
	try {
		const raw = decrypt_raw_bytes(customDataEnc.ciphertext, customDataEnc.nonce, state.dek);
		const data = JSON.parse(new TextDecoder().decode(raw));
		if (!data || Object.keys(data).length === 0) return "";
		const schema = pinSchemaId ? state.schemas.find((s) => s.schema_id === pinSchemaId) : layerId ? findLayerSchema(layerId) : null;
		const fields = schema ? schema.fields : null;
		return `<div style="margin:4px 0;padding:4px 6px;background:var(--bg-input);border-radius:3px;border:1px solid var(--border-light);">${Object.entries(data).map(([key, val]) => {
			const field = fields ? fields.find((f) => f.key === key) : null;
			const label = field ? field.label : key;
			const displayVal = field?.type === "boolean" ? val === "true" || val === true ? "✓" : "✗" : field?.type === "array_time" ? Array.isArray(val) ? `<span style="font-size:11px;">${val.map((v) => `<span style="background:var(--bg-card);color:var(--text);padding:1px 5px;border-radius:2px;margin:1px;display:inline-block;border:1px solid var(--border-light);">${escapeHtml(String(v))}</span>`).join("")}</span>` : String(val) : String(val);
			const isArrayHtml = field?.type === "array_time" && Array.isArray(val);
			return `<div style="font-size:11px;color:var(--text-dim);"><b>${escapeHtml(label)}:</b> ${isArrayHtml ? displayVal : escapeHtml(displayVal)}</div>`;
		}).join("")}</div>`;
	} catch (_) {
		return "";
	}
}
function showSchemaManagerModal() {
	if (!state.currentSet) return;
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	function renderList() {
		listEl.innerHTML = state.schemas.length > 0 ? state.schemas.map((s) => {
			const fieldCount = s.fields ? s.fields.length : 0;
			const layerNames = state.layers.filter((l) => l.default_schema_id === s.schema_id).map((l) => l.name).join(", ");
			return `<div class="schema-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border-light);">
          <div style="flex:1;">
            <span style="font-size:13px;font-weight:500;">📋 ${escapeHtml(s.name)}</span>
            <span style="font-size:10px;color:var(--text-dim);margin-left:8px;">${fieldCount} field${fieldCount !== 1 ? "s" : ""}</span>
            ${layerNames ? `<br><span style="font-size:10px;color:var(--text-dim);">used by: ${escapeHtml(layerNames)}</span>` : ""}
          </div>
          <button class="sch-edit-btn" data-id="${s.schema_id}" style="padding:3px 8px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:12px;">✎</button>
          <button class="sch-del-btn" data-id="${s.schema_id}" style="padding:3px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:14px;line-height:1;">×</button>
        </div>`;
		}).join("") : "<div style=\"padding:12px;color:var(--text-dim);text-align:center;\">No schemas defined yet</div>";
		listEl.querySelectorAll(".sch-edit-btn").forEach((btn) => {
			btn.onclick = () => {
				showSchemaEditorModal(btn.dataset.id);
				ov.remove();
			};
		});
		listEl.querySelectorAll(".sch-del-btn").forEach((btn) => {
			btn.onclick = async () => {
				if (!await confirmDialog("Delete schema? Existing pins keep their data.")) return;
				await deleteSchema(btn.dataset.id);
				for (const l of state.layers) if (l.default_schema_id === btn.dataset.id) l.default_schema_id = null;
				await saveLayers(state.currentSet, state.layers);
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
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("sch-new-btn").onclick = () => {
		showSchemaEditorModal(null);
		ov.remove();
	};
	renderList();
}
function showSchemaEditorModal(schemaId) {
	if (!state.currentSet) return;
	const existing = schemaId ? state.schemas.find((s) => s.schema_id === schemaId) : null;
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
          <option value="array_time" ${f.type === "array_time" ? "selected" : ""}>array (time)</option>
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
		document.getElementById("sch-fields-list").innerHTML = rows || "<div style=\"color:var(--text-dim);font-size:12px;text-align:center;padding:8px;\">No fields yet — add one below</div>";
		document.querySelectorAll(".sch-fdel").forEach((btn) => {
			btn.onclick = () => {
				fields.splice(parseInt(btn.dataset.i, 10), 1);
				renderFieldsList();
			};
		});
		document.querySelectorAll(".sch-fup").forEach((btn) => {
			btn.onclick = () => {
				const i = parseInt(btn.dataset.i, 10);
				if (i > 0) {
					[fields[i], fields[i - 1]] = [fields[i - 1], fields[i]];
					renderFieldsList();
				}
			};
		});
		document.querySelectorAll(".sch-fdown").forEach((btn) => {
			btn.onclick = () => {
				const i = parseInt(btn.dataset.i, 10);
				if (i < fields.length - 1) {
					[fields[i], fields[i + 1]] = [fields[i + 1], fields[i]];
					renderFieldsList();
				}
			};
		});
		document.querySelectorAll(".sch-fname").forEach((inp) => {
			inp.onchange = () => {
				fields[parseInt(inp.dataset.i, 10)].label = inp.value;
			};
		});
		document.querySelectorAll(".sch-ftype").forEach((sel) => {
			sel.onchange = () => {
				const i = parseInt(sel.dataset.i, 10);
				fields[i].type = sel.value;
				if (sel.value !== "choice") fields[i].options = void 0;
				else fields[i].options = fields[i].options || [];
				renderFieldsList();
			};
		});
		document.querySelectorAll(".sch-fopts").forEach((inp) => {
			inp.onchange = () => {
				const i = parseInt(inp.dataset.i, 10);
				fields[i].options = inp.value.split(",").map((s) => s.trim()).filter(Boolean);
			};
		});
	}
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:420px;max-width:520px;width:95%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">${existing ? t("editSchema") || "Edit Schema" : t("newSchema") || "New Schema"}</h3>
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
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("sched-add-field").onclick = () => {
		const idx = fields.length + 1;
		fields.push({
			key: "f" + idx,
			label: "Field " + idx,
			type: "text"
		});
		renderFieldsList();
	};
	document.getElementById("sched-save").onclick = async () => {
		const name = document.getElementById("sched-name").value.trim();
		if (!name) {
			toast("Schema name required", "#f97316");
			return;
		}
		document.querySelectorAll(".sch-fname").forEach((inp) => {
			const i = parseInt(inp.dataset.i, 10);
			fields[i].label = inp.value || fields[i].label;
			if (!fields[i].key || /^f\d+$/.test(fields[i].key)) {
				let candidate = (inp.value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "f" + (i + 1);
				let suffix = 0;
				const base = candidate.replace(/_\d+$/, "");
				while (fields.some((f, j) => j !== i && f.key === candidate)) {
					suffix++;
					candidate = base + "_" + suffix;
				}
				fields[i].key = candidate;
			}
		});
		document.querySelectorAll(".sch-fopts").forEach((inp) => {
			const i = parseInt(inp.dataset.i, 10);
			fields[i].options = inp.value.split(",").map((s) => s.trim()).filter(Boolean);
		});
		const schema = {
			schema_id: existing ? existing.schema_id : generate_uuid(),
			name,
			fields: fields.filter((f) => f.key && f.label),
			community_id: existing?.community_id || state.currentSet || null
		};
		await saveSchema(schema);
		await loadSchemasForSet(state.currentSet);
		clean();
		showSchemaManagerModal();
		window._renderUI?.();
		toast(schema.name + " saved", "#16a34a");
	};
	renderFieldsList();
}
//#endregion
//#region sounds.js
var ctx = null;
var _enabled = localStorage.getItem("pins-sound") === "1";
function ac() {
	if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
	if (ctx.state === "suspended") ctx.resume();
	return ctx;
}
function tone(freq, dur, vol = .08, type = "sine") {
	if (!_enabled) return;
	const a = ac();
	const o = a.createOscillator();
	const g = a.createGain();
	o.type = type;
	o.frequency.value = freq;
	g.gain.setValueAtTime(vol, a.currentTime);
	g.gain.exponentialRampToValueAtTime(.001, a.currentTime + dur);
	o.connect(g);
	g.connect(a.destination);
	o.start(a.currentTime);
	o.stop(a.currentTime + dur);
}
function playPinDrop() {
	tone(800, .06, .07);
}
function playStroke() {
	tone(440, .04, .05);
}
function playUndo() {
	tone(300, .03, .04, "triangle");
}
function playRedo() {
	tone(500, .03, .04, "triangle");
}
function playSave() {
	tone(600, .08, .06);
	setTimeout(() => tone(900, .08, .06), 60);
}
//#endregion
//#region freeDraw.js
var DEFAULT_COLOR = "#7c3aed";
var DEFAULT_WIDTH = 3;
var MIN_WIDTH = 1;
var MAX_WIDTH = 12;
var toggleBtn = null;
var toolbar = null;
var onDoneCb = null;
var pointerId = null;
var colorDots = [];
var widthBtn = null;
var widthPopout = null;
var hexInput = null;
var shapeActive = false;
var _drawCreatedHandler = null;
var _drawStopHandler = null;
function initFreeDraw(doneCb) {
	onDoneCb = doneCb;
}
function addFreeDrawButton$1() {
	createToggleButton();
	createToolbar();
	setupPointerEvents();
}
function createToggleButton() {
	toggleBtn = leaflet_shim_default.DomUtil.create("button");
	toggleBtn.textContent = "✏️";
	toggleBtn.title = t("freeDraw");
	toggleBtn.style.cssText = "position:absolute;top:135px;right:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#7c3aed;color:white;font-size:18px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
	toggleBtn.onclick = (e) => {
		e.stopPropagation();
		if (state.freeDrawing) if (state.freeStrokes.length > 0) finishDrawing(true);
		else exitDrawingMode();
		else enterDrawingMode();
	};
	state.map.getContainer().appendChild(toggleBtn);
}
function enterDrawingMode() {
	state.freeDrawing = true;
	toggleBtn.style.background = "#5b21b6";
	state.map.getContainer().style.cursor = "crosshair";
	state.map.getContainer().style.touchAction = "none";
	state.map.dragging.disable();
	state.freeStrokeColor = DEFAULT_COLOR;
	state.freeStrokeWidth = DEFAULT_WIDTH;
	updateToolbarSelections();
	showToolbar();
	navigator.vibrate?.(12);
}
function exitDrawingMode() {
	state.freeDrawing = false;
	toggleBtn.style.background = "#7c3aed";
	state.map.getContainer().style.cursor = "";
	state.map.getContainer().style.touchAction = "";
	state.map.dragging.enable();
	if (_drawCreatedHandler) {
		state.map.off(leaflet_shim_default.Draw.Event.CREATED, _drawCreatedHandler);
		_drawCreatedHandler = null;
	}
	if (_drawStopHandler) {
		state.map.off(leaflet_shim_default.Draw.Event.DRAWSTOP, _drawStopHandler);
		_drawStopHandler = null;
	}
	hideToolbar();
	if (state.freePreview) {
		state.map.removeLayer(state.freePreview);
		state.freePreview = null;
	}
	state.freePoints = [];
}
function discardAll() {
	state.freeStrokes.forEach((s) => state.map.removeLayer(s.layer));
	state.freeStrokes.length = 0;
	state.freeUndoStack.length = 0;
}
function finishDrawing(save) {
	if (save && state.freeStrokes.length > 0 && onDoneCb) {
		exitDrawingMode();
		const collection = {
			type: "FeatureCollection",
			features: state.freeStrokes.map((stroke) => {
				let geometry;
				if (stroke.shape?.type === "circle") geometry = {
					type: "Point",
					coordinates: [stroke.shape.center[0], stroke.shape.center[1]]
				};
				else if (stroke.shape?.type === "rectangle") geometry = {
					type: "Polygon",
					coordinates: [[...stroke.shape.corners, stroke.shape.corners[0]]]
				};
				else geometry = {
					type: "LineString",
					coordinates: stroke.points
				};
				const props = {
					color: stroke.color,
					"stroke-width": stroke.width,
					"stroke-opacity": stroke.opacity
				};
				if (stroke.shape?.type === "circle") props.radius = stroke.shape.radius;
				return {
					type: "Feature",
					geometry,
					properties: props
				};
			})
		};
		discardAll();
		onDoneCb(collection);
		navigator.vibrate?.(20);
		playSave();
	} else {
		discardAll();
		exitDrawingMode();
	}
}
function createToolbar() {
	toolbar = document.createElement("div");
	toolbar.id = "free-draw-toolbar";
	toolbar.style.cssText = "position:absolute;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000;display:none;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:12px;padding:8px 12px;box-shadow:0 2px 12px rgba(0,0,0,0.2);align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;";
	const colorRow = document.createElement("div");
	colorRow.style.cssText = "display:flex;gap:4px;align-items:center;";
	colorDots = [];
	COLORS.forEach((c) => {
		const dot = document.createElement("span");
		dot.style.cssText = `width:24px;height:24px;background:${c};border-radius:50%;cursor:pointer;border:2px solid ${c === DEFAULT_COLOR ? "var(--text)" : "transparent"};flex-shrink:0;`;
		dot.dataset.color = c;
		dot.onclick = () => setColor(c);
		colorRow.appendChild(dot);
		colorDots.push(dot);
	});
	const hueDot = document.createElement("span");
	hueDot.style.cssText = "width:24px;height:24px;border-radius:50%;cursor:pointer;border:2px solid transparent;flex-shrink:0;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);background-size:140% 140%;background-position:center;";
	hueDot.onclick = (e) => {
		e.stopPropagation();
		const picker = document.createElement("input");
		picker.type = "color";
		picker.value = state.freeStrokeColor;
		picker.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
		if (document.body.classList.contains("dark")) picker.style.colorScheme = "dark";
		state.map.getContainer().appendChild(picker);
		picker.oninput = () => {
			setColor(picker.value);
			hueDot.style.border = "2px solid var(--text)";
			colorDots.forEach((d) => d.style.border = "2px solid transparent");
		};
		picker.onblur = () => picker.remove();
		picker.click();
	};
	hueDot.title = t("color") || "Color";
	colorRow.appendChild(hueDot);
	colorDots.push(hueDot);
	const hexInputEl = document.createElement("input");
	hexInputEl.type = "text";
	hexInputEl.value = DEFAULT_COLOR;
	hexInputEl.placeholder = "#hex";
	hexInputEl.style.cssText = "width:58px;height:24px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:11px;padding:0 4px;box-sizing:border-box;flex-shrink:0;font-family:monospace;";
	hexInputEl.oninput = () => {
		const color = validateHex(hexInputEl.value);
		if (color) setColor(color);
	};
	hexInputEl.onblur = () => {
		hexInputEl.value = state.freeStrokeColor;
	};
	colorRow.appendChild(hexInputEl);
	hexInput = hexInputEl;
	toolbar.appendChild(colorRow);
	const sep1 = document.createElement("div");
	sep1.style.cssText = "width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;";
	toolbar.appendChild(sep1);
	widthBtn = document.createElement("button");
	widthBtn.style.cssText = "width:28px;height:28px;border:none;border-radius:4px;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;";
	widthBtn.onclick = (e) => {
		e.stopPropagation();
		toggleWidthPopout();
	};
	toolbar.appendChild(widthBtn);
	widthPopout = document.createElement("div");
	widthPopout.id = "free-draw-width-popout";
	widthPopout.style.cssText = "position:absolute;bottom:52px;left:50%;transform:translateX(-50%);z-index:1001;display:none;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:8px;padding:8px 12px;box-shadow:0 2px 12px rgba(0,0,0,0.2);align-items:center;gap:8px;";
	const sliderLabel = document.createElement("span");
	sliderLabel.style.cssText = "font-size:12px;color:var(--text-dim);white-space:nowrap;";
	sliderLabel.textContent = "1";
	widthPopout.appendChild(sliderLabel);
	const slider = document.createElement("input");
	slider.type = "range";
	slider.min = MIN_WIDTH;
	slider.max = MAX_WIDTH;
	slider.step = 1;
	slider.value = DEFAULT_WIDTH;
	slider.style.cssText = "width:100px;accent-color:var(--blue);cursor:pointer;";
	slider.oninput = () => {
		const v = parseInt(slider.value, 10);
		setWidth(v);
		sliderLabel.textContent = v;
	};
	widthPopout.appendChild(slider);
	const sliderMax = document.createElement("span");
	sliderMax.style.cssText = "font-size:12px;color:var(--text-dim);white-space:nowrap;";
	sliderMax.textContent = MAX_WIDTH;
	widthPopout.appendChild(sliderMax);
	state.map.getContainer().appendChild(widthPopout);
	document.addEventListener("pointerdown", (e) => {
		if (widthPopout.style.display === "flex" && !widthPopout.contains(e.target) && e.target !== widthBtn) widthPopout.style.display = "none";
	});
	const sep2 = document.createElement("div");
	sep2.style.cssText = "width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;";
	toolbar.appendChild(sep2);
	const highlightBtn = document.createElement("button");
	highlightBtn.textContent = "🖍";
	highlightBtn.title = "Highlighter";
	highlightBtn.style.cssText = "width:28px;height:28px;border:none;border-radius:4px;background:transparent;color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
	highlightBtn.onclick = () => {
		state.highlighting = !state.highlighting;
		highlightBtn.style.background = state.highlighting ? "var(--blue)" : "transparent";
		highlightBtn.style.color = state.highlighting ? "white" : "var(--text)";
	};
	toolbar.appendChild(highlightBtn);
	const undoBtn = document.createElement("button");
	undoBtn.textContent = "↩";
	undoBtn.title = t("undo") || "Undo";
	undoBtn.style.cssText = "width:28px;height:28px;border:none;border-radius:4px;background:transparent;color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
	undoBtn.onclick = undo$1;
	toolbar.appendChild(undoBtn);
	const redoBtn = document.createElement("button");
	redoBtn.textContent = "↪";
	redoBtn.title = t("redo") || "Redo";
	redoBtn.style.cssText = "width:28px;height:28px;border:none;border-radius:4px;background:transparent;color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
	redoBtn.onclick = redo$1;
	toolbar.appendChild(redoBtn);
	const snapBtn = document.createElement("button");
	snapBtn.textContent = "⬡";
	snapBtn.title = "Snap to shape";
	snapBtn.style.cssText = "width:28px;height:28px;border:none;border-radius:4px;background:transparent;color:var(--text);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;";
	snapBtn.onclick = () => {
		state.snapping = !state.snapping;
		snapBtn.style.background = state.snapping ? "var(--blue)" : "transparent";
		snapBtn.style.color = state.snapping ? "white" : "var(--text)";
	};
	toolbar.appendChild(snapBtn);
	const sep3 = document.createElement("div");
	sep3.style.cssText = "width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;";
	toolbar.appendChild(sep3);
	const doneBtn = document.createElement("button");
	doneBtn.textContent = t("save");
	doneBtn.style.cssText = "height:28px;border:none;border-radius:4px;background:#16a34a;color:white;cursor:pointer;font-size:13px;font-weight:600;padding:0 10px;flex-shrink:0;";
	doneBtn.onclick = () => finishDrawing(true);
	toolbar.appendChild(doneBtn);
	const discardBtn = document.createElement("button");
	discardBtn.textContent = t("discard");
	discardBtn.style.cssText = "height:28px;border:1px solid #dc2626;border-radius:4px;background:transparent;color:#dc2626;cursor:pointer;font-size:13px;font-weight:600;padding:0 10px;flex-shrink:0;";
	discardBtn.onclick = () => {
		discardAll();
		exitDrawingMode();
	};
	toolbar.appendChild(discardBtn);
	const sep4 = document.createElement("div");
	sep4.style.cssText = "width:1px;height:22px;background:var(--border);margin:0 2px;flex-shrink:0;";
	toolbar.appendChild(sep4);
	const shapeOpts = {
		color: "#2563eb",
		weight: 2,
		fillOpacity: .15
	};
	const toolDefs = [
		{
			title: t("polyline"),
			svg: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><polyline points=\"2,14 6,6 10,10 14,2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
			create: () => new leaflet_shim_default.Draw.Polyline(state.map, { shapeOptions: shapeOpts })
		},
		{
			title: t("polygon"),
			svg: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><path d=\"M8 2L14 6L12 12L4 12L2 6Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/></svg>",
			create: () => new leaflet_shim_default.Draw.Polygon(state.map, {
				shapeOptions: shapeOpts,
				allowIntersection: false,
				showArea: true
			})
		},
		{
			title: t("rectangle"),
			svg: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><rect x=\"2\" y=\"3\" width=\"12\" height=\"10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" rx=\"1\"/></svg>",
			create: () => new leaflet_shim_default.Draw.Rectangle(state.map, { shapeOptions: shapeOpts })
		},
		{
			title: t("circle"),
			svg: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><circle cx=\"8\" cy=\"8\" r=\"6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>",
			create: () => new leaflet_shim_default.Draw.Circle(state.map, { shapeOptions: shapeOpts })
		}
	];
	let activeShapeBtn = null;
	function resetShapeTool() {
		if (shapeActive) shapeActive = false;
		if (activeShapeBtn) {
			activeShapeBtn.style.background = "transparent";
			activeShapeBtn.style.color = "var(--text)";
			activeShapeBtn = null;
		}
	}
	toolDefs.forEach((def) => {
		const btn = document.createElement("button");
		btn.title = def.title;
		btn.innerHTML = def.svg;
		btn.style.cssText = "width:28px;height:28px;border:1px solid var(--border);border-radius:4px;background:transparent;color:var(--text);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;";
		btn.onclick = (e) => {
			e.stopPropagation();
			if (shapeActive && activeShapeBtn === btn) {
				resetShapeTool();
				return;
			}
			resetShapeTool();
			activeShapeBtn = btn;
			btn.style.background = "var(--blue)";
			btn.style.color = "white";
			shapeActive = true;
			const handler = def.create();
			handler.enable();
			handler._freeDrawHandler = handler;
		};
		toolbar.appendChild(btn);
	});
	state.map.getContainer().appendChild(toolbar);
	if (_drawCreatedHandler) state.map.off(leaflet_shim_default.Draw.Event.CREATED, _drawCreatedHandler);
	if (_drawStopHandler) state.map.off(leaflet_shim_default.Draw.Event.DRAWSTOP, _drawStopHandler);
	_drawCreatedHandler = (e) => {
		resetShapeTool();
		const l = e.layer, g = l.toGeoJSON();
		if (l instanceof leaflet_shim_default.Circle) {
			g.properties = g.properties || {};
			g.properties.radius = l.getRadius();
		}
		if (onDoneCb) onDoneCb(g);
	};
	_drawStopHandler = () => resetShapeTool();
	state.map.on(leaflet_shim_default.Draw.Event.CREATED, _drawCreatedHandler);
	state.map.on(leaflet_shim_default.Draw.Event.DRAWSTOP, _drawStopHandler);
}
function showToolbar() {
	toolbar.style.display = "flex";
}
function hideToolbar() {
	toolbar.style.display = "none";
	if (widthPopout) widthPopout.style.display = "none";
}
function toggleWidthPopout() {
	if (widthPopout.style.display === "flex") widthPopout.style.display = "none";
	else {
		const slider = widthPopout.querySelector("input");
		slider.value = state.freeStrokeWidth;
		widthPopout.querySelector("span").textContent = state.freeStrokeWidth;
		widthPopout.style.display = "flex";
	}
}
function updateToolbarSelections() {
	const isPreset = COLORS.includes(state.freeStrokeColor);
	colorDots.forEach((d) => {
		if (d.dataset.color) d.style.border = d.dataset.color === state.freeStrokeColor ? "2px solid var(--text)" : "2px solid transparent";
		else d.style.border = isPreset ? "2px solid transparent" : "2px solid var(--text)";
	});
	if (hexInput && document.activeElement !== hexInput) hexInput.value = state.freeStrokeColor;
	updateWidthIndicator();
}
function updateWidthIndicator() {
	const w = state.freeStrokeWidth;
	widthBtn.innerHTML = "";
	const dot = document.createElement("span");
	dot.style.cssText = `display:inline-block;border-radius:50%;background:var(--text);width:${4 + w * 2}px;height:${4 + w * 2}px;`;
	widthBtn.appendChild(dot);
	const slider = widthPopout?.querySelector("input");
	if (slider) slider.value = w;
	const label = widthPopout?.querySelector("span");
	if (label) label.textContent = w;
}
function setColor(color) {
	state.freeStrokeColor = color;
	updateToolbarSelections();
}
function setWidth(width) {
	state.freeStrokeWidth = width;
	updateToolbarSelections();
}
function undo$1() {
	if (state.freeStrokes.length === 0) return;
	const stroke = state.freeStrokes.pop();
	state.map.removeLayer(stroke.layer);
	state.freeUndoStack.push(stroke);
	navigator.vibrate?.(8);
	playUndo();
}
function redo$1() {
	if (state.freeUndoStack.length === 0) return;
	const stroke = state.freeUndoStack.pop();
	stroke.layer.addTo(state.map);
	state.freeStrokes.push(stroke);
	navigator.vibrate?.(8);
	playRedo();
}
function detectShape(points) {
	let shape = null;
	try {
		shape = JSON.parse(detect_freehand_shape(JSON.stringify(points)));
	} catch (_) {}
	return shape;
}
function setupPointerEvents() {
	const container = state.map.getContainer();
	container.addEventListener("pointerdown", (e) => {
		if (shapeActive) return;
		if (!state.freeDrawing) return;
		if (e.target.closest("#free-draw-toolbar")) return;
		if (e.target.closest("#free-draw-width-popout")) return;
		if (e.target.closest("button")) return;
		if (pointerId !== null) return;
		if (e.pointerType === "mouse" && e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		pointerId = e.pointerId;
		container.setPointerCapture(e.pointerId);
		state.freePoints = [];
		const rect = container.getBoundingClientRect();
		const ltln = state.map.containerPointToLatLng([e.clientX - rect.left, e.clientY - rect.top]);
		state.freePoints.push([
			ltln.lng,
			ltln.lat,
			e.pressure || .5
		]);
		state.freePreview = leaflet_shim_default.polyline([[ltln.lat, ltln.lng]], {
			color: state.freeStrokeColor,
			weight: state.freeStrokeWidth,
			opacity: state.highlighting ? .35 : 1,
			smoothFactor: 0
		}).addTo(state.map);
	});
	container.addEventListener("pointermove", (e) => {
		if (!state.freeDrawing || !state.freePreview) return;
		if (e.pointerId !== pointerId) return;
		e.preventDefault();
		e.stopPropagation();
		const rect = container.getBoundingClientRect();
		const ltln = state.map.containerPointToLatLng([e.clientX - rect.left, e.clientY - rect.top]);
		state.freePoints.push([
			ltln.lng,
			ltln.lat,
			e.pressure || .5
		]);
		state.freePreview.setLatLngs(state.freePoints.map((p) => [p[1], p[0]]));
	});
	container.addEventListener("pointerup", (e) => {
		if (e.pointerId !== pointerId) return;
		container.releasePointerCapture(e.pointerId);
		pointerId = null;
		if (!state.freePreview) return;
		state.map.removeLayer(state.freePreview);
		state.freePreview = null;
		if (state.freePoints.length < 2) {
			state.freePoints = [];
			return;
		}
		let strokeWidth = state.freeStrokeWidth;
		if (!state.highlighting) {
			let avgPressure = 0;
			for (const p of state.freePoints) avgPressure += p[2] || .5;
			avgPressure /= state.freePoints.length;
			strokeWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(state.freeStrokeWidth * avgPressure / .5)));
		}
		const positions = state.freePoints.map((p) => [p[0], p[1]]);
		let simplified;
		try {
			const raw = JSON.stringify(positions);
			simplified = JSON.parse(simplify_freehand(raw, 1e-5));
		} catch (_) {
			simplified = positions;
		}
		if (simplified.length < 2) {
			state.freePoints = [];
			return;
		}
		const shape = state.snapping ? detectShape(simplified) : null;
		let layer;
		if (shape && shape.type === "circle") layer = leaflet_shim_default.circle([shape.center[1], shape.center[0]], {
			radius: shape.radius,
			color: state.freeStrokeColor,
			weight: strokeWidth,
			opacity: state.highlighting ? .35 : 1,
			fillColor: state.freeStrokeColor,
			fillOpacity: .15
		}).addTo(state.map);
		else if (shape && shape.type === "rectangle") layer = leaflet_shim_default.polygon(shape.corners.map((p) => [p[1], p[0]]), {
			color: state.freeStrokeColor,
			weight: strokeWidth,
			opacity: state.highlighting ? .35 : 1,
			fillColor: state.freeStrokeColor,
			fillOpacity: .15
		}).addTo(state.map);
		else layer = leaflet_shim_default.polyline(simplified.map((p) => [p[1], p[0]]), {
			color: state.freeStrokeColor,
			weight: strokeWidth,
			opacity: state.highlighting ? .35 : 1,
			smoothFactor: 0
		}).addTo(state.map);
		state.freeStrokes.push({
			points: simplified,
			color: state.freeStrokeColor,
			width: strokeWidth,
			opacity: state.highlighting ? .35 : 1,
			layer,
			shape: shape || null
		});
		state.freeUndoStack.length = 0;
		state.freePoints = [];
		navigator.vibrate?.([
			4,
			4,
			4
		]);
		playStroke();
	});
	container.addEventListener("pointercancel", (e) => {
		if (e.pointerId !== pointerId) return;
		container.releasePointerCapture(e.pointerId);
		pointerId = null;
		if (state.freePreview) {
			state.map.removeLayer(state.freePreview);
			state.freePreview = null;
		}
		state.freePoints = [];
	});
	container.addEventListener("pointerleave", (e) => {
		if (e.pointerId !== pointerId) return;
		container.releasePointerCapture(e.pointerId);
		pointerId = null;
		if (state.freePreview) {
			state.map.removeLayer(state.freePreview);
			state.freePreview = null;
		}
		state.freePoints = [];
	});
}
//#endregion
//#region map-poi.js
var _poiLayerGroup = null;
var _poiEnabled = false;
var _activeCategories = new Set([
	"food_drink",
	"health",
	"services",
	"outdoor",
	"transport"
]);
var _map = null;
var CATEGORIES = [
	{
		id: "food_drink",
		label: "Food & Drink",
		icon: "🍽",
		query: "node[amenity~\"restaurant|cafe|fast_food|pub|bar|biergarten\"]({bbox});"
	},
	{
		id: "health",
		label: "Health",
		icon: "🏥",
		query: "node[amenity~\"hospital|pharmacy|clinic|doctors|dentist|veterinary\"]({bbox});"
	},
	{
		id: "services",
		label: "Services",
		icon: "🏧",
		query: "node[amenity~\"atm|bank|post_office|fuel|charging_station\"]({bbox});"
	},
	{
		id: "outdoor",
		label: "Outdoor",
		icon: "🚰",
		query: "node[amenity~\"drinking_water|toilets|shelter|bench|waste_basket\"]({bbox});"
	},
	{
		id: "transport",
		label: "Transport",
		icon: "🚇",
		query: "node[railway~\"station|subway_entrance|tram_stop|halt\"]({bbox});node[amenity~\"bus_station|parking|bicycle_parking|ferry_terminal\"]({bbox});"
	},
	{
		id: "shopping",
		label: "Shopping",
		icon: "🛒",
		query: "node[shop~\"supermarket|convenience|bakery|mall|department_store|chemist\"]({bbox});"
	},
	{
		id: "attractions",
		label: "Attractions",
		icon: "🏛",
		query: "node[tourism~\"attraction|museum|viewpoint|picnic_site|camp_site|hotel|hostel|guest_house|zoo\"]({bbox});"
	}
];
var POI_ICONS = {
	restaurant: "🍽",
	cafe: "☕",
	fast_food: "🍔",
	pub: "🍺",
	bar: "🍸",
	biergarten: "🍻",
	hospital: "🏥",
	pharmacy: "💊",
	clinic: "🏥",
	doctors: "🩺",
	dentist: "🦷",
	veterinary: "🐾",
	atm: "🏧",
	bank: "🏦",
	post_office: "📮",
	fuel: "⛽",
	charging_station: "🔌",
	drinking_water: "🚰",
	toilets: "🚽",
	shelter: "🏕",
	bench: "🪑",
	station: "🚂",
	subway_entrance: "🚇",
	tram_stop: "🚊",
	bus_station: "🚌",
	parking: "🅿️",
	bicycle_parking: "🚲",
	ferry_terminal: "⛴",
	supermarket: "🛒",
	convenience: "🏪",
	bakery: "🥐",
	mall: "🏬",
	attraction: "🎡",
	museum: "🏛",
	viewpoint: "🔭",
	picnic_site: "🫖",
	camp_site: "⛰",
	hotel: "🏨",
	hostel: "🛍",
	guest_house: "🏠",
	zoo: "🦁"
};
function getPOIIcon(tags) {
	if (!tags) return "📍";
	for (const key of [
		"amenity",
		"shop",
		"tourism",
		"railway"
	]) if (tags[key] && POI_ICONS[tags[key]]) return POI_ICONS[tags[key]];
	return "📍";
}
function initPOILayer(map) {
	_map = map;
	_poiLayerGroup = leaflet_shim_default.markerClusterGroup({
		maxClusterRadius: 50,
		spiderfyOnMaxZoom: false,
		disableClusteringAtZoom: 18,
		chunkedLoading: true
	});
	return _poiLayerGroup;
}
function togglePOIEnabled() {
	_poiEnabled = !_poiEnabled;
	return _poiEnabled;
}
function setActiveCategories(cats) {
	_activeCategories = new Set(cats);
	if (_poiEnabled) queryPOIs();
}
async function queryPOIs() {
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
	for (const cat of CATEGORIES) if (_activeCategories.has(cat.id)) parts.push(cat.query.replace(/\{bbox\}/g, bbox));
	if (parts.length === 0) return;
	const query = `[out:json][timeout:15];(${parts.join("")});out center 200;`;
	try {
		const resp = await fetch("https://overpass-api.de/api/interpreter", {
			method: "POST",
			headers: {
				"Content-Type": "text/plain",
				"User-Agent": "piggPin/0.0.1"
			},
			body: query
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
			const marker = leaflet_shim_default.marker([lat, lon], {
				icon: leaflet_shim_default.divIcon({
					className: "poi-marker",
					html: `<div style="font-size:16px;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:12px;background:rgba(255,255,255,0.85);box-shadow:0 1px 3px rgba(0,0,0,0.2);">${icon}</div>`,
					iconSize: [24, 24],
					iconAnchor: [12, 12]
				}),
				zIndexOffset: -200,
				interactive: true
			});
			marker.bindTooltip(name, {
				direction: "top",
				offset: [0, -14],
				opacity: .9
			});
			_poiLayerGroup.addLayer(marker);
		}
	} catch (e) {
		console.warn("[poi] Overpass query failed:", e.message);
	}
}
function showPOICategoryModal() {
	const existing = document.getElementById("poi-cat-modal");
	if (existing) {
		existing.remove();
		return;
	}
	const ov = document.createElement("div");
	ov.id = "poi-cat-modal";
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
	const items = CATEGORIES.map((c) => `
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
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
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
		const cats = /* @__PURE__ */ new Set();
		checks.forEach((c) => {
			if (c.checked) cats.add(c.value);
		});
		setActiveCategories(cats);
		clean();
	};
	document.getElementById("poi-cat-all").onclick = () => {
		ov.querySelectorAll("input[type=\"checkbox\"]:not(#poi-enable)").forEach((c) => c.checked = true);
	};
	document.getElementById("poi-cat-none").onclick = () => {
		ov.querySelectorAll("input[type=\"checkbox\"]:not(#poi-enable)").forEach((c) => c.checked = false);
	};
}
//#endregion
//#region map-osm-notes.js
var _notesLayerGroup = null;
var _notesEnabled = false;
var _notesTimer = null;
function getProxyUrl() {
	return localStorage.getItem("pins-osm-proxy") || "";
}
function osmFetch(path) {
	const proxy = getProxyUrl();
	const url = proxy ? `${proxy.replace(/\/$/, "")}/${path}` : null;
	if (!url) return Promise.reject(/* @__PURE__ */ new Error("No OSM proxy configured"));
	return fetch(url).then((r) => {
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		return r.json();
	});
}
function initOSMNotesLayer(map) {
	_notesLayerGroup = leaflet_shim_default.layerGroup();
	return _notesLayerGroup;
}
function isNotesEnabled() {
	return _notesEnabled;
}
function toggleNotesEnabled() {
	_notesEnabled = !_notesEnabled;
	return _notesEnabled;
}
async function queryOSMNotes() {
	if (!_notesEnabled || !_notesLayerGroup) return;
	if (!getProxyUrl()) {
		console.warn("[osm-notes] No proxy configured");
		return;
	}
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
			const sym = isOpen ? "!" : "✓";
			const icon = leaflet_shim_default.divIcon({
				className: "osm-note-marker",
				html: `<div style="font-size:12px;display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:9px;background:${bg};color:white;box-shadow:0 1px 3px rgba(0,0,0,0.2);font-weight:bold;">${sym}</div>`,
				iconSize: [18, 18],
				iconAnchor: [9, 9]
			});
			const marker = leaflet_shim_default.marker([lat, lon], {
				icon,
				zIndexOffset: -100,
				interactive: true
			});
			marker.bindPopup(`
        <div style="max-width:280px;">
          <b>${isOpen ? "🔴 Open" : "🟢 Closed"} Note #${props.id}</b>
          <div style="font-size:12px;margin-top:4px;max-height:80px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;">${escapeHtml(firstComment.slice(0, 300))}</div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:4px;">
            by ${escapeHtml(firstUser)} \u00b7 ${commentCount} comment${commentCount !== 1 ? "s" : ""}
          </div>
          <a href="https://www.openstreetmap.org/note/${props.id}" target="_blank" style="font-size:11px;color:#2563eb;">View on osm.org</a>
        </div>
      `);
			_notesLayerGroup.addLayer(marker);
		}
	} catch (e) {
		console.warn("[osm-notes] query failed:", e.message);
	}
}
function scheduleNotesRefresh() {
	if (_notesTimer) clearTimeout(_notesTimer);
	_notesTimer = setTimeout(() => queryOSMNotes(), 3e3);
}
function clearNotesTimer() {
	if (_notesTimer) {
		clearTimeout(_notesTimer);
		_notesTimer = null;
	}
}
function showCreateNoteDialog(lat, lng) {
	if (!getProxyUrl()) {
		toast(t("osmProxyNeeded"), "#dc2626");
		return;
	}
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
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("osm-note-cancel").onclick = clean;
	document.getElementById("osm-note-submit").onclick = async () => {
		const text = document.getElementById("osm-note-text").value.trim();
		if (!text) {
			toast(t("osmNoteDesc"), "#dc2626");
			return;
		}
		if (text.length < 10) {
			toast(t("osmNoteShort"), "#dc2626");
			return;
		}
		const btn = document.getElementById("osm-note-submit");
		btn.disabled = true;
		btn.textContent = "Submitting...";
		try {
			const proxyUrl = getProxyUrl().replace(/\/$/, "");
			if ((await fetch(`${proxyUrl}/api/0.6/notes`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					lat,
					lon: lng,
					text
				})
			})).ok) {
				toast(t("osmNoteSuccess"), "#16a34a");
				clean();
				queryOSMNotes();
			} else toast(t("osmNoteFail"), "#dc2626");
		} catch (e) {
			toast(t("osmNoteFail"), "#dc2626");
		}
		btn.disabled = false;
		btn.textContent = "Submit Note";
	};
}
//#endregion
//#region workers/media-compress.js
var isOffscreenSupported = typeof OffscreenCanvas !== "undefined";
var _worker = null;
var _nextId = 1;
var _pending = /* @__PURE__ */ new Map();
function getWorker() {
	if (!_worker && isOffscreenSupported) {
		_worker = new Worker(new URL("./media-worker.js", import.meta.url), { type: "module" });
		_worker.onmessage = (e) => {
			const { id, buffer, type, name } = e.data;
			const pending = _pending.get(id);
			if (pending) {
				clearTimeout(pending.timeout);
				_pending.delete(id);
				pending.resolve({
					buffer,
					type,
					name
				});
			}
		};
		_worker.onerror = () => {};
	}
	return _worker;
}
function compressOnMain(buffer, mimeType, fileName) {
	return new Promise((resolve) => {
		const blob = new Blob([buffer], { type: mimeType });
		createImageBitmap(blob, {
			premultiplyAlpha: "none",
			colorSpaceConversion: "none"
		}).then((bitmap) => {
			let w = bitmap.width, h = bitmap.height;
			if (w > 1920 || h > 1920) {
				const ratio = Math.min(1920 / w, 1920 / h);
				w = Math.round(w * ratio);
				h = Math.round(h * ratio);
			}
			const canvas = document.createElement("canvas");
			canvas.width = w;
			canvas.height = h;
			canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
			bitmap.close();
			canvas.toBlob((outBlob) => {
				const tryJpeg = () => {
					canvas.toBlob((jpegBlob) => {
						if (!jpegBlob) return resolve({
							buffer,
							type: mimeType,
							name: fileName
						});
						jpegBlob.arrayBuffer().then((buf) => {
							resolve({
								buffer: buf,
								type: jpegBlob.type,
								name: fileName.replace(/\.[^.]+$/, ".jpg")
							});
						});
					}, "image/jpeg", .85);
				};
				if (!outBlob) return tryJpeg();
				outBlob.arrayBuffer().then((buf) => {
					resolve({
						buffer: buf,
						type: outBlob.type,
						name: fileName.replace(/\.[^.]+$/, ".webp")
					});
				});
			}, "image/webp", .8);
		}).catch(() => {
			resolve({
				buffer,
				type: mimeType,
				name: fileName
			});
		});
	});
}
/**
* Compress an image buffer. Routes to Web Worker when OffscreenCanvas is available,
* falls back to main-thread Canvas otherwise.
*
* @param {ArrayBuffer} buffer
* @param {string} mimeType
* @param {string} fileName
* @returns {Promise<{buffer: ArrayBuffer, type: string, name: string}>}
*/
function compressImageBuffer(buffer, mimeType, fileName) {
	const worker = getWorker();
	if (!worker) return compressOnMain(buffer, mimeType, fileName);
	return new Promise((resolve, reject) => {
		const id = _nextId++;
		const timeout = setTimeout(() => {
			_pending.delete(id);
			compressOnMain(buffer, mimeType, fileName).then(resolve, reject);
		}, 1e4);
		_pending.set(id, {
			resolve,
			reject,
			timeout
		});
		worker.postMessage({
			id,
			buffer,
			mimeType,
			fileName
		}, [buffer]);
	});
}
var _videoWorker = null;
var _nextVideoId = 1;
var _videoPending = /* @__PURE__ */ new Map();
var webcodecsSupported = typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined";
function getVideoWorker() {
	if (!_videoWorker && webcodecsSupported) {
		_videoWorker = new Worker(new URL("./video-compress.js", import.meta.url), { type: "module" });
		_videoWorker.onmessage = (e) => {
			const { id, buffer, type, name } = e.data;
			const pending = _videoPending.get(id);
			if (pending) {
				clearTimeout(pending.timeout);
				_videoPending.delete(id);
				pending.resolve({
					buffer,
					type,
					name
				});
			}
		};
		_videoWorker.onerror = () => {};
	}
	return _videoWorker;
}
function compressVideoBuffer(buffer, mimeType, fileName) {
	if (!webcodecsSupported) return null;
	const worker = getVideoWorker();
	if (!worker) return null;
	return new Promise((resolve) => {
		const id = _nextVideoId++;
		const timeout = setTimeout(() => {
			_videoPending.delete(id);
			resolve(null);
		}, 12e4);
		_videoPending.set(id, {
			resolve,
			timeout
		});
		worker.postMessage({
			id,
			buffer,
			mimeType,
			fileName
		}, [buffer.buffer]);
	});
}
//#endregion
//#region map-layers.js
function safeBounds(b) {
	if (!b || !Array.isArray(b) || b.length !== 4) return "";
	if (!b.every((v) => typeof v === "number" && isFinite(v))) return "";
	return escapeHtml(JSON.stringify(b));
}
async function loadLayersForSet(teamId) {
	if (!teamId) {
		state.layers = [];
		return;
	}
	let layers = await getLayers(teamId);
	if (!layers || !Array.isArray(layers) || layers.length === 0) {
		layers = [{
			layer_id: generate_uuid(),
			name: "Default",
			color: state.defaultLayerColor,
			visible: true,
			opacity: 1
		}];
		await saveLayers(teamId, layers);
	}
	state.layers = layers;
}
async function createLayer(name) {
	if (!state.currentSet) return;
	const layerId = generate_uuid();
	const idx = state.layers.length;
	const color = state.layerPalette[idx % state.layerPalette.length];
	const layer = {
		layer_id: layerId,
		name: name || "Layer " + (idx + 1),
		color,
		visible: true,
		opacity: 1
	};
	state.layers = [...state.layers, layer];
	await saveLayers(state.currentSet, state.layers);
	await loadPins();
	await loadDrawings();
	window._renderUI?.();
}
async function renameLayer(layerId, newName) {
	if (!state.currentSet) return;
	const layer = state.layers.find((l) => l.layer_id === layerId);
	if (!layer) return;
	layer.name = newName;
	state.layers = [...state.layers];
	await saveLayers(state.currentSet, state.layers);
	for (const m of state.markers) if (m._layerId === layerId) m._layerName = newName;
}
async function deleteLayer(layerId) {
	if (!state.currentSet || state.layers.length <= 1) {
		toast("Cannot delete the last layer", "#f97316");
		return;
	}
	const defaultId = state.layers[0].layer_id;
	state.layers = state.layers.filter((l) => l.layer_id !== layerId);
	await saveLayers(state.currentSet, state.layers);
	const pins = await getPinsByLayer(state.currentSet, layerId);
	for (const p of pins) await updatePinLayerId(p.pin_id, defaultId);
	const drawings = await getDrawings(state.currentSet);
	for (const d of drawings) if (d.layer_id === layerId) await updateDrawingLayerId(d.drawing_id, defaultId);
	await loadPins();
	await loadDrawings();
	window._renderUI?.();
}
async function toggleLayer(layerId) {
	if (!state.currentSet) return;
	const layer = state.layers.find((l) => l.layer_id === layerId);
	if (!layer) return;
	layer.visible = !layer.visible;
	state.layers = [...state.layers];
	await saveLayers(state.currentSet, state.layers);
	await loadPins();
	await loadDrawings();
	window._renderUI?.();
}
async function setLayerOpacity(layerId, value) {
	if (!state.currentSet) return;
	const layer = state.layers.find((l) => l.layer_id === layerId);
	if (!layer) return;
	layer.opacity = Math.max(.1, Math.min(1, value));
	state.layers = [...state.layers];
	await saveLayers(state.currentSet, state.layers);
	for (const m of state.markers) if (m._layerId === layerId) m.setOpacity(layer.visible ? layer.opacity : 0);
	for (const dl of state.drawingLayers) if (dl._layerId === layerId) {
		const o = layer.visible ? layer.opacity : 0;
		dl.setStyle({
			opacity: o,
			fillOpacity: o * .15
		});
	}
}
async function refreshAllLayers() {
	if (!state.currentSet) return;
	await loadLayersForSet(state.currentSet);
	state.markers.forEach((m) => m.remove());
	state.markers.length = 0;
	state.clusterGroup?.clearLayers();
	state._markerMap = null;
	state.drawingLayers.forEach((l) => state.map.removeLayer(l));
	state.drawingLayers.length = 0;
	state.chainLayers.forEach((l) => state.map.removeLayer(l));
	state.chainLayers.length = 0;
	await loadPins();
	await loadDrawings();
	await loadChains();
}
async function showDiscoverModal() {
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	let geoFilter = true;
	async function renderLocalCommunities() {
		let html = `<div style="padding:10px;font-size:12px;color:var(--text-dim);margin-bottom:4px;">Discover communities published on relay servers. Publish one of your maps in 🗺 Maps → ℹ.</div>`;
		try {
			const teams = await getAllTeams();
			const allTeams = Array.isArray(teams) ? teams : [];
			if (allTeams.length > 0) {
				const localRows = [];
				for (const tc of allTeams) {
					const com = await getCommunity(tc.team_id);
					const name = tc.name || com?.name || tc.team_id.slice(0, 8);
					let pinCount = 0;
					try {
						const pins = await getPins(tc.team_id);
						pinCount = pins ? pins.length : 0;
					} catch (e) {
						console.warn("[layers]", e.message);
					}
					localRows.push(`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border-light);">
            <div><span style="font-size:13px;">🗺 ${escapeHtml(name.slice(0, 30))}</span>
            <span style="font-size:10px;color:var(--text-dim);margin-left:8px;">${pinCount} pin${pinCount !== 1 ? "s" : ""}</span></div>
            <span style="font-size:10px;color:var(--text-muted);">you · ${(com?.members || []).length || 1} member${(com?.members || []).length !== 1 ? "s" : ""}</span>
          </div>`);
				}
				html += `<div style="border:1px solid var(--border-light);border-radius:4px;margin-bottom:8px;">
          <div style="padding:6px 10px;font-size:11px;color:var(--text-dim);border-bottom:1px solid var(--border-light);">Your Maps</div>
          ${localRows.join("")}
        </div>`;
			}
		} catch (e) {
			console.warn("[layers]", e.message);
		}
		html += `<div style="border:1px solid var(--border-light);border-radius:4px;padding:10px;">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Connect a relay server to discover published communities.</div>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <input id="disc-relay-input" type="text" placeholder="${escapeHtml("wss://signal.catperson.online")}" value="" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:12px;" />
        <button id="disc-relay-connect" style="padding:6px 12px;border:1px solid #7c3aed;background:transparent;color:#7c3aed;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;">Connect</button>
      </div>
      <div style="font-size:10px;color:var(--text-muted);">Configure in ⚙ Settings. Self-host? The relay binary is in <code>signal-server/</code>.</div>
    </div>`;
		setTimeout(() => wireDiscoverRelayInput(), 0);
		return html;
	}
	function wireDiscoverRelayInput() {
		const input = document.getElementById("disc-relay-input");
		const btn = document.getElementById("disc-relay-connect");
		if (!input || !btn) return;
		const updateBtn = () => {
			btn.disabled = !input.value.trim();
		};
		input.addEventListener("input", updateBtn);
		btn.disabled = true;
		btn.onclick = async () => {
			const url = input.value.trim();
			if (!url) return;
			const listEl = document.getElementById("disc-list");
			if (listEl) listEl.innerHTML = `<div style="padding:40px 16px;text-align:center;color:var(--text-dim);font-size:14px;">Connecting to ${escapeHtml(url)}...</div>`;
			try {
				const relay = await import("./relay.js");
				await relay.saveRelayUrls([url]);
				await relay.connect(url);
				toast("Connected to relay", "#16a34a");
				window._renderUI?.();
				renderList();
			} catch (_) {
				if (listEl) {
					listEl.innerHTML = await renderLocalCommunities();
					wireDiscoverRelayInput();
				}
				toast("Failed to connect", "#dc2626");
			}
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && input.value.trim()) btn.click();
		});
	}
	async function renderList() {
		try {
			const mapBounds = state.map?.getBounds();
			const bboxArr = mapBounds ? [
				mapBounds.getSouth(),
				mapBounds.getWest(),
				mapBounds.getNorth(),
				mapBounds.getEast()
			] : null;
			const searchTerm = document.getElementById("disc-search")?.value?.trim()?.toLowerCase() || null;
			const relayConfigured = !!(localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url"));
			const relayConnected = window._relayIsConnected?.() || false;
			if (!relayConfigured) {
				listEl.innerHTML = await renderLocalCommunities();
				const filterLabel = document.getElementById("disc-filter-label");
				if (filterLabel) filterLabel.textContent = "";
				return;
			}
			let relayResults = [];
			try {
				if (relayConnected) relayResults = await window._relayFetchCommunityList?.() || [];
			} catch (e) {
				console.warn("[layers]", e.message);
			}
			let gossipResults = [];
			try {
				gossipResults = await import("./gossip.js").then((g) => g.queryPeers(bboxArr || [
					0,
					0,
					0,
					0
				])).then((responses) => {
					const all = [];
					for (const r of responses) if (r.results) all.push(...r.results);
					return all;
				}).catch(() => []);
			} catch (e) {
				console.warn("[layers]", e.message);
			}
			let relayGossipResults = [];
			try {
				if (bboxArr && relayConnected) relayGossipResults = await window._relayQueryCommunities?.(bboxArr, searchTerm) || [];
			} catch (e) {
				console.warn("[layers]", e.message);
			}
			const merged = /* @__PURE__ */ new Map();
			for (const r of relayResults) merged.set(r.community_id, {
				...r,
				source: "relay"
			});
			for (const g of relayGossipResults) {
				const existing = merged.get(g.community_id);
				if (existing) merged.set(g.community_id, {
					...existing,
					...g,
					pin_count: g.pin_count ?? existing.pin_count,
					member_count: existing.member_count ?? g.member_count,
					source: "relay + P2P"
				});
				else merged.set(g.community_id, {
					...g,
					source: "relay"
				});
			}
			for (const g of gossipResults) {
				const existing = merged.get(g.community_id);
				if (existing) merged.set(g.community_id, {
					...g,
					...existing,
					pin_count: g.pin_count ?? existing.pin_count,
					name: existing.name || g.name,
					source: existing.source.includes("P2P") ? existing.source : existing.source + " + P2P"
				});
				else merged.set(g.community_id, {
					...g,
					source: "P2P"
				});
			}
			const communities = [...merged.values()];
			let searchFiltered = communities;
			if (searchTerm) searchFiltered = communities.filter((c) => (c.name || "").toLowerCase().includes(searchTerm) || (c.description || "").toLowerCase().includes(searchTerm));
			let nearby = 0, elsewhere = 0;
			if (searchFiltered.length === 0) {
				listEl.innerHTML = `<div style="padding:16px;color:var(--text-dim);text-align:center;">
        ${searchTerm ? "No communities match your search." : "No communities published yet."}
      </div>`;
				const filterLabel = document.getElementById("disc-filter-label");
				if (filterLabel) filterLabel.textContent = relayConnected ? "No communities found" : "Relay not connected";
				return;
			}
			listEl.innerHTML = searchFiltered.filter((c) => {
				if (!geoFilter || !mapBounds) return true;
				const bnds = c.bounds;
				if (!bnds || !Array.isArray(bnds) || bnds.length !== 4) {
					elsewhere++;
					return false;
				}
				const [swLat, swLng, neLat, neLng] = bnds;
				try {
					const cb = leaflet_shim_default.latLngBounds([[swLat, swLng], [neLat, neLng]]);
					if (mapBounds.intersects(cb)) {
						nearby++;
						return true;
					}
					elsewhere++;
					return false;
				} catch (_) {
					elsewhere++;
					return false;
				}
			}).map((c) => {
				const contribBadge = c.governance?.contribution === "open" ? `<span style="background:rgba(5,150,105,0.15);color:#059669;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;">open</span>` : "";
				const lockIcon = c.password_protected ? `<span style="margin-right:2px;font-size:12px;">🔒</span>` : "";
				const srcLabel = c.source === "relay" ? "🌐 directory" : c.source === "P2P" ? "🔗 peer network" : c.source === "relay + P2P" ? "🌐 + 🔗" : "🔗 P2P";
				const pinInfo = c.pin_count !== void 0 && c.pin_count !== "?" ? `<span>${c.pin_count} pin${c.pin_count !== 1 ? "s" : ""}</span>` : c.pin_count === "?" ? `<span>? pins nearby</span>` : "";
				const memberInfo = c.member_count !== void 0 ? `<span>${c.member_count} member${c.member_count !== 1 ? "s" : ""}</span>` : "";
				return `
          <div class="disc-community-row" data-community-id="${escapeHtml(c.community_id)}" style="padding:10px;border-bottom:1px solid var(--border-light);cursor:default;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
              <span style="font-size:13px;font-weight:600;">${lockIcon}📌 ${escapeHtml(c.name)}${contribBadge}</span>
               <button class="disc-join-btn" data-id="${escapeHtml(c.community_id)}" data-bounds="${safeBounds(c.bounds)}" data-password-protected="${c.password_protected ? "1" : "0"}" style="padding:5px 14px;border:none;background:#059669;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;flex-shrink:0;">Join</button>
            </div>
            ${c.description ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:3px;">${escapeHtml(c.description.slice(0, 100))}${c.description.length > 100 ? "…" : ""}</div>` : ""}
            <div style="display:flex;gap:10px;font-size:10px;color:var(--text-muted);">
              ${pinInfo}
              ${memberInfo}
              <span>${srcLabel}</span>
              ${c.has_public_layers ? `<button class="disc-show-layers-btn" data-community-id="${escapeHtml(c.community_id)}" style="padding:2px 6px;border:1px solid #7c3aed;background:transparent;color:#7c3aed;border-radius:3px;cursor:pointer;font-size:10px;">Show Layers</button>` : ""}
            </div>
            <div class="disc-layer-list" data-community-id="${escapeHtml(c.community_id)}" style="display:none;margin-top:6px;border-top:1px solid var(--border-light);padding-top:6px;"></div>
          </div>
        `;
			}).join("");
			const filterLabel = document.getElementById("disc-filter-label");
			if (filterLabel) filterLabel.textContent = geoFilter && mapBounds ? `Showing ${nearby} near map view` : `Showing ${nearby + elsewhere} total`;
			listEl.querySelectorAll(".disc-join-btn").forEach((btn) => {
				btn.onclick = async (e) => {
					e.stopPropagation();
					const isPasswordProtected = btn.dataset.passwordProtected === "1";
					let passwordHash = null;
					let plaintextPass = null;
					if (isPasswordProtected) {
						plaintextPass = await promptRoomPassword("This community requires a password to join");
						if (!plaintextPass) return;
						passwordHash = await hashCommunityPassword(plaintextPass, btn.dataset.id);
					}
					btn.textContent = "Joining...";
					btn.disabled = true;
					try {
						const result = await window._relayJoinCommunity?.(btn.dataset.id, passwordHash);
						if (result && result.error === "wrong_password") {
							btn.textContent = "Join";
							btn.disabled = false;
							toast("Wrong password", "#dc2626");
							return;
						}
						if (result && result.public_key && result.wrapped_dek) {
							const sid = result.community_id;
							const isPasswordDerived = result.key_derivation === "pbkdf2";
							let public_key = result.public_key;
							let secret_key = "";
							let myWrappedDek = result.individually_wrapped_dek || "";
							if (isPasswordDerived && plaintextPass) {
								const { generate_user_keypair_from_password, encode_hex } = await import("./e2e_core.js");
								const kp = generate_user_keypair_from_password(plaintextPass, sid);
								public_key = encode_hex(kp.public);
								secret_key = encode_hex(kp.secret);
								myWrappedDek = result.wrapped_dek;
							} else {
								const { generate_user_keypair, encode_hex } = await import("./e2e_core.js");
								const kp = generate_user_keypair();
								public_key = encode_hex(kp.public);
								secret_key = encode_hex(kp.secret);
								if (!myWrappedDek) {
									if (result.join_wrapped_dek) try {
										const parts = result.join_wrapped_dek.split(":");
										if (parts.length === 3) {
											const { decrypt_with_password, decode_hex, wrap_dek } = await import("./e2e_core.js");
											myWrappedDek = wrap_dek(decode_hex(decrypt_with_password(parts[0], parts[1], parts[2], sid)), public_key);
											import("./relay.js").then((r) => {
												r.rewrapMemberDek(sid, public_key, myWrappedDek);
											}).catch(() => {});
										}
									} catch (e) {
										console.warn("[layers]", e.message);
									}
									if (!myWrappedDek) {
										const { requestMemberDek } = await import("./relay.js");
										requestMemberDek(sid, public_key);
									}
								}
							}
							if (!await getTeam(sid)) {
								await saveTeam({
									team_id: sid,
									name: result.name,
									public_key,
									secret_key,
									wrapped_dek: myWrappedDek || result.wrapped_dek,
									key_derivation: result.key_derivation || "random",
									community_secret_key: "",
									community_wrapped_dek: result.wrapped_dek || ""
								});
								await saveCommunity({
									community_id: sid,
									name: result.name,
									description: result.description || "",
									genesis_public_key: result.genesis_public_key || "",
									visibility: result.visibility || "public",
									members: result.members || [],
									governance: result.governance || {
										contribution: "open",
										validation: "none",
										schema_authority: "any_member",
										key_rotation: "founder_only",
										fork_policy: "allowed",
										join_policy: "open"
									},
									bounds: result.bounds && Array.isArray(result.bounds) && result.bounds.length === 4 ? result.bounds : null,
									relay_nodes: [],
									relay_url: (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url"))?.split(",")[0]?.trim() || null
								});
								await saveLayers(sid, [{
									layer_id: generate_uuid(),
									name: "Default",
									color: state.defaultLayerColor,
									visible: true,
									opacity: 1
								}]);
								window._names[sid] = (result.name || "Subscribed") + " (← subscribed)";
							}
							clean();
							const { switchSet, loadSetList } = await import("./map.js");
							await loadSetList();
							await switchSet(sid);
							if (result.needs_key_exchange && !isPasswordDerived && !myWrappedDek) toast("Joined " + result.name + " — awaiting key exchange", "#f97316");
							else {
								if (window._relayIsConnected?.()) await window._relaySyncDelta?.(sid);
								toast("Joined " + result.name, "#16a34a");
							}
							const { loadPins, loadDrawings } = await import("./map.js");
							await loadPins();
							await loadDrawings();
						} else {
							btn.textContent = "Join";
							btn.disabled = false;
							toast("Failed to join community", "#dc2626");
						}
					} catch (_) {
						btn.textContent = "Join";
						btn.disabled = false;
						toast("Failed to join community", "#dc2626");
					}
				};
			});
		} catch (e) {
			console.error("[discover] load error:", e);
			listEl.innerHTML = "<div style=\"padding:16px;color:var(--text-dim);text-align:center;\">Error loading communities</div>";
		}
	}
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:360px;max-width:440px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">🔍 Discover Communities</h3>
      <button id="disc-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <p style="font-size:11px;color:var(--text-dim);margin:0 0 8px;">Browse published communities on the relay and subscribe to ones you want to contribute to.</p>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <button id="disc-geo-filter" style="padding:3px 8px;border:1px solid #059669;background:rgba(5,150,105,0.1);color:#059669;border-radius:3px;cursor:pointer;font-size:11px;font-weight:500;">📍 Near map view</button>
      <input id="disc-search" type="text" placeholder="Filter by name..." style="flex:1;min-width:140px;padding:3px 8px;border:1px solid var(--border);border-radius:3px;background:var(--bg);color:var(--text);font-size:11px;">
      <span id="disc-filter-label" style="font-size:10px;color:var(--text-muted);"></span>
    </div>
    <div id="disc-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;margin-bottom:8px;">Loading...</div>
    <button id="disc-refresh" style="width:100%;padding:8px;border:1px dashed var(--border);background:transparent;color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:13px;">🔄 Refresh</button>
  </div>`;
	document.body.appendChild(ov);
	const listEl = document.getElementById("disc-list");
	const clean = () => ov.remove();
	document.getElementById("disc-close").onclick = clean;
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("disc-refresh").onclick = () => {
		listEl.innerHTML = "Loading...";
		renderList();
	};
	const geoFilterBtn = document.getElementById("disc-geo-filter");
	if (geoFilterBtn) geoFilterBtn.onclick = () => {
		geoFilter = !geoFilter;
		geoFilterBtn.textContent = geoFilter ? "📍 Near map view" : "🌐 All communities";
		geoFilterBtn.style.borderColor = geoFilter ? "#059669" : "#6b7280";
		geoFilterBtn.style.background = geoFilter ? "rgba(5,150,105,0.1)" : "transparent";
		geoFilterBtn.style.color = geoFilter ? "#059669" : "var(--text-dim)";
		listEl.innerHTML = "Loading...";
		renderList();
	};
	const searchInput = document.getElementById("disc-search");
	if (searchInput) {
		let searchTimer = null;
		searchInput.oninput = () => {
			clearTimeout(searchTimer);
			searchTimer = setTimeout(() => {
				listEl.innerHTML = "Loading...";
				renderList();
			}, 300);
		};
	}
	renderList();
}
function showLayersModal() {
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	function renderLayerList() {
		const layers = state.layers;
		listEl.innerHTML = layers.length > 0 ? layers.map((l) => {
			const isVisible = l.visible;
			const isActive = l.layer_id === state.activeLayerId;
			const eyeIcon = isVisible ? "👁" : "–";
			const schemaOpts = `<option value="">none</option>` + state.schemas.map((s) => `<option value="${s.schema_id}" ${s.schema_id === l.default_schema_id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
			const schemaLabel = l.default_schema_id ? `<span style="font-size:10px;color:#059669;">📋 ${escapeHtml((state.schemas.find((s) => s.schema_id === l.default_schema_id) || {}).name || "?")}</span>` : `<span style="font-size:10px;color:var(--text-muted);">no schema</span>`;
			const activeIndicator = isActive ? "● " : "○ ";
			const colorDot = `<span class="layer-dot" style="background:${l.color};"></span>`;
			return `<div class="layer-pill" style="${isActive ? "background:var(--bg-input);border-left:3px solid " + l.color + ";" : ""}">
          ${colorDot}
          <div style="flex:1;">
            <span class="ly-name ly-activate" data-id="${l.layer_id}" style="font-size:13px;cursor:pointer;${isActive ? "font-weight:600;" : ""}">${activeIndicator}${escapeHtml(l.name.slice(0, 30))}</span>
            <br>${schemaLabel}
          </div>
          <select class="ly-schema-sel" data-id="${l.layer_id}" style="max-width:110px;padding:3px;border:1px solid #059669;border-radius:3px;background:var(--bg-input);color:var(--text);font-size:10px;">${schemaOpts}</select>
          <button class="ly-vis-btn" data-id="${l.layer_id}" style="padding:3px 7px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:12px;${isVisible ? "color:#16a34a;" : "color:var(--text-dim);"}">${eyeIcon}</button>
          <button class="ly-rename-btn" data-id="${l.layer_id}" style="padding:3px 6px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:11px;color:var(--text-dim);">✎</button>
          <button class="ly-del-btn" data-id="${l.layer_id}" style="padding:3px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:14px;line-height:1;">×</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding:2px 10px 6px 28px;font-size:11px;color:var(--text-dim);">
          <span>opacity:</span>
          <input type="range" class="ly-opacity" data-id="${l.layer_id}" min="1" max="10" value="${Math.round(l.opacity * 10)}" style="flex:1;accent-color:${l.color};" />
          <span style="min-width:32px;text-align:right;">${Math.round(l.opacity * 100)}%</span>
        </div>`;
		}).join("") : "<div style=\"padding:12px;color:var(--text-dim);text-align:center;\">No layers</div>";
		listEl.querySelectorAll(".ly-vis-btn").forEach((btn) => {
			btn.onclick = async (e) => {
				e.stopPropagation();
				await toggleLayer(btn.dataset.id);
				renderLayerList();
				window._renderUI?.();
			};
		});
		listEl.querySelectorAll(".ly-activate").forEach((span) => {
			span.onclick = async (e) => {
				e.stopPropagation();
				const lid = span.dataset.id;
				state.activeLayerId = state.activeLayerId === lid ? null : lid;
				renderLayerList();
				window._renderUI?.();
			};
		});
		listEl.querySelectorAll(".ly-schema-sel").forEach((sel) => {
			sel.onchange = async (e) => {
				e.stopPropagation();
				const layerId = sel.dataset.id;
				const layer = state.layers.find((l) => l.layer_id === layerId);
				if (!layer) return;
				layer.default_schema_id = sel.value || null;
				await saveLayers(state.currentSet, state.layers);
				renderLayerList();
				window._renderUI?.();
			};
		});
		listEl.querySelectorAll(".ly-rename-btn").forEach((btn) => {
			btn.onclick = async (e) => {
				e.stopPropagation();
				const layerId = btn.dataset.id;
				const span = btn.parentElement.querySelector(".ly-name");
				const current = state.layers.find((l) => l.layer_id === layerId);
				if (!current) return;
				span.innerHTML = `<input type="text" class="ly-rename-input" value="${escapeHtml(current.name)}" style="width:100%;padding:2px;border:1px solid #2563eb;border-radius:3px;font-size:13px;box-sizing:border-box;" />`;
				const input = span.querySelector(".ly-rename-input");
				input.focus();
				input.select();
				const doRename = async () => {
					const newName = input.value.trim();
					if (newName) {
						await renameLayer(layerId, newName);
						renderLayerList();
					}
				};
				input.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter") doRename();
					if (ev.key === "Escape") renderLayerList();
				});
				input.addEventListener("blur", () => {
					setTimeout(() => {
						if (document.body.contains(input)) renderLayerList();
					}, 150);
				});
			};
		});
		listEl.querySelectorAll(".ly-del-btn").forEach((btn) => {
			btn.onclick = async (e) => {
				e.stopPropagation();
				if (state.layers.length <= 1) {
					toast("Cannot delete the last layer", "#f97316");
					return;
				}
				const lid = btn.dataset.id;
				const layer = state.layers.find((l) => l.layer_id === lid);
				const fallback = state.layers[0].layer_id === lid ? state.layers[1] : state.layers[0];
				if (!await confirmDialog(`Delete "${layer?.name || "layer"}"? Pins will move to "${fallback?.name || "Default"}".`)) return;
				await deleteLayer(lid);
				renderLayerList();
				window._renderUI?.();
			};
		});
		listEl.querySelectorAll(".ly-opacity").forEach((slider) => {
			slider.oninput = (e) => {
				const id = slider.dataset.id;
				const val = parseInt(slider.value, 10) / 10;
				setLayerOpacity(id, val);
				const label = slider.nextElementSibling;
				if (label) label.textContent = Math.round(val * 100) + "%";
			};
		});
	}
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:340px;max-width:420px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">📑 ${t("layers") || "Layers"} — ${escapeHtml((window._names?.[state.currentSet] || t("map") || "Map").slice(0, 20))}</h3>
      <button id="ly-modal-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <p style="font-size:11px;color:var(--text-dim);margin:0 0 6px;">Organize pins into layers. Toggle visibility and adjust opacity per layer.</p>
    <div style="display:flex;gap:6px;margin-bottom:8px;">
      <button id="ly-new-btn" style="flex:1;padding:6px;border:1px dashed #7c3aed;background:transparent;color:#7c3aed;border-radius:4px;cursor:pointer;font-size:12px;">+ ${t("newLayer") || "New Layer"}</button>
      <button id="ly-import-btn" style="padding:6px 10px;border:1px solid #0891b2;background:transparent;color:#0891b2;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;">📥 ${t("importFromMap") || "Import"}</button>
    </div>
    <div id="ly-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;margin-bottom:0;"></div>
  </div>`;
	document.body.appendChild(ov);
	const listEl = document.getElementById("ly-list");
	const clean = () => ov.remove();
	document.getElementById("ly-modal-close").onclick = clean;
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("ly-new-btn").onclick = () => {
		const btn = document.getElementById("ly-new-btn");
		if (!btn) return;
		const parent = btn.parentElement;
		btn.style.display = "none";
		const form = document.createElement("div");
		form.style.cssText = "display:flex;gap:4px;margin-bottom:8px;";
		form.innerHTML = `<input id="ly-new-input" placeholder="${t("newLayerPrompt") || "Layer name:"}" style="flex:1;padding:5px;border:1px solid #7c3aed;border-radius:4px;background:var(--bg-input);color:var(--text);font-size:12px;" />
      <button id="ly-new-ok" style="padding:5px 10px;border:none;background:#7c3aed;color:white;border-radius:4px;cursor:pointer;font-size:12px;">OK</button>
      <button id="ly-new-cancel" style="padding:5px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-dim);">×</button>`;
		parent.insertBefore(form, btn.nextSibling);
		const input = form.querySelector("#ly-new-input");
		input.focus();
		const done = async () => {
			form.remove();
			btn.style.display = "";
			const name = input.value.trim();
			if (name) {
				await createLayer(name);
				if (document.body.contains(ov)) renderLayerList();
				window._renderUI?.();
			}
		};
		form.querySelector("#ly-new-ok").onclick = done;
		form.querySelector("#ly-new-cancel").onclick = () => {
			form.remove();
			btn.style.display = "";
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") done();
			if (e.key === "Escape") {
				form.remove();
				btn.style.display = "";
			}
		});
	};
	document.getElementById("ly-import-btn").onclick = async () => {
		const { showImportFromMapModal } = await import("./map-import2.js");
		showImportFromMapModal();
	};
	renderLayerList();
}
//#endregion
//#region map.js
var TUTORIAL_PINS = [
	{
		lat: 51.505,
		lng: -.09,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "Welcome to piggPin!",
		note: "piggPin is a peer-to-peer encrypted collaborative map — no accounts, no cloud. You write the map. You own the data. Everything is encrypted with X25519 + ChaCha20Poly1305 before it ever touches storage.\n\nThis tutorial introduces every feature. Click ▶ Slideshow to fly through all pins, or tap each one to learn a specific capability. Each pin lives in a layer — look at 📑 Layers to see how they're organized. Tutorial pins are full opacity; story pins are slightly transparent."
	},
	{
		lat: 40.6892,
		lng: -74.0445,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "Peer-to-Peer Sync",
		note: "Click 'Host Group' to generate a connection code, QR code, or shareable link. Peers connect directly via WebRTC — no server holds your data. Your map syncs automatically.\n\nJoin a peer by scanning their QR, pasting their connection string, or using a relay link. Peers auto-connect to each other in a mesh — not just to the host. Toggle 'Follow' to sync map position across connected peers."
	},
	{
		lat: 35.6595,
		lng: 139.7004,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "Placing Pins",
		note: "Press 'N' or click the 📌 pin button, then click anywhere on the map. Each pin gets a title, description, color, emoji, and optional photo or video.\n\nIf your active layer has a schema (📋), the pin form shows custom typed fields — text, number, choice, date, time, boolean — instead of a generic note. Use Shift+click to multi-select. Ctrl+Z / Ctrl+Y to undo and redo."
	},
	{
		lat: -33.9628,
		lng: 18.4098,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "Drawing Shapes & Free Draw",
		note: "Use the toolbar on the left to draw polygons, polylines, rectangles, and circles. Click the free draw button to sketch any path freehand — great for marking trails or boundaries.\n\nAll shapes get automatic metrics: circumference, diameter, area, length, and perimeter. Toggle metric/imperial with a single click. Drawings support file attachments, custom colors, and arrow heads."
	},
	{
		lat: 48.8566,
		lng: 2.3522,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "📑 Layers",
		note: "Layers organize pins into named categories within a map. Click 📑 Layers next to the map name. Each layer has:\n\n• A color for visual identification\n• Visibility toggle (👁) to show or hide its pins\n• Opacity slider to fade pins into the background\n• Click the layer name (●) to make it active — new pins land there. The tab bar shows → LayerName in the active color.\n\nDelete a layer and its pins reassign to the first remaining layer."
	},
	{
		lat: 37.7749,
		lng: -122.4194,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "📋 Schemas",
		note: "Schemas define custom pin forms with typed fields. Click 📋 Schemas, then + New Schema. Add fields: text for names, number for counts, choice for dropdowns, date for calendars, time for clocks, boolean for true/false.\n\nBind a schema to a layer in 📑 Layers — every new pin on that layer shows that custom form. Schemas are global: create once, reuse on any map. Keys auto-generate from field labels. Reorder fields with ▲▼."
	},
	{
		lat: 39.9163,
		lng: 116.3972,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "Managing Maps & Export",
		note: "Click 🗺 Maps to see all your saved maps. Switch between them, rename, or delete. Each map has its own pins, drawings, layers, and encryption keys.\n\nExport any map as an encrypted .piggpin file — layers, schemas, custom data, and media all travel together. Import maps from files, shared links, or QR codes. Import layers from other maps via 📑 Layers → 📥."
	},
	{
		lat: 30.0444,
		lng: 31.2357,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "Security & Key Rotation",
		note: "Every map has its own Data Encryption Key (DEK) wrapped by your personal X25519 key pair. All pins, drawings, and media are encrypted with ChaCha20Poly1305 client-side. Keys and plaintext never reach a server.\n\nUse 'Rotate Keys' to re-encrypt everything with a new DEK — old keys can no longer read new data. Export with an optional password for an extra layer of protection."
	},
	{
		lat: 50.1109,
		lng: 8.6821,
		color: "#7c3aed",
		layer: "Tutorial",
		title: "Relay Server & Self-Hosting",
		note: "A relay server helps peers connect behind firewalls and NAT. Open the drawer on the right → Settings → Relay to configure your ICE servers and WebSocket relay URL.\n\nHost your own signal relay to keep everything self-hosted and private. The Rust relay binary is included in signal-server/ — it handles WebSocket signaling, MQTT bridging, RNode bridging, and Reticulum bridging. Set usage limits, TTL expiration, and room passwords.\n\nOffline mesh: Meshtastic (USB/BLE), RNode (KISS/LoRa over WebSerial), and Reticulum (self-sovereign internet mesh) are supported."
	},
	{
		lat: 42.371,
		lng: -83.073,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Map the City Wouldn't Draw",
		tf: 1968,
		tt: 1971,
		note: "In 1968, geographer William Bunge moved to inner-city Detroit. Rather than exploring distant lands, he explored his own block. Working with community organizer Gwendolyn Warren, his Detroit Geographic Expedition produced maps of what the city refused to document: locations of pedestrian deaths from cars, rat bites reported by residents, machine gun positions in the neighborhood, and schools per child by zip code. The city's health department didn't collect rat-bite data. The transportation department didn't map where pedestrians died. Bunge's maps were arguments — for crosswalks, for pest control, for resource redistribution. He was later blacklisted as a communist.\n\nLesson: Your neighborhood doesn't exist on the official map until you put it there. piggPin exists so communities never wait for permission to document their own reality."
	},
	{
		lat: 36.163,
		lng: -95.989,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Map Survivors Kept",
		tf: 1921,
		tt: 1921,
		note: "On May 31, 1921, a white mob — some deputized by city officials — attacked Greenwood District in Tulsa, Oklahoma, known as Black Wall Street. They burned 35 square blocks. Between 39 and 300 people were killed. 10,000 were left homeless. The massacre was erased from official records for eighty years. Survivors preserved hand-drawn maps of destroyed businesses, churches, and homes. They mapped where bodies were buried — locations absent from every city document. In the 2020s, those survivor maps finally guided archaeologists to mass graves.\n\nLesson: When institutions erase history, community records endure. piggPin's encryption means your spatial knowledge survives — no matter who tries to suppress it."
	},
	{
		lat: 43.013,
		lng: -83.689,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Poison the State Said Was Fine",
		tf: 2014,
		note: "On April 25, 2014, Flint, Michigan's water source was switched to the Flint River without corrosion treatment. Lead leached from aging pipes. Over 6,000 children were exposed. State officials repeatedly denied the problem — spokesman Brad Wurfel told Michigan Radio: 'Anyone who is concerned about lead in the drinking water in Flint can relax.'\n\nFlint resident LeeAnne Walters collected water samples showing lead seven times the EPA limit. Virginia Tech professor Marc Edwards ran a citizen-science study sampling hundreds of homes. Pediatrician Dr. Mona Hanna-Attisha mapped children's blood lead levels before and after the switch — proving the state was wrong. When state agencies denied reality, community science produced the spatial data that forced acknowledgment.\n\nLesson: The people living the crisis collect the data that power denies. piggPin puts that spatial evidence in your hands — encrypted, so whistleblowers are protected."
	},
	{
		lat: 18.5333,
		lng: -72.3333,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "48 Hours to Map a Nation",
		tf: 2010,
		tt: 2010,
		note: "On January 12, 2010, a magnitude 7.0 earthquake struck Haiti. Over 100,000 people died. Before the quake, much of Haiti was unmapped on any digital platform. The UN, USAID, and search-and-rescue teams had no usable maps.\n\nWithin hours, OpenStreetMap volunteers worldwide began tracing satellite imagery — generously donated by GeoEye, DigitalGlobe, and others. Within 48 hours, they produced the first comprehensive street-level map of Port-au-Prince: collapsed bridges, displacement camps, functioning hospitals, blocked roads. This volunteer network outperformed every government agency. It was P2P mapping in practice, years before the term existed.\n\nLesson: When central infrastructure collapses, the network IS the map. piggPin builds this principle into its architecture — no server, no single point of failure, no agency that has to approve before you can act."
	},
	{
		lat: -22.91,
		lng: -43.2,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Double-Edged Map",
		note: "For decades, Rio de Janeiro's favelas — home to 25% of the city — appeared as blank spaces on official maps. No street names. No addresses. No mail delivery. No services. Residents couldn't prove they existed.\n\nIn response, residents built Wikimapa, crowdsourcing their own streets, businesses, and community landmarks. They mapped themselves into existence — and then the state mapped them for military occupation. The 2009 UPP pacification program used mapping to identify entry points, choke points, and gang-controlled zones. Being invisible on the map meant no services. Being visible meant surveillance.\n\nLesson: You need your data to exist — but not for the state to own it. piggPin's encrypted P2P model solves this paradox: your map exists within your trusted network and is cryptographically invisible to everyone else."
	},
	{
		lat: 30.03,
		lng: -90.75,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Air the Regulators Breathe",
		note: "Cancer Alley is an 85-mile stretch of the Mississippi River between Baton Rouge and New Orleans with over 200 petrochemical plants. The EPA found cancer risks 47 times federal thresholds — and near one plant, 700 times the national average. The state's tumor registry uses geographic units too large to detect neighborhood-level clusters.\n\nSince the 1990s, community organizations — the Louisiana Bucket Brigade, Rise St. James (led by Goldman Prize winner Sharon Lavigne) — have conducted their own air monitoring, mapped toxic release sites, and correlated them with health outcomes. These community maps have stopped multiple petrochemical expansions, including Formosa Plastics' proposed $9.4 billion complex.\n\nLesson: When regulators won't monitor, communities must. piggPin stores environmental data encrypted — protecting monitors and whistleblowers from the industries that dominate local employment."
	},
	{
		lat: 37.4215,
		lng: 141.0325,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "120 Million Points of Light",
		tf: 2011,
		note: "On March 11, 2011, the Fukushima Daiichi nuclear plant melted down. The Japanese government and TEPCO released radiation data widely considered incomplete and delayed. The very next day, three founders launched Safecast — a volunteer network building open-source Geiger counters (the bGeigie Nano) and mapping radiation across Japan from moving vehicles.\n\nBy 2020, Safecast accumulated over 120 million observations — the largest open dataset of background radiation ever collected. Independent validation found it highly correlated with US Department of Energy aerial survey data. In 2022, after Russia invaded Ukraine, Safecast deployed sensors in Chernobyl exclusion-zone areas, gathering over 300,000 readings.\n\nLesson: A decentralized network of volunteers with open-source hardware can produce higher-quality spatial data faster than a government-corporate complex with something to hide. piggPin adds encryption — critical in politically sensitive environmental crises."
	},
	{
		lat: 9.82,
		lng: 167.48,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Map Only the Maker Could Read",
		note: "For centuries, Marshallese navigators used stick charts — coconut midribs lashed together with shells tied at island positions — to map ocean swell patterns, not land. Each chart worked only for its maker: 'Individual navigator who made the chart was the only person who could fully interpret and use it.' The categories — mattang (teaching), meddo (regional), rebbelib (comprehensive) — encoded navigation knowledge passed father-to-son across generations.\n\nAfter World War II, the United States conducted 67 nuclear tests at Bikini Atoll. Displacement, reduced canoe travel, and electronic navigation destroyed the stick chart tradition within a single generation. A mapping system that survived centuries of Pacific exploration was erased by colonial technology and military violence.\n\nLesson: A map doesn't need to be legible to outsiders to be powerful. piggPin's encryption echoes the stick chart principle — data that is meaningful to the community that holds it and opaque to those who would misuse it."
	},
	{
		lat: 31.904,
		lng: 35.205,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Villages That Disappeared",
		note: "Since 2016, Google Maps has been documented as systematically underrepresenting Palestinian geography in the occupied West Bank. Palestinian village names, roads, and place markers are absent — while Israeli settlements, illegal under international law, are clearly labeled and navigable. The Green Line (1949 armistice line) isn't shown. Google uses algorithmic and policy justifications, but the effect is consistent: disappear Palestinian spatial existence from the world's most-used map. One billion users navigate a territory where one side's geography exists and the other's doesn't.\n\nLesson: When one corporation controls the map, entire populations can become cartographically illegible. piggPin's multi-source architecture means no single entity decides which places exist. Every community maintains its own markers. The map becomes a contested surface — not a pronouncement."
	},
	{
		lat: 39.957,
		lng: -75.228,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Block the City Bulldozed",
		tf: 1985,
		tt: 1985,
		note: "On May 13, 1985, the Philadelphia Police Department dropped two bombs from a helicopter onto the MOVE organization's communal house at 6221 Osage Avenue. The fire killed six MOVE members and five children. It destroyed 65 neighboring homes — an entire city block. The fire department admitted under oath they let it burn.\n\nAfterward, the city rebuilt the site. Street numbers changed. Physical evidence was demolished. The block became a spatial lacuna — its destruction suppressed from official records. For decades, former residents maintained the memory: who lived where, where the bombs fell, where bodies were found, which houses burned first. Community-produced maps and oral testimony preserved what the city's bulldozers and lawyers tried to erase.\n\nLesson: The palimpsest — layers of meaning that persist even when the surface is rewritten — preserves what power bulldozes. piggPin holds each layer; no authority can delete a community's truth from the map."
	},
	{
		lat: -25.3444,
		lng: 131.0369,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Continent That Was Sung",
		note: "For 50,000+ years, Aboriginal Australians navigated the continent using songlines — paths across land and sky traced by creator-beings during the Dreaming. Each songline encoded water sources, sacred sites, seasonal food locations, and territorial boundaries into song cycles. When sung in sequence, the melody described the topography. A knowledgeable person could navigate 3,500 km through desert by singing the right verses.\n\nBritish colonists found no paper maps and declared the continent terra nullius — nobody's land. In 1992, the Mabo decision overturned this fiction, but the epistemological violence continues. Mining companies still bulldoze sacred sites that exist in song but on no Western map. The 2020 destruction of Juukan Gorge — a 46,000-year-old site — happened because Rio Tinto's maps showed nothing there.\n\nLesson: The most sophisticated maps are sometimes sung, not drawn. piggPin's encrypted layers mirror the songline principle: knowledge held within trusted networks, invisible to those who would erase it."
	},
	{
		lat: 51.4833,
		lng: -124.2167,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Map That Won a Nation",
		tf: 2014,
		note: "For over a century, British Columbia claimed the Tsilhqot'in people had no legal title to their land. Then, in 2014, the Supreme Court of Canada unanimously declared Aboriginal title for the first time in Canadian history — 1,750 km² of traditional territory in the Nemiah Valley.\n\nThe evidence? Decades of community-produced maps: hunting routes, trap lines, village sites, burial grounds, spiritual locations. Chief Justice Beverley McLachlin wrote: 'The doctrine of terra nullius never applied in Canada.' Roger William, the Xeni Gwet'in chief who led the 30-year legal battle, proved that indigenous maps are legal documents — not folklore, not oral supplement, but evidence of sovereignty equal to any colonial deed.\n\nLesson: A community map, produced by the people who live on the land, can overturn centuries of legal fiction."
	},
	{
		lat: 45.75,
		lng: -101.2,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Pipeline That Moved Twice",
		tf: 2016,
		tt: 2017,
		note: "In 2016, Energy Transfer Partners planned the Dakota Access Pipeline to cross the Missouri River north of Bismarck, North Dakota. The US Army Corps rejected that route — too close to the city's water supply. So they moved it. The new route crossed the river just half a mile upstream from the Standing Rock Sioux Reservation.\n\nThe Standing Rock Sioux Tribe mapped what was in the pipeline's path: sacred stone features, burial grounds, and treaty boundaries from 1851 and 1868. On November 3, 2016, 524 clergy members burned copies of the papal bulls that established the Doctrine of Discovery — explicitly connecting a 21st-century pipeline to a 15th-century cartographic-legal doctrine that declared non-Christian lands available for taking.\n\nLesson: Environmental risk was literally remapped from a predominantly white community onto indigenous land. Community spatial data — treaty maps, sacred site locations, water infrastructure — became the infrastructure of resistance."
	},
	{
		lat: 63.7467,
		lng: -68.517,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "A Country the Size of Mexico",
		tf: 1999,
		note: "On April 1, 1999, the map of Canada changed for the first time since 1949. Nunavut separated from the Northwest Territories — 2,093,190 square kilometres, larger than Mexico, home to 36,000 people, 85% of them Inuit.\n\nThe boundaries were not drawn in Ottawa by distant administrators. They were negotiated over decades, informed by Inuit mapping of traditional hunting grounds, travel routes, and community locations. Inuit Tapiriit Kanatami, led by John Amagoalik — known as the father of Nunavut — used spatial data as a sovereignty tool. A 1982 plebiscite had supported the division. Inuktitut became an official language. The map was redrawn to reflect indigenous reality.\n\nLesson: Maps can be instruments of restitution, not just dispossession. Nunavut proves that borders can be negotiated, that territory can be returned, and that indigenous spatial knowledge can reshape a nation's geography."
	},
	{
		lat: -.5,
		lng: 35.5,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "4,000 Years on the Map",
		tf: 2017,
		note: "The Ogiek people are among the oldest indigenous communities in East Africa — hunter-gatherers and honey-harvesters who have inhabited the Mau Forest of Kenya for over 4,000 years. The Kenyan government repeatedly evicted them, claiming they were destroying the watershed, while issuing land titles to politically-connected settlers and logging companies.\n\nIn 2017, the African Court on Human and Peoples' Rights ruled in the Ogiek's favour — the first indigenous land rights case decided by the court. The evidence? Community GIS mapping: beekeeping sites, sacred locations, hunting grounds, forest boundaries. Ogiek community organizations, supported by Minority Rights Group International, mapped their ancestral territory and proved sustainable stewardship that predates every modern state in the region. In 2022, the court ordered Kenya to pay reparations and formally recognize Ogiek indigeneity.\n\nLesson: Participatory mapping by the community — not external surveyors, not government agencies — was the evidence that won. The people who live on the land produced the map that proved they belong there."
	},
	{
		lat: 31.7958,
		lng: 35.1967,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Villages Erased from Time",
		tf: 1948,
		note: "In 1948, over 500 Palestinian villages were depopulated and physically destroyed. Many were bulldozed and rebuilt over. Some were renamed with Hebrew place names. Approximately 750,000 Palestinians were expelled or fled.\n\nFor decades, these villages existed in refugee memory — hand-drawn maps, house keys, land deeds — but not on any official map of Israel. Palestinian researchers Walid Khalidi (All That Remains, 1992) and Salman Abu Sitta (Atlas of Palestine, 2010) painstakingly reconstructed the locations, populations, and land holdings of every destroyed village. The Israeli NGO Zochrot built an interactive map marking each site. Then, in 2011, Israel passed the Nakba Law, allowing the state to cut funding to institutions that commemorate the Nakba — making counter-mapping an act of direct political resistance.\n\nLesson: When the state makes spatial memory illegal, community maps preserve what was erased. The palimpsest holds each layer — the village that was there, the settlement that replaced it, and the memory that refuses erasure."
	},
	{
		lat: 50.68,
		lng: -120.34,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Graves That Weren't on Any Map",
		tf: 2021,
		note: "In May 2021, the Tk'emlúps te Secwépemc Nation announced that ground-penetrating radar had detected 215 unmarked children's graves at the former Kamloops Indian Residential School. Within months, similar discoveries followed across Canada.\n\nOver 139 residential schools operated from the 1880s through 1996, removing Indigenous children from their families under a policy the Truth and Reconciliation Commission later classified as cultural genocide. None of these schools appeared on standard government maps. The children who died at them — from tuberculosis, malnutrition, abuse, neglect — were buried in graves that did not appear on any map either. The cartographic absence was not accidental. It was part of the paper genocide — the systematic erasure of Indigenous presence from official records.\n\nThe TRC's 2015 final report explicitly called for mapping every school and every grave. Survivors had been saying where the bodies were for decades. They just needed someone to look.\n\nLesson: What is absent from the map is as political as what appears on it. Mapping the schools is now an act of truth and reconciliation — spatial evidence that can no longer be denied."
	},
	{
		lat: -13.532,
		lng: -71.9675,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Library Made of Knots",
		tf: 1583,
		tt: 1583,
		note: "The Inca Empire managed a territory stretching 5,000 km along the Andes using quipus — knotted-cord recording devices. Using a decimal positional system, colour coding, and knot types, quipucamayocs (knot specialists) recorded census data, tax obligations, resource distribution, and spatial information. They could read by touch what others could not see.\n\nIn 1583, the Third Council of Lima ordered quipus burned as 'idolatrous objects' that recorded offerings to non-Christian gods. Of an estimated tens of thousands, only approximately 1,400 survive today. The largest collection — 298 quipus — is held at the Ethnological Museum in Berlin, thousands of kilometres from the Andes. The Spanish systematically destroyed Andean information infrastructure the same way they burned Maya codices.\n\nThe quipu was functionally encrypted: its multiple simultaneous encoding dimensions (colour, knot type, spatial position, fiber type) meant only the maker and their community could fully decode it.\n\nLesson: Five hundred years before PGP, the quipu proved that a community's data could be encoded in a format illegible to colonizers. piggPin's encryption is not new technology. It is a very old idea — data that speaks only to those who hold the key."
	},
	{
		lat: 19.4326,
		lng: -99.1332,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Buried Metropolis",
		note: "Mexico City is built on top of Tenochtitlan, the Aztec capital founded in 1325 on an island in Lake Texcoco. At its peak, it held over 200,000 people — larger than any city in Europe at the time — connected by causeways and fed by aqueducts.\n\nWhen Hernán Cortés arrived in 1519, his soldiers described a city of gleaming temples and floating gardens rising from the water. Within two years, Tenochtitlan was destroyed, its stones repurposed to build the colonial capital. Today, its ruins are still being uncovered beneath the streets — the Templo Mayor, accidentally rediscovered by electrical workers in 1978, now sits beside the Metropolitan Cathedral. One city. Two worlds. Same ground."
	},
	{
		lat: -33.8568,
		lng: 151.2153,
		color: "#ef4444",
		layer: "Why This Matters",
		schema: null,
		title: "The Oldest Continuous Culture",
		note: "You're looking at Sydney Harbour, the traditional land of the Gadigal people of the Eora Nation. Aboriginal Australians have lived here for over 60,000 years — making this one of the oldest continuous cultures on Earth.\n\nThe Gadigal fished these waters, managed the land with fire, and passed down complex oral traditions across thousands of generations. When the First Fleet arrived in 1788 and anchored in this harbour, two worldviews collided — one measured in millennia, the other in empire. The Opera House now sits on Bennelong Point, named for a Wangal man who became a mediator between those worlds."
	},
	{
		lat: 29.9792,
		lng: 31.1342,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🔺",
		custom: {
			year_built: "2560",
			status: "Standing",
			century: "Ancient",
			unesco: "true"
		},
		title: "Great Pyramid of Giza",
		tf: -2560,
		note: "Built ~2560 BCE for Pharaoh Khufu. Tallest structure on Earth for 3,800 years. 2.3 million stone blocks. Only surviving Ancient Wonder."
	},
	{
		lat: -13.1631,
		lng: -72.545,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🦙",
		custom: {
			year_built: "1450",
			status: "Standing",
			century: "Ancient",
			unesco: "true"
		},
		title: "Machu Picchu",
		tf: 1450,
		note: "Inca citadel high in the Andes, built ~1450. Abandoned during Spanish conquest, unknown to the outside world until Hiram Bingham's 1911 expedition. Precision stonework without mortar."
	},
	{
		lat: 30.3285,
		lng: 35.4444,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🏛️",
		custom: {
			year_built: "300",
			status: "Standing",
			century: "Ancient",
			unesco: "true"
		},
		title: "Petra",
		note: "Nabataean capital carved from rose-red sandstone cliffs. Thrived as a caravan city on the incense routes. Elaborate water management in the desert. The Treasury facade is 40m tall."
	},
	{
		lat: 13.4125,
		lng: 103.867,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🛕",
		custom: {
			year_built: "1150",
			status: "Reconstructed",
			century: "Medieval",
			unesco: "true"
		},
		title: "Angkor Wat",
		tf: 1150,
		note: "Largest religious monument on Earth, built by the Khmer Empire. Originally Hindu, later Buddhist. Surrounded by a 190m-wide moat. Intricate bas-reliefs span 1,200 square metres."
	},
	{
		lat: 41.8902,
		lng: 12.4922,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🏟️",
		custom: {
			year_built: "80",
			status: "Ruins",
			century: "Ancient",
			unesco: "true"
		},
		title: "Colosseum",
		tf: 80,
		note: "Completed 80 CE under Titus. Held 50,000–80,000 spectators for gladiatorial contests and public spectacles. The hypogeum beneath the arena floor held animals and fighters in a complex lift system."
	},
	{
		lat: 27.1751,
		lng: 78.0421,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🕌",
		custom: {
			year_built: "1653",
			status: "Standing",
			century: "Medieval",
			unesco: "true"
		},
		title: "Taj Mahal",
		tf: 1653,
		note: "Mughal emperor Shah Jahan built this marble mausoleum for his wife Mumtaz Mahal. 20,000 artisans worked for 22 years. The white marble appears to shift colour through the day."
	},
	{
		lat: -12.0393,
		lng: -77.0315,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "⛪",
		custom: {
			year_built: "1000",
			status: "Standing",
			century: "Medieval",
			unesco: "true"
		},
		title: "Historic Centre of Lima",
		note: "Founded by Pizarro in 1535 as the 'City of Kings.' The Plaza Mayor, Cathedral, and San Francisco monastery with its catacombs hold 500 years of colonial and indigenous history."
	},
	{
		lat: -8.958,
		lng: 39.513,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🏚️",
		custom: {
			year_built: "1200",
			status: "At Risk",
			century: "Medieval",
			unesco: "true"
		},
		title: "Kilwa Kisiwani",
		note: "Medieval Swahili trading city on the Tanzanian coast. Connected Africa to Arabia, Persia, India, and China. Coins minted here have been found across the Indian Ocean, from Arabia to Southeast Asia. Now a haunting ruin on a mangrove island."
	},
	{
		lat: -20.1597,
		lng: 57.5029,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🧱",
		custom: {
			year_built: "1849",
			status: "Standing",
			century: "Industrial",
			unesco: "true"
		},
		title: "Aapravasi Ghat",
		note: "Between 1834 and 1920, nearly half a million people passed through this stone immigration depot in Port Louis, Mauritius. They came from India — not as free migrants, but as indentured labourers, recruited under a system that replaced slavery after abolition across the British Empire. Many were deceived about the terms. Many never returned.\n\nThe British called it the 'Great Experiment.' Those who survived the brutal plantation conditions built new lives on the island, and their descendants now form the majority of Mauritius' population. Aapravasi Ghat is a UNESCO World Heritage site — not because the system was noble, but because the people who endured it must be remembered."
	},
	{
		lat: 50.8261,
		lng: -.1775,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🏰",
		custom: {
			year_built: "1787",
			status: "Standing",
			century: "Industrial",
			unesco: "false"
		},
		title: "Royal Pavilion",
		note: "George IV's seaside fantasy in Brighton — an Indo-Saracenic confection of minarets, domes, and chinoiserie interiors built between 1787–1823. A Grade I listed Regency oddity that defies architectural category."
	},
	{
		lat: 60.0069,
		lng: 11.5082,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🪵",
		custom: {
			year_built: "1190",
			status: "Standing",
			century: "Medieval",
			unesco: "false"
		},
		title: "Heddal Stave Church",
		note: "Norway's largest stave church, built entirely of pine around 1200. A triple-nave masterpiece of Viking-era craftsmanship — dragon heads on the gables and carved portals blending pagan and Christian motifs."
	},
	{
		lat: 13.9057,
		lng: -4.5552,
		color: "#eab308",
		layer: "Heritage",
		schema: "heritage",
		emoji: "🕌",
		custom: {
			year_built: "1907",
			status: "Standing",
			century: "Medieval",
			unesco: "true"
		},
		title: "Great Mosque of Djenné",
		note: "The largest mud-brick building in the world, in Djenné, Mali. The current structure dates to 1907, but a mosque has stood on this site since the 13th century, when Djenné was a center of Islamic learning and a key node in the trans-Saharan trade network.\n\nCaravans of camels carried gold, salt, ivory, and manuscripts across the desert, linking West Africa to the Mediterranean and beyond. Each year, the entire community replasters the mosque in a festival called the Crépissage — a living tradition of collective maintenance that has survived empires, colonialism, and modern states."
	},
	{
		lat: 36.1069,
		lng: -112.1129,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🏜️",
		custom: {
			feature_type: "Canyon",
			elevation_m: "1600",
			protected: "true",
			best_season: "Spring"
		},
		title: "Grand Canyon",
		note: "Carved by the Colorado River over 5–6 million years. 446km long, up to 29km wide, 1.8km deep. Exposes nearly two billion years of Earth's geological history in its layered walls."
	},
	{
		lat: -18.2871,
		lng: 147.6997,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🐠",
		custom: {
			feature_type: "Reef",
			elevation_m: "0",
			protected: "true",
			best_season: "Year-round"
		},
		title: "Great Barrier Reef",
		note: "World's largest coral reef system — 2,900 reefs, 900 islands, 2,300km long. Visible from space. Home to 1,500 fish species. Under severe threat from warming oceans and coral bleaching."
	},
	{
		lat: -25.6953,
		lng: -54.4367,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "💧",
		custom: {
			feature_type: "Waterfall",
			elevation_m: "180",
			protected: "true",
			best_season: "Summer"
		},
		title: "Iguazu Falls",
		note: "275 individual waterfalls spanning 2.7km along the Argentina-Brazil border. Taller than Niagara and wider than Victoria. The Devil's Throat drops 82 metres into a perpetual cloud of mist."
	},
	{
		lat: -3.0674,
		lng: 37.3556,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🗻",
		custom: {
			feature_type: "Mountain",
			elevation_m: "5895",
			protected: "true",
			best_season: "Summer"
		},
		title: "Mount Kilimanjaro",
		note: "Africa's highest peak — a dormant volcano with five climate zones from rainforest to arctic summit. The glaciers that crowned it for 11,000 years may vanish by 2050."
	},
	{
		lat: -3.4653,
		lng: -62.2159,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🌳",
		custom: {
			feature_type: "Forest",
			elevation_m: "100",
			protected: "false",
			best_season: "Year-round"
		},
		title: "Amazon Rainforest",
		note: "5.5 million km² across nine countries. 10% of all known species. 390 billion trees. A vital carbon sink and hydrological engine — the Amazon River discharges more water than the next seven largest rivers combined."
	},
	{
		lat: -17.9244,
		lng: 25.8567,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🌈",
		custom: {
			feature_type: "Waterfall",
			elevation_m: "885",
			protected: "true",
			best_season: "Spring"
		},
		title: "Victoria Falls",
		note: "Known locally as Mosi-oa-Tunya — 'The Smoke That Thunders.' 1,708m wide, 108m drop. The world's largest sheet of falling water. Spray rises 400m and can be seen 50km away."
	},
	{
		lat: 44.428,
		lng: -110.5885,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🌋",
		custom: {
			feature_type: "Mountain",
			elevation_m: "2500",
			protected: "true",
			best_season: "Summer"
		},
		title: "Yellowstone",
		note: "World's first national park (1872). Sits atop a supervolcano. Half of the world's geothermal features: geysers, hot springs, fumaroles. Old Faithful erupts every 60–110 minutes."
	},
	{
		lat: 31.132,
		lng: -8.6194,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🐪",
		custom: {
			feature_type: "Desert",
			elevation_m: "150",
			protected: "false",
			best_season: "Autumn"
		},
		title: "Erg Chebbi",
		note: "Morocco's iconic golden dunes rise to 150m. Part of the Sahara, the world's largest hot desert at 9.2 million km². Sand seas, oases, and ancient caravan routes that once carried salt and gold."
	},
	{
		lat: 54.6,
		lng: -2.5,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🏞️",
		custom: {
			feature_type: "Mountain",
			elevation_m: "978",
			protected: "true",
			best_season: "Summer"
		},
		title: "Lake District",
		note: "England's largest national park — glacial valleys, 16 lakes, and England's highest peak (Scafell Pike, 978m). Inspired Wordsworth, Coleridge, and Beatrix Potter. Over 3,000km of footpaths."
	},
	{
		lat: 79.47,
		lng: 11.3,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🐻‍❄️",
		custom: {
			feature_type: "Glacier",
			elevation_m: "0",
			protected: "true",
			best_season: "Summer"
		},
		title: "Svalbard",
		note: "Norwegian archipelago halfway to the North Pole. More polar bears than people. The Global Seed Vault stores backup seeds from gene banks worldwide in permafrost — a doomsday library for biodiversity."
	},
	{
		lat: -22.95,
		lng: -43.28,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🌳",
		custom: {
			feature_type: "Forest",
			elevation_m: "500",
			protected: "true",
			best_season: "Year-round"
		},
		title: "Tijuca Forest",
		note: "The world's largest urban forest, covering 32 square kilometres within Rio de Janeiro. But it wasn't always here. In the 1860s, after decades of coffee plantations had stripped the land bare and threatened the city's water supply, Emperor Pedro II ordered a massive reforestation. Over 100,000 seedlings were planted by hand — mostly by enslaved and formerly enslaved workers. Today, the forest shelters capuchin monkeys, toucans, sloths, and over 1,600 plant species. It is one of the first large-scale ecological restoration projects in history — a reminder that what was taken can sometimes be returned."
	},
	{
		lat: -1.2921,
		lng: 36.8219,
		color: "#16a34a",
		layer: "Nature",
		schema: "natural",
		emoji: "🦴",
		custom: {
			feature_type: "Mountain",
			elevation_m: "1600",
			protected: "true",
			best_season: "Year-round"
		},
		title: "Great Rift Valley",
		note: "A 6,000-kilometre tectonic divide stretching from Lebanon to Mozambique, formed as the African plate slowly tears apart. The fossil beds at Olduvai Gorge in Tanzania and the shores of Lake Turkana in Kenya have yielded some of the earliest hominin remains: Homo habilis, Paranthropus boisei, and Homo erectus. These discoveries rewrote the story of human origins, pushing it deeper into the past and firmly rooting it in African soil. The Rift is not just a scar in the Earth — it is where we began."
	},
	{
		lat: 35.6595,
		lng: 139.7004,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "🚦",
		custom: {
			observation_type: "Transport",
			rating: "5",
			visited: "2025-10-15",
			recommend: "true"
		},
		title: "Shibuya Crossing",
		note: "Tokyo's iconic scramble crossing — up to 3,000 people at once. Hachikō statue at the station: the Akita who waited nine years for his owner. Neon, noise, and the rhythm of the world's largest city."
	},
	{
		lat: 51.519,
		lng: -.1336,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "🧀",
		custom: {
			observation_type: "Market",
			rating: "4",
			visited: "2024-03-20",
			recommend: "true"
		},
		title: "Borough Market",
		note: "London's oldest food market, trading on this site since at least 1276. Under the railway arches near London Bridge. The globe theatre is a five-minute walk — Shakespeare likely shopped here."
	},
	{
		lat: 48.8867,
		lng: 2.3431,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "🎨",
		custom: {
			observation_type: "Architecture",
			rating: "5",
			visited: "2024-09-10",
			recommend: "true"
		},
		title: "Montmartre",
		note: "The hill of Paris where the Sacré-Cœur watches over the city. Once a village of windmills and vineyards, then the studio of Renoir, Picasso, and Van Gogh. Still holding onto its crooked, cobbled independence."
	},
	{
		lat: 41.0082,
		lng: 28.9784,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "🕌",
		custom: {
			observation_type: "Market",
			rating: "5",
			visited: "2025-03-18",
			recommend: "true"
		},
		title: "Grand Bazaar",
		note: "Istanbul's covered market, operating since 1461. 4,000 shops across 61 streets. One of the world's oldest and largest covered markets. The scent of spices, leather, and strong tea fills the air."
	},
	{
		lat: 47.6062,
		lng: -122.3407,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "🐟",
		custom: {
			observation_type: "Market",
			rating: "4",
			visited: "2024-06-05",
			recommend: "true"
		},
		title: "Pike Place Market",
		note: "Seattle's century-old public market overlooking Elliott Bay. Fishmongers throw salmon. The original Starbucks sits across the street. Below the market, the gum wall is a strangely beloved attraction."
	},
	{
		lat: 28.6562,
		lng: 77.2318,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "🍛",
		custom: {
			observation_type: "Market",
			rating: "4",
			visited: "2023-11-14",
			recommend: "true"
		},
		title: "Chandni Chowk",
		note: "Old Delhi's chaotic, glorious artery. Laid out in 1650 by Shah Jahan's daughter. Silver shops, spice markets, street food stalls that have served the same recipe for generations. The lane of parathas."
	},
	{
		lat: -34.631,
		lng: -58.41,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "💃",
		custom: {
			observation_type: "Architecture",
			rating: "5",
			visited: "2022-09-01",
			recommend: "true"
		},
		title: "La Boca",
		note: "Buenos Aires' working-class port neighbourhood. Italian immigrants built homes from shipyard scraps and painted them in bright, clashing colours. Now a warren of tango, art, and defiant joy."
	},
	{
		lat: 22.3193,
		lng: 114.1694,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "⛴️",
		custom: {
			observation_type: "Transport",
			rating: "4",
			visited: "2025-01-20",
			recommend: "true"
		},
		title: "Star Ferry",
		note: "Hong Kong's green-and-white ferries have crossed Victoria Harbour since 1888. A six-minute journey between Kowloon and Central — one of the world's great commutes, with the skyline unfolding on both sides."
	},
	{
		lat: 55.6761,
		lng: 12.5683,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "🚲",
		custom: {
			observation_type: "Architecture",
			rating: "5",
			visited: "2023-07-12",
			recommend: "true"
		},
		title: "Nyhavn",
		note: "Copenhagen's 17th-century waterfront — once a rough sailors' district where Hans Christian Andersen lived. Now the candy-coloured townhouses are postcard-famous, but the harbour still holds its maritime soul."
	},
	{
		lat: 19.076,
		lng: 72.8777,
		color: "#2563eb",
		layer: "Urban",
		schema: "city",
		emoji: "🍱",
		custom: {
			observation_type: "Food",
			rating: "5",
			visited: "",
			recommend: "true"
		},
		title: "Mumbai Dabbawalas",
		note: "Every morning, over 5,000 dabbawalas — lunch delivery workers — collect 200,000 home-cooked meals from suburban kitchens and deliver them to offices across Mumbai. They use bicycles, hand carts, and the commuter rail system.\n\nThe meals are sorted and routed using a colour-coded system of symbols painted on the lids — no barcodes, no apps, no GPS. Harvard Business School studied them and found an error rate of roughly 1 in 16 million deliveries. They have operated continuously for over 130 years, through monsoons, strikes, and a pandemic. Just a deeply organized network of people who know their city better than any algorithm."
	},
	{
		lat: -22.9083,
		lng: -43.1964,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "🎭",
		custom: {
			month: "Feb",
			duration_days: "5",
			attendance: "2000000",
			free_entry: "true"
		},
		title: "Carnival — Rio de Janeiro",
		note: "The world's largest carnival. Samba schools spend the entire year preparing for 80 minutes in the Sambódromo. Over 2 million people fill the streets daily. A city that transforms into a single, breathing rhythm."
	},
	{
		lat: 48.1351,
		lng: 11.582,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "🍺",
		custom: {
			month: "Sep",
			duration_days: "16",
			attendance: "6000000",
			free_entry: "false"
		},
		title: "Oktoberfest — Munich",
		tf: 1810,
		note: "Started as a royal wedding celebration in 1810. Now 6 million visitors drink 7 million litres of beer across 16 days. Traditional Bavarian brass bands and dirndls. The largest Volksfest in the world."
	},
	{
		lat: 25.282,
		lng: 83.005,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "🪔",
		custom: {
			month: "Oct",
			duration_days: "5",
			attendance: "1000000",
			free_entry: "true"
		},
		title: "Diwali — Varanasi",
		note: "The festival of lights along the oldest living city on Earth. Thousands of diyas float on the Ganges at sunset. Fireworks echo off the ghats. A celebration of light over darkness that predates recorded history."
	},
	{
		lat: 17.0596,
		lng: -96.7266,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "💀",
		custom: {
			month: "Nov",
			duration_days: "2",
			attendance: "200000",
			free_entry: "true"
		},
		title: "Día de Muertos — Oaxaca",
		note: "Not a Halloween imitation but a pre-Hispanic tradition blending with Catholicism. Families build ofrendas, cemeteries glow with marigolds and candles. The dead are welcomed home for one night."
	},
	{
		lat: 27.4793,
		lng: 77.6833,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "🎨",
		custom: {
			month: "Mar",
			duration_days: "2",
			attendance: "500000",
			free_entry: "true"
		},
		title: "Holi — Mathura",
		note: "The birthplace of Krishna erupts in colour. Strangers throw gulal powder, water balloons, and joy. Social hierarchies dissolve under layers of pink, blue, and green. A festival older than most modern borders."
	},
	{
		lat: 39.4192,
		lng: -.3244,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "🍅",
		custom: {
			month: "Aug",
			duration_days: "1",
			attendance: "20000",
			free_entry: "false"
		},
		title: "La Tomatina — Buñol",
		tf: 1945,
		note: "A small Spanish town of 9,000 floods with 20,000 people and 150,000 kilos of overripe tomatoes. For exactly one hour, the streets become a river of red pulp. How it started: a childish street brawl in 1945."
	},
	{
		lat: 13.7563,
		lng: 100.5018,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "🔫",
		custom: {
			month: "Apr",
			duration_days: "3",
			attendance: "500000",
			free_entry: "true"
		},
		title: "Songkran — Bangkok",
		note: "Thai New Year — the world's biggest water fight. Originally a gentle ritual of pouring water over elders' hands for blessings. Now the streets of Bangkok become a citywide aquatic battle for three days."
	},
	{
		lat: 55.9533,
		lng: -3.1883,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "🎪",
		custom: {
			month: "Aug",
			duration_days: "25",
			attendance: "3500000",
			free_entry: "false"
		},
		title: "Edinburgh Fringe",
		tf: 1947,
		note: "The world's largest arts festival. 3,500 shows, 50,000 performances, 300 venues. A former school hall, a pub basement, a parked taxi — everything becomes a stage. The city doubles in population for August."
	},
	{
		lat: 35.021,
		lng: 135.7601,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "🏮",
		custom: {
			month: "Jul",
			duration_days: "30",
			attendance: "1000000",
			free_entry: "true"
		},
		title: "Gion Matsuri — Kyoto",
		tf: 869,
		note: "Japan's most famous festival, running since 869 CE — originally a purification ritual to appease gods during a plague. The grand parade of yamaboko floats, some weighing 12 tonnes, threads through Kyoto's narrow streets."
	},
	{
		lat: 12.035,
		lng: 39.047,
		color: "#ec4899",
		layer: "Festivals",
		schema: "festival",
		emoji: "✝️",
		custom: {
			month: "Jan",
			duration_days: "3",
			attendance: "100000",
			free_entry: "true"
		},
		title: "Timkat — Lalibela",
		note: "Ethiopian Orthodox celebration of Epiphany at the rock-hewn churches of Lalibela — carved downward into solid volcanic stone in the 12th century. Priests carry replica Arks of the Covenant. A 3-day immersion in incense, chant, and white robes."
	}
];
function hexToBytes(hex) {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		const v = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
		if (isNaN(v)) return new Uint8Array(0);
		bytes[i] = v;
	}
	return bytes;
}
async function checkStorageQuota(neededBytes, label) {
	try {
		const est = await navigator.storage.estimate();
		const free = est.quota - est.usage;
		if (neededBytes > free * .9) {
			const mbFree = Math.round(free / 1024 / 1024);
			toast(`Low storage: ${Math.round(neededBytes / 1024 / 1024)}MB ${label}, only ${mbFree}MB free`, "#f97316");
		}
	} catch (e) {
		console.warn("[map]", e.message);
	}
}
async function compressMedia(file, onProgress) {
	if (!file.type.startsWith("image/") || file.type.includes("gif") || file.type.includes("svg")) {
		if (file.type.startsWith("video/")) {
			if (file.type.startsWith("video/webm")) return {
				buffer: await file.arrayBuffer(),
				type: file.type,
				name: file.name
			};
			try {
				const buf = new Uint8Array(await file.arrayBuffer());
				const fastResult = await compressVideoBuffer(buf, file.type, file.name);
				if (fastResult) return {
					buffer: fastResult.buffer.buffer,
					type: fastResult.type,
					name: fastResult.name
				};
				const result = await compressVideoBytes(buf, file.type, file.name, onProgress);
				if (result) return {
					buffer: result.buffer.buffer,
					type: result.type,
					name: result.name
				};
			} catch (e) {
				console.warn("[map]", e.message);
			}
		}
		return {
			buffer: await file.arrayBuffer(),
			type: file.type,
			name: file.name
		};
	}
	try {
		const result = await compressImageBuffer(await file.arrayBuffer(), file.type, file.name);
		return {
			buffer: result.buffer,
			type: result.type,
			name: result.name
		};
	} catch (_) {
		return {
			buffer: await file.arrayBuffer(),
			type: file.type,
			name: file.name
		};
	}
}
async function compressVideoBytes(bytes, mimeType, fileName, onProgress) {
	const MAX_DIM = 1280;
	const BITRATE = 15e5;
	const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
	const video = document.createElement("video");
	video.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
	video.src = blobUrl;
	video.preload = "auto";
	video.playsInline = true;
	video.setAttribute("playsinline", "");
	video.setAttribute("muted", "");
	document.body.appendChild(video);
	let failReason = null;
	try {
		await new Promise((resolve, reject) => {
			video.onloadedmetadata = resolve;
			video.onerror = () => {
				failReason = "codec not supported";
				reject(/* @__PURE__ */ new Error("decode"));
			};
			setTimeout(() => {
				failReason = "timeout";
				reject(/* @__PURE__ */ new Error("timeout"));
			}, 15e3);
		});
		const vw = video.videoWidth, vh = video.videoHeight;
		if (!vw || !vh || video.duration < .5) {
			URL.revokeObjectURL(blobUrl);
			video.remove();
			return {
				buffer: bytes.slice(0),
				type: mimeType,
				name: fileName
			};
		}
		let w = vw, h = vh;
		if (w > MAX_DIM || h > MAX_DIM) {
			const r = Math.min(MAX_DIM / w, MAX_DIM / h);
			w = Math.round(w * r);
			h = Math.round(h * r);
		}
		w = Math.max(2, w - w % 2);
		h = Math.max(2, h - h % 2);
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		const canvasStream = canvas.captureStream(30);
		let audioTracks = [];
		try {
			audioTracks = video.captureStream().getAudioTracks();
		} catch (e) {
			console.warn("[map]", e.message);
		}
		const combined = audioTracks.length ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]) : canvasStream;
		const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
		const chunks = [];
		const recorder = new MediaRecorder(combined, {
			mimeType: mime,
			videoBitsPerSecond: BITRATE
		});
		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};
		const stopped = new Promise((r) => {
			recorder.onstop = r;
		});
		recorder.start(250);
		video.currentTime = 0;
		video.muted = true;
		video.volume = 0;
		await video.play();
		if (onProgress && video.duration > 0) video.addEventListener("timeupdate", () => {
			onProgress(Math.min(95, Math.round(video.currentTime / video.duration * 100)));
		});
		const draw = () => {
			if (!video.paused && !video.ended) {
				ctx.drawImage(video, 0, 0, w, h);
				requestAnimationFrame(draw);
			}
		};
		draw();
		await Promise.race([new Promise((r) => {
			video.addEventListener("ended", r, { once: true });
		}), new Promise((r) => setTimeout(r, (video.duration || 60) * 1e3 + 5e3))]);
		recorder.stop();
		await stopped;
		video.pause();
		video.remove();
		URL.revokeObjectURL(blobUrl);
		const blob = new Blob(chunks, { type: recorder.mimeType });
		return {
			buffer: new Uint8Array(await blob.arrayBuffer()),
			type: recorder.mimeType,
			name: fileName.replace(/\.[^.]+$/, ".webm"),
			compressed: true
		};
	} catch (_) {
		URL.revokeObjectURL(blobUrl);
		video.remove();
		return {
			buffer: bytes.slice(0),
			type: mimeType,
			name: fileName,
			compressed: false,
			reason: failReason
		};
	}
}
function initMap() {
	const map = leaflet_shim_default.map("map-container", {
		preferCanvas: true,
		inertia: true,
		zoomSnap: .25,
		zoomDelta: .5,
		attributionControl: false
	}).setView([51.505, -.09], 5);
	const blankTile = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAABlBMVEUAAAD///+l2Z/dAAAAL0lEQVR42u3BMQEAAADCIPunNsU+YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeF6FwAABHxR7WQAAAABJRU5ErkJggg==";
	const osm = leaflet_shim_default.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 19,
		errorTileUrl: blankTile,
		crossOrigin: "anonymous"
	});
	const satellite = leaflet_shim_default.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
		maxZoom: 19,
		attribution: "&copy; <a href=\"https://www.esri.com/\">Esri</a>",
		errorTileUrl: blankTile,
		crossOrigin: "anonymous"
	});
	osm.addTo(map);
	initPOILayer(map);
	const osmNotesLayer = initOSMNotesLayer(map);
	const baseMaps = {
		[t("street")]: osm,
		[t("satellite")]: satellite
	};
	const styleUrl = localStorage.getItem("pins-maplibre-style") || "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
	const pmtilesUrl = localStorage.getItem("pins-pmtiles-url");
	if (styleUrl || pmtilesUrl) import("maplibre-gl").then(async (maplibregl) => {
		try {
			if (!window.maplibregl) window.maplibregl = maplibregl;
			await new Promise((resolve, reject) => {
				if (leaflet_shim_default.maplibreGL) {
					resolve();
					return;
				}
				const s = document.createElement("script");
				s.src = "/leaflet/leaflet-maplibre-gl.js";
				s.onload = resolve;
				s.onerror = reject;
				document.head.appendChild(s);
			});
			if (!styleUrl && pmtilesUrl) {
				const { Protocol } = await import("pmtiles");
				maplibregl.addProtocol("pmtiles", new Protocol().tile);
			}
			const gl = leaflet_shim_default.maplibreGL({
				style: styleUrl || {
					version: 8,
					glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
					sources: { openmaptiles: {
						type: "vector",
						url: `pmtiles://${pmtilesUrl}`
					} },
					layers: [
						{
							id: "background",
							type: "background",
							paint: { "background-color": "#f8f4f0" }
						},
						{
							id: "water",
							type: "fill",
							source: "openmaptiles",
							"source-layer": "water",
							paint: { "fill-color": "#a0c8f0" }
						},
						{
							id: "landuse-residential",
							type: "fill",
							source: "openmaptiles",
							"source-layer": "landuse",
							filter: [
								"==",
								"class",
								"residential"
							],
							paint: { "fill-color": "#e8e0d8" }
						},
						{
							id: "road-major",
							type: "line",
							source: "openmaptiles",
							"source-layer": "transportation",
							filter: [
								"in",
								"class",
								"motorway",
								"trunk",
								"primary"
							],
							paint: {
								"line-color": "#f8c8a0",
								"line-width": 3
							}
						},
						{
							id: "road-secondary",
							type: "line",
							source: "openmaptiles",
							"source-layer": "transportation",
							filter: [
								"in",
								"class",
								"secondary",
								"tertiary"
							],
							paint: {
								"line-color": "#ffffff",
								"line-width": 2
							}
						},
						{
							id: "building",
							type: "fill",
							source: "openmaptiles",
							"source-layer": "building",
							paint: {
								"fill-color": "#d4c8bc",
								"fill-opacity": .5
							}
						}
					]
				},
				attributionControl: false
			});
			baseMaps[t("vector")] = gl;
			window._mlMap = gl.getMaplibreMap();
			layersCtrl.addBaseLayer(gl, t("vector"));
			gl.getMaplibreMap()?.resize();
		} catch (e) {
			console.warn("[maplibre] init failed:", e.message);
		}
	}).catch(() => {});
	const layersCtrl = leaflet_shim_default.control.layers(baseMaps, { "OSM Notes": osmNotesLayer }, { position: "topleft" }).addTo(map);
	leaflet_shim_default.control.attribution({ prefix: false }).addAttribution("🌍 | 🌐 | &copy; <a href=\"https://www.openstreetmap.org/copyright\">OSM</a>").addTo(map);
	state.map = map;
	{
		const svBtn = leaflet_shim_default.DomUtil.create("button", "leaflet-control");
		svBtn.textContent = "🚶";
		svBtn.title = `${t("streetView")}`;
		svBtn.style.cssText = "width:32px;height:32px;border:none;border-radius:4px;background:#059669;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
		svBtn.onclick = (e) => {
			e.stopPropagation();
			state.streetViewing = !state.streetViewing;
			svBtn.style.background = state.streetViewing ? "#047857" : "#059669";
			state.map.getContainer().style.cursor = state.streetViewing ? "crosshair" : "";
		};
		const layersCtrl = map.getContainer().querySelector(".leaflet-control-layers");
		if (layersCtrl) layersCtrl.after(svBtn);
		else map.getContainer().appendChild(svBtn);
		const poiBtn = leaflet_shim_default.DomUtil.create("button", "leaflet-control");
		poiBtn.textContent = "☕";
		poiBtn.title = "OSM POI Categories";
		poiBtn.style.cssText = "width:32px;height:32px;border:none;border-radius:4px;background:#7c3aed;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;margin-left:3px;";
		poiBtn.onclick = (e) => {
			e.stopPropagation();
			showPOICategoryModal();
		};
		svBtn.after(poiBtn);
		const styleBtn = leaflet_shim_default.DomUtil.create("button", "leaflet-control");
		styleBtn.textContent = "🎨";
		styleBtn.title = "Map Style";
		styleBtn.style.cssText = "width:32px;height:32px;border:none;border-radius:4px;background:#0891b2;color:white;font-size:14px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;margin-left:3px;";
		styleBtn.onclick = (e) => {
			e.stopPropagation();
			showStylePicker();
		};
		poiBtn.after(styleBtn);
		map.on("overlayadd", (e) => {
			if (e.name === "OSM Notes") {
				toggleNotesEnabled();
				scheduleNotesRefresh();
			}
		});
		map.on("overlayremove", (e) => {
			if (e.name === "OSM Notes") {
				toggleNotesEnabled();
				clearNotesTimer();
			}
		});
		map.on("moveend", () => {
			if (isNotesEnabled()) scheduleNotesRefresh();
		});
	}
	state.clusterGroup = leaflet_shim_default.markerClusterGroup({
		maxClusterRadius: 50,
		disableClusteringAtZoom: 18,
		chunkedLoading: true
	}).addTo(map);
	const peerMarkerGroup = leaflet_shim_default.layerGroup().addTo(map);
	window._peerMarkerGroup = peerMarkerGroup;
	window._renderPeerMarkers = () => {
		peerMarkerGroup.clearLayers();
		const locs = window._peerLocations;
		if (!locs || !state.currentSet || !state.map) return;
		for (const [, loc] of locs) {
			if (loc.team_id !== state.currentSet) continue;
			const marker = leaflet_shim_default.circleMarker([loc.lat, loc.lng], {
				radius: 6,
				color: "#2563eb",
				fillColor: "#2563eb",
				fillOpacity: .4,
				weight: 2,
				interactive: true
			});
			marker.bindTooltip(loc.name, {
				direction: "top",
				offset: [0, -8],
				opacity: .9
			});
			marker.addTo(peerMarkerGroup);
		}
	};
	window._showDiscoveryBanner = (results) => {
		if (!results || results.length === 0 || !state.map) return;
		const existing = document.getElementById("gossip-discovery-banner");
		if (existing) existing.remove();
		const banner = leaflet_shim_default.DomUtil.create("div");
		banner.id = "gossip-discovery-banner";
		banner.style.cssText = "position:absolute;bottom:50px;left:50%;transform:translateX(-50%);z-index:1001;padding:8px 14px;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:6px;box-shadow:0 2px 12px var(--shadow);font-size:12px;white-space:nowrap;cursor:pointer;";
		const pc = results[0].pin_count;
		const pinLabel = pc === "?" ? "" : pc > 0 ? ` — ${pc} pin${pc !== 1 ? "s" : ""} nearby` : "";
		banner.innerHTML = `🔍 ${escapeHtml(results[0].name)}${pinLabel} `;
		const dismiss = leaflet_shim_default.DomUtil.create("span");
		dismiss.textContent = "✕";
		dismiss.style.cssText = "margin-left:6px;color:var(--text-dim);cursor:pointer;";
		dismiss.onclick = (e) => {
			e.stopPropagation();
			banner.remove();
		};
		banner.appendChild(dismiss);
		banner.onclick = () => {
			banner.remove();
			showDiscoverModal();
		};
		state.map.getContainer().appendChild(banner);
		setTimeout(() => banner.remove(), 1e4);
	};
	let moveTimer;
	map.on("moveend", () => {
		if (state.suppressMapSync) return;
		clearTimeout(moveTimer);
		moveTimer = setTimeout(async () => {
			if (state.currentSet) await saveSettings(state.currentSet, {
				map_center: [map.getCenter().lat, map.getCenter().lng],
				map_zoom: map.getZoom()
			});
			window._broadcast?.("map_view", {
				center: [map.getCenter().lat, map.getCenter().lng],
				zoom: map.getZoom()
			});
			import("./gossip.js").then((g) => g.notifyMapPan(map.getCenter().lat, map.getCenter().lng, map.getZoom())).catch(() => {});
		}, 500);
	});
	map.on("popupopen", (e) => {
		const el = e.popup?.getElement();
		if (!el) return;
		const pinEl = el.querySelector("[data-pin-id]");
		if (pinEl) renderAnnotationThread(pinEl.dataset.pinId);
	});
	map.on("popupclose", (e) => {
		const el = e.popup?.getElement();
		if (!el) return;
		const media = el.querySelectorAll("img[src^='blob:'], video[src^='blob:']");
		for (const m of media) URL.revokeObjectURL(m.src);
	});
	map.on("click", (e) => {
		if (state.streetViewing) {
			state.streetViewing = false;
			state.map.getContainer().style.cursor = "";
			const svBtn = map.getContainer().querySelector("button[title*=\"Street\" i]");
			if (svBtn) svBtn.style.background = "#059669";
			window.open(`https://www.mapillary.com/app/?lat=${e.latlng.lat}&lng=${e.latlng.lng}&z=17&focus=map`, "_blank");
			return;
		}
		if (isRoutingActive()) {
			addWaypoint(e.latlng.lat, e.latlng.lng);
			return;
		}
		if (!state.placingPin) return;
		state.placingPin = false;
		state.map.getContainer().style.cursor = "";
		showPinForm(e.latlng.lat, e.latlng.lng);
	});
	map.on("contextmenu", (e) => {
		if (state.placingPin || state.streetViewing || state.freeDrawing || state.measuring || state._selectionActive || isRoutingActive()) return;
		const existing = document.getElementById("map-context-menu");
		if (existing) existing.remove();
		showOSMContextMenu(e.latlng.lat, e.latlng.lng, e.originalEvent.clientX, e.originalEvent.clientY);
	});
	map.getContainer().addEventListener("dblclick", (e) => {
		if (!window.matchMedia("(max-width: 768px)").matches) return;
		if (state.placingPin || state.freeDrawing || state.measuring || state._selectionActive || state.streetViewing) return;
		e.stopPropagation();
		if (!document.fullscreenElement) document.documentElement.requestFullscreen();
		else document.exitFullscreen();
	});
	if (state._ttlInterval) clearInterval(state._ttlInterval);
	state._ttlInterval = setInterval(async () => {
		if (!state.dek || !state.currentSet) return;
		if (!{
			ttl_enabled: false,
			...state.currentCommunity?.governance || {}
		}.ttl_enabled) return;
		const now = Date.now();
		let changed = false;
		const markers = [...state.markers];
		for (const marker of markers) if (marker._ttlExpiresAt && marker._ttlExpiresAt < now) {
			try {
				await deletePin$1(marker._pinId);
				window._broadcast?.("delete_pin", { pin_id: marker._pinId });
			} catch (_) {}
			changed = true;
		}
		if (changed) {
			await loadPins();
			window._renderUI?.();
		}
	}, 3e4);
}
window._prefetchTiles = function({ sw_lat, sw_lng, ne_lat, ne_lng, minZoom = 10, maxZoom = 16 }) {
	if (!state.map) return;
	const activeLayer = state.map._layers ? Object.values(state.map._layers).find((l) => l._url) : null;
	if (!activeLayer || !activeLayer._url) return;
	const template = activeLayer._url;
	const subdomains = activeLayer.options?.subdomains || "abc";
	let count = 0;
	for (let z = minZoom; z <= maxZoom; z++) {
		const n = Math.pow(2, z);
		const lat2tile = (lat) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
		const lng2tile = (lng) => Math.floor((lng + 180) / 360 * n);
		const tx1 = lng2tile(sw_lng), tx2 = lng2tile(ne_lng);
		const ty1 = lat2tile(ne_lat), ty2 = lat2tile(sw_lat);
		for (let x = Math.min(tx1, tx2); x <= Math.max(tx1, tx2); x++) for (let y = Math.min(ty1, ty2); y <= Math.max(ty1, ty2); y++) {
			const s = subdomains[count % subdomains.length];
			const url = template.replace("{s}", s).replace("{z}", z).replace("{x}", x).replace("{y}", y);
			fetch(url, { mode: "no-cors" }).catch(() => {});
			count++;
		}
	}
	console.log(`[prefetch] Queued ${count} tiles (z${minZoom}-${maxZoom})`);
};
function pinIcon(c, emoji) {
	if (emoji) return leaflet_shim_default.divIcon({
		className: "emoji-pin",
		html: `<div style="font-size:28px;text-align:center;line-height:36px;">${escapeHtml(String(emoji))}</div>`,
		iconSize: [36, 36],
		iconAnchor: [18, 36],
		popupAnchor: [0, -36]
	});
	const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36"><path fill="${validateHex(c) || "#2563eb"}" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z"/><circle fill="#fff" cx="12" cy="12" r="4"/></svg>`;
	return leaflet_shim_default.icon({
		iconUrl: `data:image/svg+xml,${encodeURIComponent(s)}`,
		iconSize: [24, 36],
		iconAnchor: [12, 36],
		popupAnchor: [0, -36]
	});
}
async function loadSetList() {
	const a = await getAllTeams(), n = {};
	a.forEach((t) => n[t.team_id] = t.name);
	window._names = n;
}
async function switchSet(sid) {
	if (state.currentSet === sid) return;
	window._clearVotedPins?.(state.currentSet);
	window._clearDiscoveryCache?.();
	if (state._ttlInterval) {
		clearInterval(state._ttlInterval);
		state._ttlInterval = null;
	}
	state.currentSet = sid;
	state.activeLayerId = null;
	localStorage.setItem("activeSet", sid);
	state.dek = null;
	state.currentCommunity = null;
	window._clearHistory?.();
	state.markers.forEach((m) => m.remove());
	state.markers.length = 0;
	clearMarkerGrid();
	try {
		window._spatialIdx?.clear();
	} catch (e) {
		console.warn("[map]", e.message);
	}
	state.clusterGroup?.clearLayers();
	state._markerMap = null;
	state.drawingLayers.forEach((l) => state.map.removeLayer(l));
	state.drawingLayers.length = 0;
	state.chainLayers.forEach((l) => state.map.removeLayer(l));
	state.chainLayers.length = 0;
	window._peerMarkerGroup?.clearLayers();
	const t = await getTeam(sid);
	if (t) {
		if (t.secret_key && !("community_secret_key" in t)) {
			const memberKp = generate_user_keypair();
			let dk = null;
			try {
				dk = unwrap_dek(t.wrapped_dek, t.secret_key);
			} catch (e) {
				console.warn("[map] migration unwrap failed for", sid, e.message);
			}
			if (dk) {
				t.community_secret_key = t.secret_key;
				t.community_public_key = t.public_key;
				t.secret_key = encode_hex(memberKp.secret);
				t.public_key = encode_hex(memberKp.public);
				t.wrapped_dek = wrap_dek(dk, t.public_key);
				t.community_wrapped_dek = wrap_dek(dk, t.community_public_key);
				await saveTeam(t);
			}
		}
		state.dek = null;
		try {
			state.dek = unwrap_dek(t.wrapped_dek, t.secret_key);
		} catch (e) {
			console.warn("[map] DEK unwrap failed for", sid, e.message);
		}
	}
	state.currentCommunity = await getCommunity(sid);
	await loadLayersForSet(sid);
	await loadSchemasForSet(sid);
	const s = await getSettings(sid);
	if (s && s.map_center && state.map) {
		state.suppressMapSync = true;
		state.map.setView(s.map_center, s.map_zoom || 5);
		const token = state._syncToken = (state._syncToken || 0) + 1;
		setTimeout(() => {
			if (state._syncToken === token) state.suppressMapSync = false;
		}, 600);
	}
	await loadPins();
	await loadDrawings();
	await loadChains();
	window._renderUI?.();
	window._renderPeerMarkers?.();
	if (window._pendingMapView && state.map) {
		state.suppressMapSync = true;
		state.map.setView(window._pendingMapView.center, window._pendingMapView.zoom);
		delete window._pendingMapView;
		setTimeout(() => {
			state.suppressMapSync = false;
		}, 600);
	}
	window._broadcast?.("sync_request");
	if (window._relayIsConnected?.()) window._relaySyncDelta?.(sid).then(() => {
		loadPins();
		loadDrawings();
	}).catch(() => {});
}
var MAP_TEMPLATES = [
	{
		id: "disaster_response",
		name: "Disaster Response",
		icon: "🆘",
		description: "Layers and schemas for field response coordination.",
		layers: [
			{
				name: "Shelters",
				color: "#16a34a"
			},
			{
				name: "Hazards",
				color: "#dc2626"
			},
			{
				name: "Supplies",
				color: "#2563eb"
			}
		],
		schemas: [{
			name: "Shelter Report",
			fields: [{
				key: "capacity",
				label: "Capacity",
				type: "number"
			}, {
				key: "open",
				label: "Open",
				type: "boolean"
			}]
		}, {
			name: "Hazard Report",
			fields: [{
				key: "severity",
				label: "Severity",
				type: "choice",
				options: [
					"Low",
					"Medium",
					"High",
					"Critical"
				]
			}, {
				key: "description",
				label: "Description",
				type: "text"
			}]
		}]
	},
	{
		id: "farmers_market",
		name: "Farmers Market Directory",
		icon: "🥕",
		description: "Track vendors, products, and market locations.",
		layers: [{
			name: "Vendors",
			color: "#eab308"
		}, {
			name: "Markets",
			color: "#7c3aed"
		}],
		schemas: [{
			name: "Vendor Info",
			fields: [
				{
					key: "products",
					label: "Products",
					type: "text"
				},
				{
					key: "hours",
					label: "Hours",
					type: "text"
				},
				{
					key: "organic",
					label: "Organic",
					type: "boolean"
				}
			]
		}]
	},
	{
		id: "field_notes",
		name: "Field Notes",
		icon: "📝",
		description: "Observations, samples, and field research tracking.",
		layers: [{
			name: "Observations",
			color: "#ec4899"
		}, {
			name: "Samples",
			color: "#0891b2"
		}],
		schemas: [{
			name: "Observation",
			fields: [
				{
					key: "date_observed",
					label: "Date",
					type: "date"
				},
				{
					key: "category",
					label: "Category",
					type: "choice",
					options: [
						"Flora",
						"Fauna",
						"Geology",
						"Weather",
						"Other"
					]
				},
				{
					key: "notes",
					label: "Notes",
					type: "text"
				}
			]
		}]
	},
	{
		id: "event_planning",
		name: "Event Planning",
		icon: "🎪",
		description: "Venues, parking, and logistics for events.",
		layers: [
			{
				name: "Venues",
				color: "#f97316"
			},
			{
				name: "Parking",
				color: "#16a34a"
			},
			{
				name: "First Aid",
				color: "#dc2626"
			}
		],
		schemas: [{
			name: "Venue Info",
			fields: [
				{
					key: "capacity",
					label: "Capacity",
					type: "number"
				},
				{
					key: "contact",
					label: "Contact",
					type: "text"
				},
				{
					key: "confirmed",
					label: "Confirmed",
					type: "boolean"
				}
			]
		}]
	},
	{
		id: "travel_log",
		name: "Travel Log",
		icon: "✈️",
		description: "Places to stay, eat, and visit on your travels.",
		layers: [
			{
				name: "Accommodation",
				color: "#0891b2"
			},
			{
				name: "Food & Drink",
				color: "#eab308"
			},
			{
				name: "Sights",
				color: "#7c3aed"
			}
		],
		schemas: [{
			name: "Review",
			fields: [
				{
					key: "rating",
					label: "Rating",
					type: "number"
				},
				{
					key: "visited",
					label: "Visited",
					type: "date"
				},
				{
					key: "recommend",
					label: "Recommend",
					type: "boolean"
				}
			]
		}]
	}
];
async function createSetFromTemplate(templateId) {
	const tmpl = MAP_TEMPLATES.find((t) => t.id === templateId);
	if (!tmpl) return;
	const sid = generate_uuid();
	const communityKp = generate_user_keypair();
	const memberKp = generate_user_keypair();
	const dk = generate_dek();
	await saveTeam({
		team_id: sid,
		name: tmpl.name,
		public_key: encode_hex(communityKp.public),
		secret_key: encode_hex(memberKp.secret),
		wrapped_dek: wrap_dek(dk, encode_hex(memberKp.public)),
		community_public_key: encode_hex(communityKp.public),
		community_secret_key: encode_hex(communityKp.secret),
		community_wrapped_dek: wrap_dek(dk, encode_hex(communityKp.public))
	});
	await saveCommunity({
		community_id: sid,
		name: tmpl.name,
		description: "",
		genesis_public_key: state.signingPublicKey || "",
		genesis_created_at: Date.now(),
		members: state.signingPublicKey ? [{
			pubkey: state.signingPublicKey,
			display_name: state.displayName,
			role: "founder",
			joined_at: Date.now(),
			vouched_by: null
		}] : [],
		governance: {
			contribution: "open",
			validation: "none",
			schema_authority: "any_member",
			key_rotation: "founder_only",
			fork_policy: "allowed",
			join_policy: "open"
		},
		bounds: null,
		relay_nodes: [],
		visibility: "local"
	});
	await saveLayers(sid, tmpl.layers.map((l) => ({
		layer_id: generate_uuid(),
		name: l.name,
		color: l.color,
		visible: true,
		opacity: 1
	})));
	for (const s of tmpl.schemas) await saveSchema({
		schema_id: generate_uuid(),
		name: s.name,
		fields: s.fields,
		community_id: sid
	});
	window._names[sid] = tmpl.name;
	await window._loadSetList();
	await window._switchSet(sid);
	toast(`Created: ${tmpl.name}`, "#16a34a");
}
function showTemplatePicker() {
	const existing = document.getElementById("template-picker-modal");
	if (existing) {
		existing.remove();
		return;
	}
	const ov = document.createElement("div");
	ov.id = "template-picker-modal";
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
	const cards = MAP_TEMPLATES.map((t) => `
    <div class="template-card" data-id="${t.id}" style="padding:12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;margin-bottom:8px;transition:background 0.15s;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="font-size:20px;">${t.icon}</span>
        <span style="font-weight:600;font-size:14px;">${escapeHtml(t.name)}</span>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">${escapeHtml(t.description)}</div>
      <div style="display:flex;gap:12px;font-size:11px;color:var(--text-dim);">
        <span>${t.layers.length} layer${t.layers.length !== 1 ? "s" : ""}</span>
        <span>${t.schemas.length} schema${t.schemas.length !== 1 ? "s" : ""}</span>
      </div>
    </div>
  `).join("");
	const userTemplates = JSON.parse(localStorage.getItem("pins-user-templates") || "[]");
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:380px;max-width:440px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:70vh;display:flex;flex-direction:column;">
    <h3 style="margin:0 0 4px;">\u{1F4CB} New from Template</h3>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Choose a pre-configured map with layers and schemas.</div>
    <div style="overflow-y:auto;flex:1;">${cards}${userTemplates.length > 0 ? `<div style="font-size:12px;color:var(--text-dim);margin:8px 0 4px;font-weight:600;">Your Templates</div>` + userTemplates.map((t) => `
        <div class="template-card user-template" data-id="${t.id}" style="padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;margin-bottom:6px;transition:background 0.15s;display:flex;align-items:center;justify-content:space-between;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
              <span style="font-weight:600;font-size:13px;">💾 ${escapeHtml(t.name)}</span>
            </div>
            <div style="display:flex;gap:10px;font-size:10px;color:var(--text-dim);">
              <span>${t.layers.length} layers</span>
              <span>${t.schemas.length} schemas</span>
            </div>
          </div>
          <button class="tmpl-delete-btn" data-id="${t.id}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px;padding:0 2px;line-height:1;flex-shrink:0;">×</button>
        </div>
      `).join("") : ""}</div>
    <button id="template-create-new" style="padding:6px;margin-top:6px;border:1px dashed #059669;background:transparent;color:#059669;border-radius:4px;cursor:pointer;font-size:13px;">📝 Create New Template</button>
    <button id="template-cancel" style="padding:6px;margin-top:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:13px;">Cancel</button>
  </div>`;
	document.body.appendChild(ov);
	const clean = () => ov.remove();
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("template-cancel").onclick = clean;
	ov.querySelectorAll(".template-card").forEach((card) => {
		card.onmouseenter = () => card.style.background = "var(--bg-input)";
		card.onmouseleave = () => card.style.background = "";
		card.onclick = async (e) => {
			if (e.target.closest(".tmpl-delete-btn")) return;
			clean();
			await createSetFromTemplate(card.dataset.id);
		};
	});
	ov.querySelectorAll(".tmpl-delete-btn").forEach((btn) => {
		btn.onclick = (e) => {
			e.stopPropagation();
			const filtered = JSON.parse(localStorage.getItem("pins-user-templates") || "[]").filter((t) => t.id !== btn.dataset.id);
			localStorage.setItem("pins-user-templates", JSON.stringify(filtered));
			toast("Template deleted", "#f97316");
			clean();
			showTemplatePicker();
		};
	});
	document.getElementById("template-create-new").onclick = () => {
		clean();
		showCreateTemplateModal();
	};
}
function showSchemaFieldEditor(schema, onSave) {
	let fields = [...schema.fields || []];
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3200;display:flex;align-items:center;justify-content:center;";
	function render() {
		const el = document.getElementById("sfe-fields");
		if (!el) return;
		const types = [
			"text",
			"number",
			"choice",
			"date",
			"time",
			"boolean"
		];
		el.innerHTML = fields.map((f, i) => `
      <div style="display:flex;gap:4px;margin-bottom:4px;align-items:center;">
        <input class="sfe-key" data-i="${i}" value="${escapeHtml(f.key || "")}" placeholder="key" style="width:80px;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;background:var(--bg-input);color:var(--text);" />
        <input class="sfe-label" data-i="${i}" value="${escapeHtml(f.label || "")}" placeholder="Label" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;background:var(--bg-input);color:var(--text);" />
        <select class="sfe-type" data-i="${i}" style="padding:4px;border:1px solid var(--border);border-radius:3px;font-size:11px;background:var(--bg-input);color:var(--text);">${types.map((t) => `<option value="${t}" ${f.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
        <button class="sfe-del" data-i="${i}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0 2px;">×</button>
      </div>
    `).join("");
		el.querySelectorAll(".sfe-key").forEach((inp) => {
			inp.oninput = () => {
				fields[parseInt(inp.dataset.i)].key = inp.value.trim();
			};
		});
		el.querySelectorAll(".sfe-label").forEach((inp) => {
			inp.oninput = () => {
				fields[parseInt(inp.dataset.i)].label = inp.value.trim();
			};
		});
		el.querySelectorAll(".sfe-type").forEach((sel) => {
			sel.onchange = () => {
				fields[parseInt(sel.dataset.i)].type = sel.value;
			};
		});
		el.querySelectorAll(".sfe-del").forEach((btn) => {
			btn.onclick = () => {
				fields.splice(parseInt(btn.dataset.i), 1);
				render();
			};
		});
	}
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:360px;max-width:460px;max-height:70vh;box-shadow:0 4px 20px rgba(0,0,0,0.3);display:flex;flex-direction:column;">
    <h3 style="margin:0 0 8px;">Schema Fields: ${escapeHtml(schema.name || "New Schema")}</h3>
    <div id="sfe-fields" style="flex:1;overflow-y:auto;margin-bottom:8px;"></div>
    <button id="sfe-add" style="padding:4px 8px;border:1px dashed var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;margin-bottom:10px;">+ Add Field</button>
    <div style="display:flex;gap:8px;">
      <button id="sfe-save" style="flex:1;padding:7px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;">Save Fields</button>
      <button id="sfe-cancel" style="flex:1;padding:7px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:13px;">Cancel</button>
    </div>
  </div>`;
	document.body.appendChild(ov);
	render();
	const clean = () => ov.remove();
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("sfe-cancel").onclick = clean;
	document.getElementById("sfe-add").onclick = () => {
		fields.push({
			key: "f" + (fields.length + 1),
			label: "Field " + (fields.length + 1),
			type: "text"
		});
		render();
	};
	document.getElementById("sfe-save").onclick = () => {
		const validFields = fields.filter((f) => f.key && f.label);
		if (onSave) onSave(validFields);
		clean();
	};
}
function showCreateTemplateModal() {
	const existing = document.getElementById("create-template-modal");
	if (existing) {
		existing.remove();
		return;
	}
	let templateLayers = [{
		name: "",
		color: "#2563eb"
	}];
	let templateSchemas = [];
	const ov = document.createElement("div");
	ov.id = "create-template-modal";
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3100;display:flex;align-items:center;justify-content:center;";
	function renderLayers() {
		const el = document.getElementById("tmpl-layers-list");
		if (!el) return;
		el.innerHTML = templateLayers.map((l, i) => `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <input class="tmpl-layer-name" data-i="${i}" value="${escapeHtml(l.name)}" placeholder="Layer name" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:3px;font-size:12px;background:var(--bg-input);color:var(--text);" />
        <input type="color" class="tmpl-layer-color" data-i="${i}" value="${l.color}" style="width:24px;height:24px;border:none;border-radius:3px;cursor:pointer;padding:0;" />
        <button class="tmpl-layer-del" data-i="${i}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px;padding:0 2px;">×</button>
      </div>
    `).join("");
		el.querySelectorAll(".tmpl-layer-name").forEach((inp) => {
			inp.oninput = () => {
				templateLayers[parseInt(inp.dataset.i)].name = inp.value.trim();
			};
		});
		el.querySelectorAll(".tmpl-layer-color").forEach((inp) => {
			inp.oninput = () => {
				templateLayers[parseInt(inp.dataset.i)].color = inp.value;
			};
		});
		el.querySelectorAll(".tmpl-layer-del").forEach((btn) => {
			btn.onclick = () => {
				if (templateLayers.length <= 1) return;
				templateLayers.splice(parseInt(btn.dataset.i), 1);
				renderLayers();
			};
		});
	}
	function renderSchemas() {
		const el = document.getElementById("tmpl-schemas-list");
		if (!el) return;
		const existingSchemas = state.schemas || [];
		el.innerHTML = `
      ${templateSchemas.length > 0 ? templateSchemas.map((s, i) => `
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;padding:4px 6px;border:1px solid var(--border);border-radius:3px;">
          <div style="flex:1;font-size:12px;">📋 ${escapeHtml(s.name)} (${s.fields.length} field${s.fields.length !== 1 ? "s" : ""})</div>
          <button class="tmpl-schema-edit" data-i="${i}" style="background:none;border:none;color:#2563eb;cursor:pointer;font-size:12px;padding:2px 4px;">✎</button>
          <button class="tmpl-schema-del" data-i="${i}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0 2px;">×</button>
        </div>
      `).join("") : `<div style="font-size:11px;color:var(--text-dim);padding:4px 0;">No schemas added</div>`}
      <div style="margin-top:6px;font-size:11px;color:var(--text-dim);margin-bottom:4px;">Import existing:</div>
      ${existingSchemas.map((s) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;padding:2px 0;cursor:pointer;">
          <input type="checkbox" class="tmpl-import-schema" data-name="${escapeHtml(s.name)}" data-fields="${escapeHtml(JSON.stringify(s.fields || []))}" />
          📋 ${escapeHtml(s.name)} (${s.fields ? s.fields.length : 0} fields)
        </label>
      `).join("")}
    `;
		el.querySelectorAll(".tmpl-schema-del").forEach((btn) => {
			btn.onclick = () => {
				templateSchemas.splice(parseInt(btn.dataset.i), 1);
				renderSchemas();
			};
		});
		el.querySelectorAll(".tmpl-schema-edit").forEach((btn) => {
			btn.onclick = () => {
				const s = templateSchemas[parseInt(btn.dataset.i)];
				showSchemaFieldEditor(s, (fields) => {
					templateSchemas[parseInt(btn.dataset.i)].fields = fields;
					renderSchemas();
				});
			};
		});
	}
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:400px;max-width:460px;max-height:75vh;box-shadow:0 4px 20px rgba(0,0,0,0.3);display:flex;flex-direction:column;">
    <h3 style="margin:0 0 8px;">📝 Create Template</h3>
    <input id="tmpl-name" placeholder="Template name" style="width:100%;padding:6px;margin-bottom:10px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;font-size:13px;background:var(--bg-input);color:var(--text);" />
    <div style="font-size:12px;font-weight:600;margin-bottom:4px;">📑 Layers</div>
    <div id="tmpl-layers-list" style="margin-bottom:4px;"></div>
    <button id="tmpl-add-layer" style="padding:4px 8px;border:1px dashed var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;margin-bottom:10px;">+ Add Layer</button>
    <div style="font-size:12px;font-weight:600;margin-bottom:4px;">📋 Schemas</div>
    <div id="tmpl-schemas-list" style="margin-bottom:4px;max-height:160px;overflow-y:auto;"></div>
    <button id="tmpl-add-schema" style="padding:4px 8px;border:1px dashed var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;margin-bottom:10px;">+ New Schema</button>
    <div style="display:flex;gap:8px;margin-top:4px;">
      <button id="tmpl-save" style="flex:1;padding:7px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;">Save Template</button>
      <button id="tmpl-cancel" style="flex:1;padding:7px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:13px;">Cancel</button>
    </div>
  </div>`;
	document.body.appendChild(ov);
	renderLayers();
	renderSchemas();
	const clean = () => ov.remove();
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("tmpl-cancel").onclick = clean;
	document.getElementById("tmpl-add-layer").onclick = () => {
		templateLayers.push({
			name: "",
			color: COLORS[templateLayers.length % COLORS.length]
		});
		renderLayers();
	};
	document.getElementById("tmpl-add-schema").onclick = () => {
		const fields = [{
			key: "field_1",
			label: "Field 1",
			type: "text"
		}];
		const name = prompt("Schema name:");
		if (!name) return;
		showSchemaFieldEditor({
			name,
			fields
		}, (updatedFields) => {
			templateSchemas.push({
				name,
				fields: updatedFields
			});
			renderSchemas();
		});
	};
	document.getElementById("tmpl-save").onclick = () => {
		const name = document.getElementById("tmpl-name").value.trim();
		if (!name) {
			toast("Template name required", "#dc2626");
			return;
		}
		const layers = templateLayers.filter((l) => l.name).map((l) => ({
			name: l.name,
			color: l.color
		}));
		if (!layers.length) {
			toast("At least one layer required", "#dc2626");
			return;
		}
		const checkboxes = ov.querySelectorAll(".tmpl-import-schema:checked");
		const importedSchemas = Array.from(checkboxes).map((cb) => ({
			name: cb.dataset.name,
			fields: JSON.parse(cb.dataset.fields || "[]")
		}));
		const allSchemas = [...templateSchemas.filter((s) => s.name), ...importedSchemas];
		const tmpl = {
			id: "user_" + Date.now().toString(36),
			name,
			icon: "💾",
			description: "Custom map template",
			layers,
			schemas: allSchemas,
			isUser: true
		};
		const userTemplates = JSON.parse(localStorage.getItem("pins-user-templates") || "[]");
		userTemplates.push(tmpl);
		localStorage.setItem("pins-user-templates", JSON.stringify(userTemplates));
		toast(`Template saved: ${name}`, "#16a34a");
		clean();
	};
}
async function createSet(name) {
	const sid = generate_uuid();
	const communityKp = generate_user_keypair();
	const memberKp = generate_user_keypair();
	const dk = generate_dek();
	await saveTeam({
		team_id: sid,
		name,
		public_key: encode_hex(communityKp.public),
		secret_key: encode_hex(memberKp.secret),
		wrapped_dek: wrap_dek(dk, encode_hex(memberKp.public)),
		community_public_key: encode_hex(communityKp.public),
		community_secret_key: encode_hex(communityKp.secret),
		community_wrapped_dek: wrap_dek(dk, encode_hex(communityKp.public))
	});
	await saveCommunity({
		community_id: sid,
		name,
		description: "",
		genesis_public_key: state.signingPublicKey || "",
		genesis_created_at: Date.now(),
		members: state.signingPublicKey ? [{
			pubkey: state.signingPublicKey,
			display_name: state.displayName,
			role: "founder",
			joined_at: Date.now(),
			vouched_by: null
		}] : [],
		governance: {
			contribution: "open",
			validation: "none",
			schema_authority: "any_member",
			key_rotation: "founder_only",
			fork_policy: "allowed",
			join_policy: "open",
			ttl_enabled: false,
			ttl_base_mins: 10080,
			ttl_vote_mins: 360,
			ttl_min_mins: 60,
			ttl_max_mins: 43200,
			anonymous_posting: "forbidden"
		},
		bounds: null,
		relay_nodes: [],
		visibility: "local"
	});
	window._names[sid] = name;
	await saveLayers(sid, [{
		layer_id: generate_uuid(),
		name: "Default",
		color: state.defaultLayerColor,
		visible: true,
		opacity: 1
	}]);
	await switchSet(sid);
	await loadSetList();
}
async function showCommunityDetails(communityId) {
	const c = await getCommunity(communityId);
	if (!c) {
		toast("Community not found", "#dc2626");
		return;
	}
	const isFounder = (c.members || []).some((m) => m.pubkey === state.signingPublicKey && m.role === "founder");
	const memberRows = (c.members || []).map((m) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-light);">
      <span style="font-size:12px;">${escapeHtml(m.display_name)}</span>
      <span style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:11px;color:var(--text-dim);padding:1px 6px;border:1px solid var(--border);border-radius:3px;">${escapeHtml(m.role)}</span>
        ${isFounder && m.role !== "founder" ? `<button class="cd-remove-btn" data-pubkey="${escapeHtml(m.pubkey)}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;padding:0;line-height:1;">×</button>` : ""}
      </span>
    </div>
  `).join("") || "<div style=\"color:var(--text-dim);font-size:12px;text-align:center;padding:8px;\">No members</div>";
	const gov = {
		contribution: "open",
		validation: "none",
		schema_authority: "any_member",
		key_rotation: "founder_only",
		fork_policy: "allowed",
		join_policy: "open",
		ttl_enabled: false,
		ttl_base_mins: 10080,
		ttl_vote_mins: 360,
		ttl_min_mins: 60,
		ttl_max_mins: 43200,
		anonymous_posting: "forbidden",
		...c.governance || {}
	};
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:360px;max-width:440px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0;">
      <h3 style="margin:0;">📋 ${escapeHtml(c.name)}</h3>
      <button id="cd-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div style="flex:1;overflow-y:auto;min-height:0;">
    ${c.description ? `<p style="font-size:12px;color:var(--text-dim);margin:0 0 8px;">${escapeHtml(c.description)}</p>` : ""}
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
      ID: ${escapeHtml(c.community_id.slice(0, 12))}... · Genesis: ${escapeHtml((c.genesis_public_key || "").slice(0, 12))}...${c.relay_url ? ` · Relay: ${escapeHtml(c.relay_url.replace(/^wss?:\/\//, ""))}` : ""}
    </div>
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Governance</div>
      <div style="font-size:11px;color:var(--text-dim);display:flex;flex-direction:column;gap:2px;">
        <span>Contribution: <b>${escapeHtml(gov.contribution || "open")}</b></span>
        <span>Validation: <b>${escapeHtml(gov.validation || "none")}</b></span>
        <span>Schema authority: <b>${escapeHtml(gov.schema_authority || "any_member")}</b></span>
        <span>Key rotation: <b>${escapeHtml(gov.key_rotation || "founder_only")}</b></span>
        <span>Fork policy: <b>${escapeHtml(gov.fork_policy || "allowed")}</b></span>
        <span>Join policy: <b>${escapeHtml(gov.join_policy || "open")}</b></span>
      </div>
    </div>

    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">TTL Settings</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <label style="font-size:11px;color:var(--text-dim);display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="cd-ttl-enabled" ${gov.ttl_enabled ? "checked" : ""} /> Enabled</label>
        <select id="cd-ttl-base" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;width:80px;">
          ${[
		10080,
		20160,
		43200,
		1440,
		2880,
		720
	].map((v) => `<option value="${v}" ${(gov.ttl_base_mins || 10080) === v ? "selected" : ""}>${v / 60 < 24 ? v / 60 + "h" : Math.floor(v / 1440) + "d"}</option>`).join("")}
        </select>
        <span style="font-size:10px;color:var(--text-muted);">base</span>
      </div>
      <div style="display:flex;gap:8px;font-size:10px;color:var(--text-muted);margin-bottom:4px;">
        <span>Vote: ${gov.ttl_vote_mins || 360}min</span>
        <span>Min: ${gov.ttl_min_mins || 60}min</span>
        <span>Max: ${gov.ttl_max_mins || 43200}min</span>
      </div>
      <button id="cd-ttl-save" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Save TTL</button>
    </div>` : ""}

    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Permissions</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:var(--text-dim);">Anonymous posting:</span>
        <select id="cd-anon-posting" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
          <option value="forbidden" ${(gov.anonymous_posting || "forbidden") === "forbidden" ? "selected" : ""}>Forbidden</option>
          <option value="allowed" ${gov.anonymous_posting === "allowed" ? "selected" : ""}>Allowed</option>
          <option value="members_only" ${gov.anonymous_posting === "members_only" ? "selected" : ""}>Members only</option>
        </select>
        <button id="cd-anon-save" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Save</button>
      </div>
    </div>` : ""}

    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Governance</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text-dim);min-width:70px;">Join policy:</span>
          <select id="cd-join-policy" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="open" ${(gov.join_policy || "open") === "open" ? "selected" : ""}>Open</option>
            <option value="invite" ${gov.join_policy === "invite" ? "selected" : ""}>Founder Invite</option>
            <option value="token" ${gov.join_policy === "token" ? "selected" : ""}>Capability Token</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text-dim);min-width:70px;">Contribution:</span>
          <select id="cd-contribution" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="open" ${(gov.contribution || "open") === "open" ? "selected" : ""}>Anyone</option>
            <option value="members_only" ${gov.contribution === "members_only" ? "selected" : ""}>Members Only</option>
          </select>
        </div>
        <div style="font-size:10px;color:var(--text-muted);">
          Open: anyone can write · Invite: founder adds pubkeys · Token: founder generates invite links
        </div>
      </div>
      <button id="cd-gov-save" style="margin-top:6px;padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Save Governance</button>
    </div>` : ""}

    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Members (${c.members?.length || 0})</div>
      <div style="max-height:160px;overflow-y:auto;">${memberRows}</div>
      ${isFounder && (gov.join_policy || "open") === "invite" ? `
      <div style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px;display:flex;flex-direction:column;gap:4px;">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px;">Add Member</div>
        <input id="cd-add-pubkey" placeholder="Pubkey hex" style="padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
        <input id="cd-add-name" placeholder="Display name" style="padding:3px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
        <div style="display:flex;gap:6px;">
          <select id="cd-add-role" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="contributor">Contributor</option>
            <option value="maintainer">Maintainer</option>
            <option value="reader">Reader</option>
          </select>
          <button id="cd-add-member-btn" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Add</button>
        </div>
      </div>` : ""}
      ${isFounder && (gov.join_policy || "open") === "token" ? `
      <div style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px;display:flex;flex-direction:column;gap:4px;">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px;">Generate Invite Token</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <select id="cd-token-role" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="contributor">Contributor</option>
            <option value="maintainer">Maintainer</option>
            <option value="reader">Reader</option>
          </select>
          <select id="cd-token-expiry" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="86400000">24h</option>
            <option value="604800000">7d</option>
            <option value="2592000000">30d</option>
            <option value="7776000000">90d</option>
            <option value="0">Never</option>
          </select>
          <select id="cd-token-uses" style="padding:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
            <option value="1">1 use</option>
            <option value="5">5 uses</option>
            <option value="10">10 uses</option>
            <option value="50">50 uses</option>
            <option value="0">Unlimited</option>
          </select>
        </div>
        <button id="cd-gen-token-btn" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Generate Token</button>
        <div id="cd-token-output" style="font-size:10px;color:var(--text-dim);margin-top:2px;word-break:break-all;"></div>
      </div>` : ""}
      ${memberRows && isFounder ? `
      <div style="margin-top:4px;font-size:10px;color:var(--text-muted);">Click × on a member row to remove them</div>` : ""}
    </div>
    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Relay</div>
      <div style="display:flex;gap:6px;align-items:center;">
        <select id="cd-relay-select" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:11px;">
          <option value="">None</option>
          ${window._getSavedRelays?.()?.map((u) => `<option value="${escapeHtml(u)}" ${u === (c.relay_url || "") ? "selected" : ""}>${escapeHtml(u)}</option>`).join("") || ""}
        </select>
        <button id="cd-relay-save" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Save</button>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:3px;">Pins sync from this relay. Change relay servers in ⚙ ICE settings.</div>
    </div>` : c.relay_url ? `<div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;"><div style="font-weight:600;font-size:12px;margin-bottom:4px;">Relay</div><div style="font-size:11px;color:var(--text-dim);">${escapeHtml(c.relay_url)}</div></div>` : ""}
    ${isFounder ? `
    <div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;">
      <div style="font-weight:600;font-size:12px;margin-bottom:4px;">Access</div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${c.password_hash ? `<span style="font-size:11px;color:var(--text-dim);">🔒 Password protected</span><button id="cd-changepwd" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">Change</button><button id="cd-removepwd" style="padding:4px 10px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">Remove</button>` : `<span style="font-size:11px;color:var(--text-dim);">Open access</span><button id="cd-setpwd" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">🔒 Set Password</button>`}
      </div>
    </div>` : c.password_hash ? `<div style="border:1px solid var(--border-light);border-radius:4px;padding:8px;margin-bottom:8px;"><div style="font-weight:600;font-size:12px;margin-bottom:4px;">Access</div><div style="font-size:11px;color:var(--text-dim);">🔒 Password protected</div></div>` : ""}
    ${c.bounds ? `<div style="font-size:11px;color:var(--text-dim);">Geographic bounds set</div>` : ""}
    <div style="margin-top:12px;display:flex;gap:8px;">
      ${isFounder ? `
        <select id="cd-visibility" style="flex:1;padding:6px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:4px;cursor:pointer;font-size:13px;">
          <option value="local" ${(c.visibility || "local") === "local" ? "selected" : ""}>Local Only</option>
          <option value="private" ${c.visibility === "private" ? "selected" : ""}>Private</option>
          <option value="unlisted" ${c.visibility === "unlisted" ? "selected" : ""}>Unlisted</option>
          <option value="public" ${c.visibility === "public" ? "selected" : ""}>Public</option>
        </select>
      ` : c.visibility && c.visibility !== "local" ? `<span style="font-size:11px;color:var(--text-dim);">${c.visibility.charAt(0).toUpperCase() + c.visibility.slice(1)}</span>` : ""}
      <button id="cd-share-link" style="padding:8px 12px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);border-radius:4px;cursor:pointer;font-size:13px;">🔗 Share Link</button>
    </div>
    </div>
  </div>`;
	document.body.appendChild(ov);
	const clean = () => ov.remove();
	document.getElementById("cd-close").onclick = clean;
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	const visSel = document.getElementById("cd-visibility");
	if (visSel) visSel.onchange = async () => {
		const newVis = visSel.value;
		const oldVis = c.visibility || "local";
		if (newVis === oldVis) return;
		if (newVis === "local" && oldVis !== "local") {
			if (!await confirmDialog("Move this community back to local-only? It will be permanently deleted from the relay. Others will lose access.")) {
				visSel.value = oldVis;
				return;
			}
		}
		if (oldVis === "local" && newVis !== "local") {
			if (!await confirmDialog("Register this community on the relay? Your data will be uploaded so others can join via the share link. This cannot be fully undone.")) {
				visSel.value = "local";
				return;
			}
		}
		let bounds = c.bounds;
		if (!bounds && newVis !== "local") {
			const pins = await getPins(c.community_id);
			if (pins.length > 0) {
				let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
				for (const p of pins) try {
					const pin = decrypt_pin_data(p.ciphertext, p.nonce, state.dek);
					if (typeof pin.lat === "number" && typeof pin.lng === "number") {
						minLat = Math.min(minLat, pin.lat);
						maxLat = Math.max(maxLat, pin.lat);
						minLng = Math.min(minLng, pin.lng);
						maxLng = Math.max(maxLng, pin.lng);
					}
				} catch (e) {
					console.warn("[map]", e.message);
				}
				if (minLat !== Infinity) bounds = [
					minLat,
					minLng,
					maxLat,
					maxLng
				];
			}
		}
		c.visibility = newVis;
		if (newVis !== "local" && !c.relay_url) c.relay_url = (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "").split(",")[0]?.trim() || null;
		await saveCommunity({
			...c,
			visibility: newVis,
			bounds: bounds || c.bounds
		});
		state.currentCommunity = c;
		if (newVis !== "local") window._relayPublishCommunity?.(c.community_id, newVis === "public");
		else {
			window._relayDeleteCommunity?.(c.community_id);
			window._disconnectCommunity?.(c.community_id);
		}
		toast("Visibility: " + ({
			local: "Local only",
			private: "Private",
			unlisted: "Unlisted",
			public: "Public"
		}[newVis] || newVis), "#16a34a");
		clean();
		showCommunityDetails(c.community_id);
	};
	const setPwdBtn = document.getElementById("cd-setpwd");
	if (setPwdBtn) setPwdBtn.onclick = async () => {
		const pass = await promptSetPassword("Set community password");
		if (!pass) return;
		c.password_hash = await hashCommunityPassword(pass, c.community_id);
		const { generate_user_keypair_from_password, generate_dek, wrap_dek, unwrap_dek, encode_hex } = await import("./e2e_core.js");
		const kp = generate_user_keypair_from_password(pass, c.community_id);
		const team = await getTeam(c.community_id);
		let dk;
		if (team && team.wrapped_dek && team.secret_key) try {
			dk = unwrap_dek(team.wrapped_dek, team.secret_key);
		} catch (e) {
			console.warn("[map]", e.message);
		}
		if (!dk) dk = generate_dek();
		const newWrapped = wrap_dek(dk, encode_hex(kp.public));
		await saveTeam({
			team_id: c.community_id,
			name: team?.name || c.name,
			public_key: encode_hex(kp.public),
			secret_key: encode_hex(kp.secret),
			wrapped_dek: newWrapped,
			key_derivation: "pbkdf2"
		});
		if (state.currentSet === c.community_id) state.dek = dk;
		await saveCommunity(c);
		state.currentCommunity = c;
		if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
		toast("Password set", "#16a34a");
		clean();
		showCommunityDetails(c.community_id);
	};
	const changePwdBtn = document.getElementById("cd-changepwd");
	if (changePwdBtn) changePwdBtn.onclick = async () => {
		const pass = await promptSetPassword("Change community password");
		if (!pass) return;
		c.password_hash = await hashCommunityPassword(pass, c.community_id);
		const { generate_user_keypair_from_password, generate_dek, wrap_dek, unwrap_dek, encode_hex } = await import("./e2e_core.js");
		const kp = generate_user_keypair_from_password(pass, c.community_id);
		const team = await getTeam(c.community_id);
		let dk;
		if (team && team.wrapped_dek && team.secret_key) try {
			dk = unwrap_dek(team.wrapped_dek, team.secret_key);
		} catch (e) {
			console.warn("[map]", e.message);
		}
		if (!dk) dk = generate_dek();
		const newWrapped = wrap_dek(dk, encode_hex(kp.public));
		await saveTeam({
			team_id: c.community_id,
			name: team?.name || c.name,
			public_key: encode_hex(kp.public),
			secret_key: encode_hex(kp.secret),
			wrapped_dek: newWrapped,
			key_derivation: "pbkdf2"
		});
		if (state.currentSet === c.community_id) state.dek = dk;
		await saveCommunity(c);
		state.currentCommunity = c;
		if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
		toast("Password changed", "#16a34a");
		clean();
		showCommunityDetails(c.community_id);
	};
	const removePwdBtn = document.getElementById("cd-removepwd");
	if (removePwdBtn) removePwdBtn.onclick = async () => {
		if (!await confirmDialog("Remove password protection from this community?")) return;
		c.password_hash = null;
		const team = await getTeam(c.community_id);
		if (team && team.key_derivation === "pbkdf2") {
			const kp = generate_user_keypair();
			const dk = generate_dek();
			const newWrapped = wrap_dek(dk, encode_hex(kp.public));
			await saveTeam({
				team_id: c.community_id,
				name: team?.name || c.name,
				public_key: encode_hex(kp.public),
				secret_key: encode_hex(kp.secret),
				wrapped_dek: newWrapped
			});
			if (state.currentSet === c.community_id) state.dek = dk;
		}
		await saveCommunity(c);
		state.currentCommunity = c;
		if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
		toast("Password removed", "#f97316");
		clean();
		showCommunityDetails(c.community_id);
	};
	const relaySaveBtn = document.getElementById("cd-relay-save");
	if (relaySaveBtn) relaySaveBtn.onclick = async () => {
		const newUrl = document.getElementById("cd-relay-select")?.value || null;
		c.relay_url = newUrl || null;
		await saveCommunity(c);
		state.currentCommunity = c;
		if (newUrl) {
			const list = window._getSavedRelays?.() || [];
			if (!list.includes(newUrl)) {
				list.push(newUrl);
				import("./relay.js").then((r) => r.saveRelayUrls(list)).catch(() => {});
			}
			window._relayConnect?.(newUrl);
		}
		if (c.visibility && c.visibility !== "local" && newUrl) window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
		toast(newUrl ? "Relay updated" : "Relay removed", "#16a34a");
		clean();
		showCommunityDetails(c.community_id);
	};
	const ttlSaveBtn = document.getElementById("cd-ttl-save");
	if (ttlSaveBtn) ttlSaveBtn.onclick = async () => {
		gov.ttl_enabled = document.getElementById("cd-ttl-enabled")?.checked || false;
		gov.ttl_base_mins = ((v) => isNaN(v) ? 10080 : v)(parseInt(document.getElementById("cd-ttl-base")?.value, 10));
		c.governance = gov;
		await saveCommunity(c);
		state.currentCommunity = c;
		if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
		toast("TTL settings saved", "#16a34a");
		clean();
		showCommunityDetails(c.community_id);
	};
	const anonSaveBtn = document.getElementById("cd-anon-save");
	if (anonSaveBtn) anonSaveBtn.onclick = async () => {
		gov.anonymous_posting = document.getElementById("cd-anon-posting")?.value || "forbidden";
		c.governance = gov;
		await saveCommunity(c);
		state.currentCommunity = c;
		if (c.visibility && c.visibility !== "local") window._relayPublishCommunity?.(c.community_id, c.visibility === "public");
		toast("Permissions saved", "#16a34a");
		clean();
		showCommunityDetails(c.community_id);
	};
	const shareBtn = document.getElementById("cd-share-link");
	if (shareBtn) shareBtn.onclick = async () => {
		if (c.visibility === "local" || !c.visibility) {
			toast("Register the community on a relay before sharing (set visibility to Private or above)", "#f97316");
			return;
		}
		const relayUrl = c.relay_url || (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "").split(",")[0]?.trim();
		if (!relayUrl) {
			toast("No relay configured — add a relay URL in ICE Settings or set one in Community Details", "#f97316");
			return;
		}
		const nameBytes = new TextEncoder().encode(c.name || "");
		const cidBytes = hexToBytes(c.community_id.replace(/-/g, ""));
		const relayBytes = new TextEncoder().encode(relayUrl);
		const flags = (c.password_hash ? 1 : 0) | 4;
		const team = await getTeam(c.community_id);
		const communitySk = team?.community_secret_key || team?.secret_key || "";
		const skBytes = communitySk ? hexToBytes(communitySk) : new Uint8Array(0);
		const skLen = skBytes.length;
		const mapCenter = state.map?.getCenter();
		const mapZoom = state.map?.getZoom();
		const viewStr = mapCenter ? `${mapCenter.lat.toFixed(6)},${mapCenter.lng.toFixed(6)},${mapZoom || 5}` : "";
		const viewBytes = viewStr ? new TextEncoder().encode(viewStr) : new Uint8Array(0);
		const total = 1 + nameBytes.length + 16 + 1 + relayBytes.length + 1 + 2 + skLen + viewBytes.length;
		const buf = new Uint8Array(total);
		let pos = 0;
		buf[pos++] = nameBytes.length;
		buf.set(nameBytes, pos);
		pos += nameBytes.length;
		buf.set(cidBytes, pos);
		pos += 16;
		buf[pos++] = relayBytes.length;
		if (relayBytes.length > 0) buf.set(relayBytes, pos);
		pos += relayBytes.length;
		buf[pos++] = flags;
		buf[pos++] = skLen >> 8 & 255;
		buf[pos++] = skLen & 255;
		if (skLen > 0) buf.set(skBytes, pos);
		pos += skLen;
		if (viewBytes.length > 0) buf.set(viewBytes, pos);
		const b64 = base64url_encode(buf);
		const url = window.location.origin + window.location.pathname + "#community=" + b64;
		const qrOv = document.createElement("div");
		qrOv.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2200;display:flex;align-items:center;justify-content:center;";
		qrOv.innerHTML = `<div style="background:white;padding:20px;border-radius:8px;max-width:340px;width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 4px;color:#111;font-size:15px;">🔗 Community Link</h3>
      <p style="font-size:10px;color:#666;margin:0 0 10px;">${escapeHtml(c.name || "").slice(0, 40)}</p>
      <div id="cm-qr-svg" style="margin-bottom:8px;display:flex;justify-content:center;"></div>
      <input id="cm-url" value="${escapeHtml(url)}" readonly style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;font-size:11px;text-align:center;box-sizing:border-box;margin-bottom:8px;" onclick="this.select()" />
      <button id="cm-copy" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;margin-right:6px;">Copy Link</button>
      <button id="cm-close" style="padding:6px 14px;border:1px solid #ccc;background:white;border-radius:4px;cursor:pointer;font-size:13px;">Close</button>
    </div>`;
		document.body.appendChild(qrOv);
		document.getElementById("cm-close").onclick = () => qrOv.remove();
		qrOv.onclick = (e) => {
			if (e.target === qrOv) qrOv.remove();
		};
		document.getElementById("cm-copy").onclick = () => {
			navigator.clipboard.writeText(url).then(() => toast("Link copied", "#16a34a")).catch(() => {});
		};
		import("./e2e_core.js").then((mod) => {
			const svgEl = document.getElementById("cm-qr-svg");
			if (svgEl) {
				const svgStr = mod.generate_qr_svg(url) || "";
				svgEl.textContent = "";
				if (svgStr) {
					const el = new DOMParser().parseFromString(svgStr, "image/svg+xml").documentElement;
					if (el && el.tagName === "svg") {
						el.querySelectorAll("script, [onload], [onclick], foreignObject").forEach((e) => e.remove());
						svgEl.appendChild(el);
					}
				}
			}
		}).catch(() => {});
	};
	const genTokenBtn = document.getElementById("cd-gen-token-btn");
	if (genTokenBtn) genTokenBtn.onclick = async () => {
		const role = document.getElementById("cd-token-role")?.value || "contributor";
		const expiry = parseInt(document.getElementById("cd-token-expiry")?.value, 10) || 0;
		const maxUses = parseInt(document.getElementById("cd-token-uses")?.value, 10) || 1;
		const expTs = expiry > 0 ? Date.now() + expiry : 0;
		genTokenBtn.textContent = "Generating...";
		genTokenBtn.disabled = true;
		try {
			const token = await (await import("./relay.js")).createInviteToken(c.community_id, role, expTs, maxUses);
			if (!token) {
				toast("Failed to create token", "#dc2626");
				genTokenBtn.textContent = "Generate Token";
				genTokenBtn.disabled = false;
				return;
			}
			const nameBytes = new TextEncoder().encode(c.name || "");
			const cidBytes = hexToBytes(c.community_id.replace(/-/g, ""));
			const relayUrl = c.relay_url || "";
			const relayBytes = relayUrl ? new TextEncoder().encode(relayUrl) : new Uint8Array(0);
			const roleBytes = new TextEncoder().encode(role);
			const expiryBuf = new Uint8Array(8);
			new DataView(expiryBuf.buffer).setBigUint64(0, BigInt(expTs), false);
			const nonceBytes = hexToBytes(token.nonce.replace(/-/g, "").slice(0, 16)).slice(0, 8);
			const sigBytes = hexToBytes(token.signature);
			const flags = (c.password_hash ? 1 : 0) | 2;
			const total = 1 + nameBytes.length + 16 + 1 + relayBytes.length + 1 + 1 + roleBytes.length + 8 + 8 + 64;
			const buf = new Uint8Array(total);
			let pos = 0;
			buf[pos++] = nameBytes.length;
			buf.set(nameBytes, pos);
			pos += nameBytes.length;
			buf.set(cidBytes, pos);
			pos += 16;
			buf[pos++] = relayBytes.length;
			if (relayBytes.length > 0) buf.set(relayBytes, pos);
			pos += relayBytes.length;
			buf[pos++] = flags;
			buf[pos++] = roleBytes.length;
			buf.set(roleBytes, pos);
			pos += roleBytes.length;
			buf.set(expiryBuf, pos);
			pos += 8;
			buf.set(nonceBytes, pos);
			pos += 8;
			buf.set(sigBytes, pos);
			const b64 = base64url_encode(buf);
			const link = window.location.origin + window.location.pathname + "#community=" + b64;
			const output = document.getElementById("cd-token-output");
			if (output) output.innerHTML = `<a href="${escapeHtml(link)}" style="color:var(--accent);">Invite link</a><br><span style="font-size:9px;">Click to copy · ${role} · ${expiry > 0 ? Math.round(expiry / 36e5) + "h" : "never"} · ${maxUses > 0 ? maxUses + " uses" : "unlimited"}</span>`;
			await navigator.clipboard.writeText(link);
			toast("Invite link copied", "#16a34a");
		} catch (e) {
			toast("Failed to create token", "#dc2626");
		}
		genTokenBtn.textContent = "Generate Token";
		genTokenBtn.disabled = false;
	};
	const govSaveBtn = document.getElementById("cd-gov-save");
	if (govSaveBtn) govSaveBtn.onclick = async () => {
		gov.join_policy = document.getElementById("cd-join-policy")?.value || "open";
		gov.contribution = document.getElementById("cd-contribution")?.value || "open";
		c.governance = gov;
		await saveCommunity(c);
		state.currentCommunity = c;
		if (c.visibility && c.visibility !== "local") import("./relay.js").then((r) => r.updateGovernance(c.community_id, gov)).catch(() => {});
		toast("Governance saved", "#16a34a");
		clean();
		showCommunityDetails(c.community_id);
	};
	const addMemberBtn = document.getElementById("cd-add-member-btn");
	if (addMemberBtn) addMemberBtn.onclick = async () => {
		const pubkey = document.getElementById("cd-add-pubkey")?.value?.trim();
		const name = document.getElementById("cd-add-name")?.value?.trim() || "Member";
		const role = document.getElementById("cd-add-role")?.value || "contributor";
		if (!pubkey) {
			toast("Enter the member's public key", "#f97316");
			return;
		}
		try {
			await (await import("./relay.js")).addMember(c.community_id, pubkey, name, role);
			toast("Member added", "#16a34a");
			await new Promise((r) => setTimeout(r, 500));
			clean();
			showCommunityDetails(c.community_id);
		} catch (e) {
			toast("Failed to add member", "#dc2626");
		}
	};
	document.querySelectorAll(".cd-remove-btn").forEach((b) => {
		b.onclick = async () => {
			const pubkey = b.dataset.pubkey;
			if (!pubkey) return;
			try {
				await (await import("./relay.js")).removeMember(c.community_id, pubkey);
				toast("Member removed", "#f97316");
				await new Promise((r) => setTimeout(r, 500));
				clean();
				showCommunityDetails(c.community_id);
			} catch (e) {
				toast("Failed to remove member", "#dc2626");
			}
		};
	});
	const listEl = ov.querySelector(".disc-layer-list")?.parentElement;
	if (listEl) listEl.querySelectorAll(".disc-show-layers-btn").forEach((btn) => {
		btn.onclick = async (e) => {
			e.stopPropagation();
			const cid = btn.dataset.communityId;
			const layerList = listEl.querySelector(`.disc-layer-list[data-community-id="${cid}"]`);
			if (!layerList) return;
			if (layerList.style.display === "block") {
				layerList.style.display = "none";
				btn.textContent = "Show Layers";
				return;
			}
			btn.textContent = "Loading...";
			btn.disabled = true;
			try {
				const layers = await window._relayListPublicLayers?.(cid) || [];
				if (layers.length === 0) layerList.innerHTML = "<div style=\"font-size:11px;color:var(--text-dim);padding:4px;\">No public layers</div>";
				else {
					layerList.innerHTML = layers.map((l) => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;">
                  <span style="font-size:11px;">📑 ${escapeHtml(l.name)}</span>
                  <button class="disc-sub-btn" data-cid="${escapeHtml(cid)}" data-lid="${escapeHtml(l.layer_id)}" style="padding:3px 10px;border:none;background:#7c3aed;color:#fff;border-radius:3px;cursor:pointer;font-size:11px;">Subscribe</button>
                </div>
              `).join("");
					layerList.querySelectorAll(".disc-sub-btn").forEach((subBtn) => {
						subBtn.onclick = async (ev) => {
							ev.stopPropagation();
							subBtn.textContent = "Subscribing...";
							subBtn.disabled = true;
							try {
								if (await window._relaySubscribeLayer?.(subBtn.dataset.cid, subBtn.dataset.lid)) {
									subBtn.textContent = "Subscribed";
									toast("Subscribed to layer", "#16a34a");
								} else {
									subBtn.textContent = "Failed";
									subBtn.disabled = false;
									toast("Subscription failed", "#dc2626");
								}
							} catch (_) {
								subBtn.textContent = "Subscribe";
								subBtn.disabled = false;
							}
						};
					});
				}
				layerList.style.display = "block";
				btn.textContent = "Hide Layers";
			} catch (_) {
				btn.textContent = "Show Layers";
			}
			btn.disabled = false;
		};
	});
}
async function createTutorial() {
	await createSet(t("tutorialMapName") || "Tutorial");
	const schemaDefs = [
		{
			schema_id: generate_uuid(),
			key: "heritage",
			name: "Heritage Site",
			fields: [
				{
					key: "year_built",
					label: "Year Built",
					type: "number"
				},
				{
					key: "status",
					label: "Status",
					type: "choice",
					options: [
						"Standing",
						"Ruins",
						"Reconstructed",
						"At Risk"
					]
				},
				{
					key: "century",
					label: "Century",
					type: "choice",
					options: [
						"Ancient",
						"Medieval",
						"Renaissance",
						"Industrial",
						"Modern"
					]
				},
				{
					key: "unesco",
					label: "UNESCO",
					type: "boolean"
				}
			]
		},
		{
			schema_id: generate_uuid(),
			key: "natural",
			name: "Natural Feature",
			fields: [
				{
					key: "feature_type",
					label: "Type",
					type: "choice",
					options: [
						"Mountain",
						"Waterfall",
						"Forest",
						"Reef",
						"Canyon",
						"Glacier",
						"Desert"
					]
				},
				{
					key: "elevation_m",
					label: "Elevation (m)",
					type: "number"
				},
				{
					key: "protected",
					label: "Protected",
					type: "boolean"
				},
				{
					key: "best_season",
					label: "Best Season",
					type: "choice",
					options: [
						"Spring",
						"Summer",
						"Autumn",
						"Winter",
						"Year-round"
					]
				}
			]
		},
		{
			schema_id: generate_uuid(),
			key: "city",
			name: "City Note",
			fields: [
				{
					key: "observation_type",
					label: "Type",
					type: "choice",
					options: [
						"Architecture",
						"Food",
						"Transport",
						"Market",
						"Nightlife"
					]
				},
				{
					key: "rating",
					label: "Rating",
					type: "number"
				},
				{
					key: "visited",
					label: "Visited",
					type: "date"
				},
				{
					key: "recommend",
					label: "Recommend",
					type: "boolean"
				}
			]
		},
		{
			schema_id: generate_uuid(),
			key: "festival",
			name: "Festival",
			fields: [
				{
					key: "month",
					label: "Month",
					type: "choice",
					options: [
						"Jan",
						"Feb",
						"Mar",
						"Apr",
						"May",
						"Jun",
						"Jul",
						"Aug",
						"Sep",
						"Oct",
						"Nov",
						"Dec"
					]
				},
				{
					key: "duration_days",
					label: "Duration (days)",
					type: "number"
				},
				{
					key: "attendance",
					label: "Attendance",
					type: "number"
				},
				{
					key: "free_entry",
					label: "Free Entry",
					type: "boolean"
				}
			]
		}
	];
	const schemaMap = {};
	for (const sd of schemaDefs) {
		schemaMap[sd.key] = sd.schema_id;
		await saveSchema({
			schema_id: sd.schema_id,
			name: sd.name,
			fields: sd.fields
		});
	}
	state.schemas = await getSchemas();
	const layerDefs = [
		{
			name: "Tutorial",
			color: "#7c3aed",
			opacity: 1,
			default_schema_id: null
		},
		{
			name: "Why This Matters",
			color: "#ef4444",
			opacity: 1,
			default_schema_id: null
		},
		{
			name: "Heritage",
			color: "#eab308",
			opacity: .85,
			default_schema_id: schemaMap.heritage
		},
		{
			name: "Nature",
			color: "#16a34a",
			opacity: .8,
			default_schema_id: schemaMap.natural
		},
		{
			name: "Urban",
			color: "#2563eb",
			opacity: .7,
			default_schema_id: schemaMap.city
		},
		{
			name: "Festivals",
			color: "#ec4899",
			opacity: .6,
			default_schema_id: schemaMap.festival
		}
	];
	const layerMap = {};
	for (const ld of layerDefs) {
		const lid = generate_uuid();
		layerMap[ld.name] = lid;
		state.layers.push({
			layer_id: lid,
			name: ld.name,
			color: ld.color,
			visible: true,
			opacity: ld.opacity,
			default_schema_id: ld.default_schema_id
		});
	}
	await saveLayers(state.currentSet, state.layers);
	const pids = [];
	const pins = [];
	for (const tp of TUTORIAL_PINS) {
		const pid = generate_uuid();
		const enc = encrypt_pin_data(tp.title, tp.note, tp.lat, tp.lng, tp.color, state.dek);
		const pin = {
			pin_id: pid,
			team_id: state.currentSet,
			layer_id: layerMap[tp.layer] || null,
			ciphertext: enc.ciphertext,
			nonce: enc.nonce,
			created_at: Date.now()
		};
		if (tp.schema) pin.schema_id = schemaMap[tp.schema] || tp.schema;
		if (tp.emoji) pin.emoji = tp.emoji;
		if (tp.tf !== void 0 && tp.tf !== null) pin.valid_from = tp.tf;
		if (tp.tt !== void 0 && tp.tt !== null) pin.valid_until = tp.tt;
		if (tp.custom) {
			const cdEnc = encrypt_raw_bytes(new TextEncoder().encode(JSON.stringify(tp.custom)), state.dek);
			pin.custom_data = {
				ciphertext: cdEnc.ciphertext,
				nonce: cdEnc.nonce
			};
		}
		if (!tp.posted_anonymously && state.signingPublicKey) pin.author_pubkey = state.signingPublicKey;
		pins.push(pin);
		pids.push(pid);
	}
	await importPins(pins);
	await loadPins();
	window._tutorialPids = pids;
	await saveSlideOrder(pids);
	window._addHistory?.(t("tutorialLoaded") || "Tutorial loaded", `${TUTORIAL_PINS.length} ${t("featurePins") || "feature pins"}`);
	window._renderUI?.();
	setTimeout(() => startSlideshow(pids), 700);
}
function startSlideshow(pinIds, opts = {}) {
	const map = state.map;
	if (!map || !pinIds || pinIds.length === 0) return;
	const { autoPlay = false, speed = 5e3, loop = false, startAt = 0, cardRenderer = null, onExit = null } = opts;
	let current = 0;
	const total = pinIds.length;
	let currentOrder = pinIds;
	let timer = null;
	let playing = false;
	let fullscreen = false;
	let currentAudio = null;
	const savedDrawer = window._drawerActive;
	const savedTopBar = document.getElementById("top-bar")?.classList.contains("hidden");
	const ctrl = document.getElementById("slideshow-bar");
	if (ctrl) ctrl.remove();
	const bar = document.createElement("div");
	bar.id = "slideshow-bar";
	bar.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:2000;background:var(--bg-card);border-top:1px solid var(--border);box-shadow:0 -2px 14px rgba(0,0,0,0.18);font-size:13px;display:flex;flex-direction:column;max-height:52vh;transition:max-height 0.3s;";
	const card = document.createElement("div");
	card.id = "slideshow-card";
	card.style.cssText = "padding:12px 16px;overflow-y:auto;flex:1;min-height:40px;";
	bar.appendChild(card);
	const ctrlRow = document.createElement("div");
	ctrlRow.id = "slideshow-controls";
	ctrlRow.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 16px;border-top:1px solid var(--border-light);flex-wrap:wrap;justify-content:center;position:relative;";
	bar.appendChild(ctrlRow);
	function stopAudio() {
		if (currentAudio) {
			currentAudio.pause();
			currentAudio.currentTime = 0;
			currentAudio = null;
		}
	}
	function stopTimer() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}
	function startTimer() {
		stopTimer();
		timer = setInterval(() => {
			if (current < total - 1) goTo(current + 1, true);
			else if (loop) goTo(0, true);
			else {
				stopTimer();
				playing = false;
				renderControls();
			}
		}, speed);
	}
	function togglePlay() {
		if (playing) {
			stopTimer();
			playing = false;
		} else {
			playing = true;
			startTimer();
		}
		renderControls();
	}
	function toggleFullscreen() {
		fullscreen = !fullscreen;
		const container = map.getContainer();
		if (fullscreen) {
			container.classList.add("slideshow-fullscreen");
			window._drawerActive = false;
			document.getElementById("top-bar")?.classList.add("hidden");
		} else {
			container.classList.remove("slideshow-fullscreen");
			window._drawerActive = savedDrawer;
			if (!savedTopBar) document.getElementById("top-bar")?.classList.remove("hidden");
		}
		window._renderUI?.();
	}
	async function onReorder(newOrder) {
		currentOrder = newOrder;
		window._slideOrder = newOrder;
		await saveSlideOrder(newOrder);
		goTo(current);
	}
	function cleanup() {
		stopTimer();
		stopAudio();
		playing = false;
		if (fullscreen) {
			fullscreen = false;
			map.getContainer().classList.remove("slideshow-fullscreen");
			window._drawerActive = savedDrawer;
			if (!savedTopBar) document.getElementById("top-bar")?.classList.remove("hidden");
			window._renderUI?.();
		}
		window._slideshowActive = false;
		window._slideshowGoTo = null;
		window._slideshowTogglePlay = null;
		window._slideshowExit = null;
		bar.remove();
		if (onExit) onExit();
	}
	function renderCard() {
		const pid = currentOrder[current];
		const marker = state._markerMap?.get(pid);
		if (!marker) {
			card.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:20px;">Slide ${current + 1} unavailable</div>`;
			return;
		}
		if (cardRenderer) {
			card.innerHTML = cardRenderer(current, pid, marker);
			return;
		}
		const pinData = marker._pinData || {};
		const title = pinData.title || marker._pinTitle || `Pin ${current + 1}`;
		const note = pinData.note || "";
		const emoji = marker._pinEmoji || "";
		const color = marker._pinColor || "#2563eb";
		const trust = computePinTrust(pinData, state.signingPublicKey) ?? 0;
		const trustColor = trust >= 2 ? "#16a34a" : trust >= .5 ? "#65a30d" : trust >= -.5 ? "#9ca3af" : trust >= -2 ? "#f97316" : "#dc2626";
		const attestations = pinData.attestations || [];
		const up = attestations.filter((a) => a.type === "confirmed").length;
		const down = attestations.filter((a) => a.type === "disputed").length + attestations.filter((a) => a.type === "flagged").length;
		let mediaHtml = "";
		const r = marker._media;
		if (r && state.dek) try {
			const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
			const mt = r.type || "";
			const blob = new Blob([dec], { type: mt });
			const url = URL.createObjectURL(blob);
			if (mt.startsWith("image/")) mediaHtml = `<img src="${url}" style="max-width:100%;max-height:30vh;border-radius:6px;margin-top:8px;">`;
			else if (mt.startsWith("video/")) mediaHtml = `<video src="${url}" controls style="max-width:100%;max-height:30vh;border-radius:6px;margin-top:8px;"></video>`;
			else if (mt.startsWith("audio/")) mediaHtml = `<audio src="${url}" controls style="width:100%;margin-top:8px;" class="slideshow-audio"></audio>`;
		} catch (e) {
			console.warn("[map]", e.message);
		}
		let ttlHtml = "";
		if (marker._ttlExpiresAt) {
			const remaining = marker._ttlExpiresAt - Date.now();
			if (remaining > 0) ttlHtml = `<span style="color:var(--text-dim);">⏳ ${Math.ceil(remaining / 6e4)}m</span>`;
			else ttlHtml = `<span style="color:#dc2626;">⏳ Expired</span>`;
		}
		card.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="width:4px;min-height:24px;background:${color};border-radius:2px;flex-shrink:0;align-self:stretch;"></div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
            <h3 style="margin:0;font-size:16px;">${escapeHtml(title)}</h3>
            ${emoji ? `<span style="font-size:20px;">${emoji}</span>` : ""}
            <span style="font-size:10px;color:${trustColor};border:1px solid ${trustColor};border-radius:3px;padding:1px 5px;">${trust >= 2 ? "Trusted" : trust >= .5 ? "Neutral" : trust >= -.5 ? "Low" : "Disputed"}</span>
            ${ttlHtml}
          </div>
          ${note ? `<div style="color:var(--text);font-size:14px;line-height:1.5;white-space:pre-wrap;margin-bottom:8px;">${escapeHtml(note)}</div>` : ""}
          ${mediaHtml}
          ${r && r.ciphertext ? `<br><button class="download-media-btn" data-pid="${escapeHtml(pid)}" style="font-size:11px;padding:2px 8px;border:1px solid #2563eb;background:transparent;color:#2563eb;border-radius:3px;cursor:pointer;margin-top:4px;">⬇ Download</button>` : ""}
          <div style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:11px;color:var(--text-dim);">
            <span>✅ ${up}</span><span>⚠️ ${down}</span>
            ${marker._authorPubkey ? `<span style="color:var(--text-muted);">by ${escapeHtml(String(marker._authorPubkey).slice(0, 8))}</span>` : ""}
          </div>
        </div>
      </div>`;
		stopAudio();
		const audioEl = card.querySelector(".slideshow-audio");
		if (audioEl && playing) {
			currentAudio = audioEl;
			audioEl.play().catch(() => {});
		}
	}
	function renderControls() {
		const WINDOW = 7;
		let dots = "";
		const dotStyle = (i) => `display:inline-block;width:8px;height:8px;border-radius:50%;background:${i === current ? "#2563eb" : "var(--border)"};cursor:pointer;margin:0 2px;flex-shrink:0;transition:background 0.15s;`;
		if (total <= WINDOW) for (let i = 0; i < total; i++) dots += `<span data-slide="${i}" style="${dotStyle(i)}"></span>`;
		else {
			const half = Math.floor(WINDOW / 2);
			let start = Math.max(0, current - half);
			let end = start + WINDOW;
			if (end > total) {
				end = total;
				start = end - WINDOW;
			}
			if (start > 0) dots += `<span data-jump="${start - 1}" style="display:inline-block;width:8px;height:8px;line-height:8px;text-align:center;color:var(--text-dim);cursor:pointer;font-size:11px;margin:0 1px;flex-shrink:0;">…</span>`;
			for (let i = start; i < end; i++) dots += `<span data-slide="${i}" style="${dotStyle(i)}"></span>`;
			if (end < total) dots += `<span data-jump="${end}" style="display:inline-block;width:8px;height:8px;line-height:8px;text-align:center;color:var(--text-dim);cursor:pointer;font-size:11px;margin:0 1px;flex-shrink:0;">…</span>`;
		}
		const speedLabel = speed >= 8e3 ? "Slow" : speed <= 3e3 ? "Fast" : "Normal";
		ctrlRow.innerHTML = `
      <div id="slideshow-dots" style="display:flex;align-items:center;gap:0;">${dots}</div>
      <span style="color:var(--text-dim);font-size:11px;margin:0 2px;">${current + 1}/${total}</span>
      <button id="tour-list" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:11px;color:var(--text-dim);" title="All slides">☰ Pin list</button>
      <button id="tour-prev" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:12px;">←</button>
      <button id="tour-play" style="padding:4px 12px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:14px;min-width:32px;">${playing ? "⏸" : "▶"}</button>
      <button id="tour-next" style="padding:4px 12px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:12px;">${current === total - 1 ? t("finish") || "Finish" : t("next") || "Next →"}</button>
      <button id="tour-speed" style="padding:4px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:10px;color:var(--text-dim);" title="Speed: ${speedLabel}">${speedLabel}</button>
      <button id="tour-loop" style="padding:4px 6px;border:1px solid var(--border);background:${loop ? "#2563eb" : "var(--bg-input)"};color:${loop ? "white" : "var(--text-dim)"};border-radius:4px;cursor:pointer;font-size:12px;" title="${loop ? "Looping" : "Loop off"}">🔁</button>
      <button id="tour-fullscreen" style="padding:4px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-dim);" title="Fullscreen">${fullscreen ? "⛶" : "⛶"}</button>
      ${cardRenderer ? "" : `<button id="tour-edit" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;font-size:11px;color:var(--text-dim);">${t("edit") || "Edit"}</button>`}
      <button id="tour-exit" style="padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:4px;cursor:pointer;font-size:11px;">✕</button>
    `;
		ctrlRow.querySelector("#tour-prev").onclick = () => {
			playing = false;
			stopTimer();
			goTo(current - 1);
			renderControls();
		};
		ctrlRow.querySelector("#tour-play").onclick = () => togglePlay();
		ctrlRow.querySelector("#tour-next").onclick = () => {
			if (current < total - 1) {
				playing = false;
				stopTimer();
				goTo(current + 1);
				renderControls();
			} else cleanup();
		};
		ctrlRow.querySelector("#tour-speed").onclick = () => {
			const speeds = [
				2e3,
				5e3,
				8e3
			];
			const newSpeed = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
			cleanup();
			startSlideshow(currentOrder, {
				autoPlay: playing,
				speed: newSpeed,
				loop,
				startAt: current
			});
		};
		ctrlRow.querySelector("#tour-loop").onclick = () => {
			const newLoop = !loop;
			cleanup();
			startSlideshow(currentOrder, {
				autoPlay: playing,
				speed,
				loop: newLoop,
				startAt: current
			});
		};
		ctrlRow.querySelector("#tour-fullscreen").onclick = () => toggleFullscreen();
		const editBtn = ctrlRow.querySelector("#tour-edit");
		if (editBtn) editBtn.onclick = () => editSlideOrder(currentOrder, current, onReorder);
		ctrlRow.querySelector("#tour-exit").onclick = cleanup;
		ctrlRow.querySelectorAll("#slideshow-dots [data-slide]").forEach((dot) => {
			dot.onclick = () => {
				playing = false;
				stopTimer();
				goTo(parseInt(dot.dataset.slide, 10));
				renderControls();
			};
		});
		ctrlRow.querySelectorAll("#slideshow-dots [data-jump]").forEach((dot) => {
			dot.onclick = () => {
				playing = false;
				stopTimer();
				goTo(parseInt(dot.dataset.jump, 10));
				renderControls();
			};
		});
		let quickNav = null;
		function buildQuickNav() {
			if (!quickNav || !document.body.contains(quickNav)) {
				quickNav = document.createElement("div");
				quickNav.id = "slideshow-quicknav";
				quickNav.style.cssText = "position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:var(--bg-card);border:1px solid var(--border);border-radius:6px;box-shadow:0 2px 16px rgba(0,0,0,0.15);max-height:260px;overflow-y:auto;min-width:200px;z-index:2001;display:none;font-size:12px;";
			}
			const rows = [];
			for (let i = 0; i < total; i++) {
				const pid = currentOrder[i];
				const m = state._markerMap?.get(pid);
				const t = escapeHtml((m?._pinTitle || `Pin ${i + 1}`).slice(0, 40));
				const active = i === current;
				rows.push(`<div data-sld="${i}" style="display:flex;align-items:center;gap:8px;padding:5px 10px;cursor:pointer;${active ? "background:#2563eb;color:#fff;" : "color:var(--text);"}border-bottom:1px solid var(--border-light);font-size:12px;white-space:nowrap;">
          <span style="font-weight:600;min-width:22px;text-align:right;">${i + 1}.</span>
          <span style="overflow:hidden;text-overflow:ellipsis;">${t}</span>
          ${active ? "<span style=\"margin-left:auto;font-size:10px;\">●</span>" : ""}
        </div>`);
			}
			quickNav.innerHTML = rows.join("");
			quickNav.querySelectorAll("[data-sld]").forEach((row) => {
				row.onclick = () => {
					playing = false;
					stopTimer();
					goTo(parseInt(row.dataset.sld, 10));
					renderControls();
					closeQuickNav();
				};
				row.onmouseenter = () => {
					row.style.background = row.dataset.sld === String(current) ? "#2563eb" : "var(--bg-input)";
				};
				row.onmouseleave = () => {
					row.style.background = row.dataset.sld === String(current) ? "#2563eb" : "";
				};
			});
			const curRow = quickNav.querySelector(`[data-sld="${current}"]`);
			if (curRow) curRow.scrollIntoView({ block: "nearest" });
		}
		function showQuickNav() {
			buildQuickNav();
			if (!ctrlRow.contains(quickNav)) ctrlRow.appendChild(quickNav);
			quickNav.style.display = "block";
		}
		function closeQuickNav() {
			if (quickNav) quickNav.style.display = "none";
		}
		const quickBtn = ctrlRow.querySelector("#tour-list");
		quickBtn.onclick = (e) => {
			e.stopPropagation();
			if (quickNav && quickNav.style.display === "block") closeQuickNav();
			else showQuickNav();
		};
		if (ctrlRow._quickNavDoc) document.removeEventListener("click", ctrlRow._quickNavDoc);
		const docClick = (e) => {
			if (quickNav && quickNav.style.display === "block" && !quickNav.contains(e.target) && e.target !== quickBtn) closeQuickNav();
		};
		ctrlRow._quickNavDoc = docClick;
		document.addEventListener("click", docClick);
	}
	function goTo(i, auto = false) {
		if (!auto) {
			playing = false;
			stopTimer();
		} else stopAudio();
		current = Math.max(0, Math.min(total - 1, i));
		window._slideshowCurrent = current;
		const pid = currentOrder[current];
		const marker = state._markerMap?.get(pid);
		if (marker) map.flyTo(marker.getLatLng(), marker._pinZoom || 13, { duration: 1.2 });
		renderCard();
		renderControls();
	}
	window._slideshowActive = true;
	window._slideshowCurrent = 0;
	window._slideshowGoTo = (i) => {
		goTo(i);
	};
	window._slideshowTogglePlay = () => togglePlay();
	window._slideshowToggleFullscreen = () => toggleFullscreen();
	window._slideshowExit = () => cleanup();
	document.body.appendChild(bar);
	goTo(startAt);
	if (autoPlay) {
		playing = true;
		startTimer();
		renderControls();
	}
}
async function saveSlideOrder(order) {
	if (!state.currentSet || !Array.isArray(order)) return;
	const settings = await getSettings(state.currentSet) || {
		map_center: [0, 0],
		map_zoom: 5
	};
	settings.slide_order = order;
	await saveSettings(state.currentSet, settings);
}
async function startCurrentMapSlideshow() {
	const markerMap = state._markerMap;
	if (!markerMap || markerMap.size === 0) return;
	const settings = await getSettings(state.currentSet);
	let pinIds;
	if (settings && Array.isArray(settings.slide_order) && settings.slide_order.length > 0) {
		const existing = new Set([...markerMap.keys()]);
		pinIds = settings.slide_order.filter((id) => existing.has(id));
		for (const id of existing) if (!pinIds.includes(id)) pinIds.push(id);
	} else pinIds = [...markerMap.keys()].sort((a, b) => {
		const ca = markerMap.get(a)?._createdAt || 0;
		const cb = markerMap.get(b)?._createdAt || 0;
		if (ca !== cb) return ca - cb;
		const ta = markerMap.get(a)?._pinTitle || "";
		const tb = markerMap.get(b)?._pinTitle || "";
		return ta.localeCompare(tb);
	});
	startSlideshow(pinIds);
}
function editSlideOrder(pinIds, currentIndex, onSave) {
	const markerMap = state._markerMap;
	let order = [...pinIds];
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
	ov.onclick = (e) => {
		if (e.target === ov) ov.remove();
	};
	function renderList() {
		listEl.innerHTML = order.map((pid, i) => {
			const marker = markerMap?.get(pid);
			const title = escapeHtml(marker?._pinTitle || `Pin ${i + 1}`);
			const upDisabled = i === 0 ? "opacity:0.3;cursor:default;" : "";
			const downDisabled = i === order.length - 1 ? "opacity:0.3;cursor:default;" : "";
			return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border-light);">
        <span style="flex:1;font-size:13px;">${i + 1}. ${title}</span>
        <button class="reorder-up" data-i="${i}" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;${upDisabled}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button class="reorder-down" data-i="${i}" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;${downDisabled}" ${i === order.length - 1 ? "disabled" : ""}>▼</button>
      </div>`;
		}).join("");
		listEl.querySelectorAll(".reorder-up").forEach((btn) => {
			btn.onclick = (e) => {
				const i = parseInt(btn.dataset.i, 10);
				if (i > 0) {
					[order[i], order[i - 1]] = [order[i - 1], order[i]];
					renderList();
				}
			};
		});
		listEl.querySelectorAll(".reorder-down").forEach((btn) => {
			btn.onclick = (e) => {
				const i = parseInt(btn.dataset.i, 10);
				if (i < order.length - 1) {
					[order[i], order[i + 1]] = [order[i + 1], order[i]];
					renderList();
				}
			};
		});
	}
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:420px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:70vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;">${t("editSlideOrder") || "Edit Slide Order"}</h3>
      <button id="reorder-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div id="reorder-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;max-height:50vh;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button id="reorder-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-input);border-radius:4px;cursor:pointer;">${t("cancel")}</button>
      <button id="reorder-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button>
    </div>
  </div>`;
	document.body.appendChild(ov);
	const listEl = document.getElementById("reorder-list");
	document.getElementById("reorder-close").onclick = () => ov.remove();
	document.getElementById("reorder-cancel").onclick = () => ov.remove();
	document.getElementById("reorder-save").onclick = () => {
		onSave([...order]);
		ov.remove();
	};
	renderList();
}
async function deleteSet(sid, skipConfirm = false) {
	if (!skipConfirm && !await confirmDialog(t("deleteSetConfirm"))) return;
	const c = await getCommunity(sid);
	if (c && c.visibility && c.visibility !== "local") {
		if ((c.members || []).some((m) => m.pubkey === state.signingPublicKey && m.role === "founder")) {
			toast("Open community details (ℹ) and set visibility to Local to remove from relay first", "#f97316");
			return;
		}
	}
	await deleteTeam(sid);
	delete window._names[sid];
	if (state.currentSet === sid) {
		state.currentSet = Object.keys(window._names || {})[0] || null;
		if (state.currentSet) await switchSet(state.currentSet);
		else await createSet("Default");
	}
	await loadSetList();
	window._renderUI?.();
}
async function renameSet(sid, newName) {
	await renameTeam(sid, newName);
	window._names[sid] = newName;
	window._renderUI?.();
}
function showSetsModal() {
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	async function renderList() {
		const ids = Object.keys(window._names || {});
		if (state.currentSet && !ids.includes(state.currentSet)) ids.push(state.currentSet);
		const communities = await Promise.all(ids.map((id) => getCommunity(id).catch(() => null)));
		listEl.innerHTML = ids.map((id, i) => {
			const nm = escapeHtml((window._names[id] || id).slice(0, 30));
			const isActive = id === state.currentSet;
			const dot = [...state.peers.values()].some((p) => p.setId === id && !p.offline) ? "<span style=\"color:#16a34a;font-size:10px;\">●</span>" : "";
			const replayBtn = nm === "Tutorial" && window._tutorialPids?.length ? `<button class="set-replay-btn" data-sid="${escapeHtml(id)}" style="padding:2px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;margin-right:4px;flex-shrink:0;" title="${t("replayTour") || "Replay Tour"}">▶</button>` : "";
			const community = communities[i];
			const memberCount = community ? community.members?.length || 1 : 1;
			const pubBadge = community?.visibility && community.visibility !== "local" ? `<span style="background:#059669;color:#fff;font-size:9px;padding:0 4px;border-radius:2px;margin-left:4px;">${community.visibility}</span>` : "";
			const info = community ? `<span style="font-size:10px;color:var(--text-dim);">${memberCount} member${memberCount !== 1 ? "s" : ""}${pubBadge}</span>` : "";
			return `<div class="set-row" data-sid="${escapeHtml(id)}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #e5e7eb;cursor:pointer;${isActive ? "background:#eff6ff;" : ""}">
        <div style="flex:1;display:flex;flex-direction:column;">
          <span class="set-name-display" style="font-size:14px;${isActive ? "font-weight:600;color:#2563eb;" : ""}">${nm} ${dot}</span>
          ${info}
        </div>
        <button class="set-detail-btn" data-sid="${escapeHtml(id)}" style="padding:2px 8px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;flex-shrink:0;color:var(--text-dim);" title="Community details">ℹ</button>
        <button class="set-slideshow-btn" data-sid="${escapeHtml(id)}" style="padding:2px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;margin-right:4px;flex-shrink:0;" title="${t("slideshow") || "Slideshow"}">▶</button>
        ${replayBtn}
        <button class="set-rename-btn" data-sid="${escapeHtml(id)}" style="padding:2px 8px;border:1px solid #9ca3af;background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;flex-shrink:0;">✎</button>
        <button class="set-delete-btn" data-sid="${escapeHtml(id)}" style="padding:2px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;">×</button>
      </div>`;
		}).join("") || "<div style=\"padding:12px;color:#9ca3af;text-align:center;\">No saved maps</div>";
		listEl.querySelectorAll(".set-detail-btn").forEach((btn) => {
			btn.onclick = (e) => {
				e.stopPropagation();
				showCommunityDetails(btn.dataset.sid);
			};
		});
		listEl.querySelectorAll(".set-row").forEach((row) => {
			row.onclick = async (e) => {
				if (e.target.closest("button")) return;
				const sid = row.dataset.sid;
				if (sid === state.currentSet) return;
				const clean = () => ov.remove();
				clean();
				await switchSet(sid);
			};
		});
		listEl.querySelectorAll(".set-rename-btn").forEach((btn) => {
			btn.onclick = (e) => {
				e.stopPropagation();
				const sid = btn.dataset.sid;
				const nameSpan = btn.parentElement.querySelector(".set-name-display");
				const currentName = window._names[sid] || "";
				nameSpan.innerHTML = `<input type="text" class="rename-input" value="${escapeHtml(currentName)}" style="width:100%;padding:4px;border:1px solid #2563eb;border-radius:3px;font-size:14px;box-sizing:border-box;" />`;
				const input = nameSpan.querySelector(".rename-input");
				input.focus();
				input.select();
				const doRename = async () => {
					const newName = input.value.trim();
					if (newName && newName !== currentName) await renameSet(sid, newName);
					renderList();
				};
				input.addEventListener("keydown", (ev) => {
					if (ev.key === "Enter") doRename();
					if (ev.key === "Escape") renderList();
				});
				input.addEventListener("blur", () => {
					setTimeout(() => {
						if (document.body.contains(input)) renderList();
					}, 150);
				});
			};
		});
		listEl.querySelectorAll(".set-slideshow-btn").forEach((btn) => {
			btn.onclick = async (e) => {
				e.stopPropagation();
				const sid = btn.dataset.sid;
				if (sid !== state.currentSet) await switchSet(sid);
				ov.remove();
				setTimeout(() => startCurrentMapSlideshow(), 300);
			};
		});
		listEl.querySelectorAll(".set-replay-btn").forEach((btn) => {
			btn.onclick = async (e) => {
				e.stopPropagation();
				const sid = btn.dataset.sid;
				if (sid !== state.currentSet) await switchSet(sid);
				ov.remove();
				setTimeout(() => startSlideshow(window._tutorialPids), 300);
			};
		});
		listEl.querySelectorAll(".set-delete-btn").forEach((btn) => {
			btn.onclick = async (e) => {
				e.stopPropagation();
				const sid = btn.dataset.sid;
				if (!await confirmDialog(t("deleteMapConfirm", { name: window._names[sid] || sid }))) return;
				await deleteSet(sid, true);
				if (Object.keys(window._names || {}).length === 0) ov.remove();
				else renderList();
			};
		});
	}
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:400px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;">${t("savedMaps")}</h3>
      <button id="sets-modal-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div id="sets-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;"></div>
    <button id="sets-modal-new" style="margin-top:12px;width:100%;padding:8px;border:1px dashed #9ca3af;background:transparent;color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:14px;">${t("newMap")}</button>
    <button id="sets-modal-tutorial" style="margin-top:8px;width:100%;padding:8px;border:1px dashed #2563eb;background:transparent;color:#2563eb;border-radius:4px;cursor:pointer;font-size:14px;">${t("tutorialMapName") || "Tutorial"}</button>
    <button id="sets-modal-template" style="margin-top:8px;width:100%;padding:8px;border:1px dashed #7c3aed;background:transparent;color:#7c3aed;border-radius:4px;cursor:pointer;font-size:14px;">📋 New from Template</button>
  </div>`;
	document.body.appendChild(ov);
	const listEl = document.getElementById("sets-list");
	const cleanFn = () => ov.remove();
	document.getElementById("sets-modal-close").onclick = cleanFn;
	ov.onclick = (e) => {
		if (e.target === ov) cleanFn();
	};
	document.getElementById("sets-modal-new").onclick = async () => {
		const n = prompt(t("newMapPrompt"))?.trim();
		if (n) {
			await createSet(n);
			if (!document.body.contains(ov)) return;
			renderList();
		}
	};
	document.getElementById("sets-modal-tutorial").onclick = async () => {
		cleanFn();
		await createTutorial();
	};
	document.getElementById("sets-modal-template").onclick = async () => {
		cleanFn();
		showTemplatePicker();
	};
	renderList();
}
function relativeTime(ts) {
	const diff = Date.now() - ts;
	const sec = Math.floor(diff / 1e3);
	if (sec < 60) return "just now";
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hrs = Math.floor(min / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(days / 365)}y ago`;
}
async function loadPins() {
	if (!state.dek || !state.currentSet) return;
	if (state._loadPinsBusy) {
		state._pinsNeedReload = true;
		return;
	}
	state._loadPinsBusy = true;
	const container = state.map?.getContainer();
	if (container) container.classList.add("pins-loading");
	try {
		if (state.layers.length === 0) await loadLayersForSet(state.currentSet);
		state.markers.length = 0;
		state.pinSearchText.length = 0;
		clearMarkerGrid();
		const markerMap = state._markerMap || (state._markerMap = /* @__PURE__ */ new Map());
		const keepIds = /* @__PURE__ */ new Set();
		const layerMap = new Map(state.layers.map((l) => [l.layer_id, l]));
		const defaultLayer = state.layers[0];
		const newMarkers = [];
		for (const row of await getPins(state.currentSet)) try {
			state._decryptedPinCache = state._decryptedPinCache || /* @__PURE__ */ new Map();
			const cached = state._decryptedPinCache.get(row.pin_id);
			let pin;
			if (cached && cached.ciphertext === row.ciphertext) pin = cached.pin;
			else {
				pin = decrypt_pin_data(row.ciphertext, row.nonce, state.dek);
				state._decryptedPinCache.set(row.pin_id, {
					pin,
					ciphertext: row.ciphertext
				});
				if (state._decryptedPinCache.size > 500) {
					const firstKey = state._decryptedPinCache.keys().next().value;
					if (firstKey) state._decryptedPinCache.delete(firstKey);
				}
			}
			pin.pin_id = row.pin_id;
			pin.attestations = row.attestations;
			const gov = {
				ttl_enabled: false,
				ttl_base_mins: 10080,
				ttl_vote_mins: 360,
				ttl_min_mins: 60,
				ttl_max_mins: 43200,
				anonymous_posting: "forbidden",
				...state.currentCommunity?.governance || {}
			};
			if (gov.ttl_enabled && row.ttl_expires_at && row.ttl_expires_at < Date.now()) {
				await deletePin$1(row.pin_id);
				window._broadcast?.("delete_pin", { pin_id: row.pin_id });
				continue;
			}
			const tidx = window._tutorialPids?.indexOf(row.pin_id);
			if (tidx !== -1 && tidx !== void 0) {
				const tpin = getTutorialPin(tidx);
				if (tpin) {
					pin.title = tpin.title;
					pin.note = tpin.note;
				}
			}
			keepIds.add(row.pin_id);
			const layerId = row.layer_id || (defaultLayer ? defaultLayer.layer_id : null);
			const layer = layerId ? layerMap.get(layerId) : defaultLayer;
			const opacity = layer && layer.visible ? layer.opacity : 0;
			const layerName = layer ? layer.name : "";
			const layerColor = layer ? layer.color : "#7c3aed";
			let m = markerMap.get(row.pin_id);
			if (!m) {
				m = leaflet_shim_default.marker([pin.lat, pin.lng], {
					icon: pinIcon(pin.color || "#2563eb", row.emoji),
					opacity
				});
				m._pinId = row.pin_id;
				m._pinColor = pin.color || "#2563eb";
				m._pinTitle = pin.title || "";
				m._pinEmoji = row.emoji;
				m._createdAt = row.created_at || 0;
				m._authorPubkey = row.author_pubkey || null;
				m._pinZoom = row.map_zoom || 13;
				m._media = row.media;
				m._pinData = pin;
				m._layerId = layerId;
				m._layerName = layerName;
				m._layerColor = layerColor;
				m._validFrom = row.valid_from !== void 0 ? row.valid_from : null;
				m._validTo = row.valid_until !== void 0 ? row.valid_until : null;
				m._ttlExpiresAt = row.ttl_expires_at || null;
				m._ttlVoteUp = row.vote_count_up || 0;
				m._ttlVoteDown = row.vote_count_down || 0;
				m._postedAnonymously = row.posted_anonymously || false;
				m._customData = row.custom_data;
				m._schemaId = row.schema_id;
				if (row.posted_anonymously) m.setOpacity(Math.max(opacity * .7, .2));
				if (m._pinData?.attestations?.length) {
					const trust = pinTrustIndicator(m._pinData, state.signingPublicKey);
					m._pinTrustScore = trust.score;
					m._pinTrustColor = trust.color;
					m._pinTrustLevel = trust.level;
				} else {
					m._pinTrustScore = 0;
					m._pinTrustLevel = null;
				}
				m.on("click", (e) => {
					if (e.originalEvent.shiftKey) {
						leaflet_shim_default.DomEvent.stop(e);
						toggleMarkerSelection(m);
					}
				});
				markerMap.set(row.pin_id, m);
				newMarkers.push(m);
				requestAnimationFrame(() => {
					const icon = m._icon;
					if (icon) {
						icon.classList.add("marker-animate");
						setTimeout(() => icon.classList.remove("marker-animate"), 500);
					}
				});
			} else {
				m._pinTitle = pin.title || "";
				m._pinEmoji = row.emoji;
				m._media = row.media;
				m._authorPubkey = row.author_pubkey || null;
				m._pinData = pin;
				m._layerId = layerId;
				m._layerName = layerName;
				m._layerColor = layerColor;
				m._validFrom = row.valid_from !== void 0 ? row.valid_from : null;
				m._validTo = row.valid_until !== void 0 ? row.valid_until : null;
				m._customData = row.custom_data;
				m._schemaId = row.schema_id;
				m._ttlExpiresAt = row.ttl_expires_at || null;
				m._ttlVoteUp = row.vote_count_up || 0;
				m._ttlVoteDown = row.vote_count_down || 0;
				m._postedAnonymously = row.posted_anonymously || false;
				m._pinZoom = row.map_zoom || 13;
				if (m._pinData?.attestations?.length) {
					const trust = pinTrustIndicator(m._pinData, state.signingPublicKey);
					m._pinTrustScore = trust.score;
					m._pinTrustColor = trust.color;
					m._pinTrustLevel = trust.level;
				} else {
					m._pinTrustScore = 0;
					m._pinTrustLevel = null;
				}
				if (row.posted_anonymously) m.setOpacity(Math.max(opacity * .7, .2));
				else m.setOpacity(opacity);
				m.setIcon(pinIcon(pin.color || "#2563eb", row.emoji));
			}
			state.pinSearchText.push((pin.title + " " + pin.note).toLowerCase());
			(function(marker, pinData, rowData) {
				marker.bindPopup(function() {
					let mh = "";
					const r = marker._media;
					if (r) try {
						const mt = r.type;
						let tag = null;
						if (mt && mt.startsWith("image/")) tag = "img";
						else if (mt && mt.startsWith("video/")) tag = "video";
						else if (mt && mt.startsWith("audio/")) tag = "audio";
						if (tag) try {
							const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
							const blob = new Blob([dec], { type: mt });
							const url = URL.createObjectURL(blob);
							if (tag === "img") mh = `<br><img src="${url}" style="max-width:200px;max-height:150px;margin-top:4px;">`;
							else if (tag === "video") mh = `<br><video src="${url}" controls style="max-width:200px;max-height:150px;margin-top:4px;"></video>`;
							else if (tag === "audio") mh = `<br><audio src="${url}" controls style="width:100%;max-width:200px;"></audio>`;
						} catch (e) {
							console.warn("[popup] media render failed:", e.message);
						}
					} catch (e) {
						console.warn("[popup] media decrypt failed:", e.message);
					}
					const rt = relativeTime(marker._createdAt);
					const customHtml = buildCustomDataHTML(marker._pinData, rowData.custom_data, marker._layerId, marker._layerName, rowData.schema_id);
					const layerBadge = marker._layerName ? `<br><span class="layer-badge" style="border-color:${marker._layerColor};">📑 ${escapeHtml(marker._layerName)}</span>` : "";
					const isAnon = marker._postedAnonymously;
					const isOwner = !isAnon && rowData.author_pubkey && rowData.author_pubkey === state.signingPublicKey;
					const myRole = state.myRole;
					const canModerate = myRole === "maintainer" || myRole === "founder";
					const canEdit = !isAnon && (isOwner || canModerate) && myRole !== "reader";
					const canDelete = !isAnon && (isOwner || canModerate) && myRole !== "reader";
					const anonBadge = isAnon ? `<br><span style="font-size:10px;color:var(--text-muted);">anonymous</span>` : "";
					const trustBadge = marker._pinTrustLevel && marker._pinTrustLevel !== "neutral" ? `<span style="font-size:9px;color:${marker._pinTrustColor || "#9ca3af"};margin-left:4px;">${marker._pinTrustLevel}</span>` : "";
					let ttlHtml = "";
					if (gov.ttl_enabled && marker._ttlExpiresAt) {
						const atts = marker._pinData?.attestations || [];
						const up = atts.filter((a) => a.type === "confirmed").length;
						const down = atts.filter((a) => a.type === "disputed").length + atts.filter((a) => a.type === "flagged").length;
						const expired = marker._ttlExpiresAt < Date.now();
						const remaining = marker._ttlExpiresAt - Date.now();
						if (expired) ttlHtml = `<br><small style="color:#dc2626;">⏳ Expired · ✅ ${up} ⚠️🚩 ${down}</small>`;
						else if (remaining > 0) {
							const mins = Math.ceil(remaining / 6e4);
							const h = Math.floor(mins / 60);
							const m = mins % 60;
							ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Expires in ${h > 0 ? h + "h " : ""}${m}m · ✅ ${up} ⚠️🚩 ${down}</small>`;
						}
					}
					const voteBtns = !isAnon && state.signingSecretKey && rowData.author_pubkey !== state.signingPublicKey ? `<br><button class="vote-up-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="padding:2px 8px;border:1px solid #16a34a;background:var(--bg-card);color:#16a34a;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">👍</button><button class="vote-down-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="padding:2px 8px;border:1px solid #f97316;background:var(--bg-card);color:#f97316;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">👎</button><button class="flag-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="padding:2px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">🚩</button>` : "";
					const editBtns = window._tutorialPids?.includes(rowData.pin_id) || !isOwner ? "" : `${canEdit ? `<button class="edit-pin-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="margin-top:6px;padding:4px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;">${t("edit")}</button>` : ""}${canDelete ? `<button class="delete-pin-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">${t("delete")}</button>` : ""}`;
					const routeBtn = `<button class="pin-route-btn" data-lat="${pinData.lat}" data-lng="${pinData.lng}" style="margin-top:6px;padding:4px 8px;border:1px solid #7c3aed;background:var(--bg-card);color:#7c3aed;border-radius:3px;cursor:pointer;font-size:12px;">&#x1F6E3; Route</button>`;
					return `<div style="position:relative;"><button class="pin-expand-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="position:absolute;top:2px;right:2px;padding:1px 6px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:14px;line-height:1.3;color:var(--text-dim);" title="${t("expand") || "Expand"}">↗</button><b>${escapeHtml(pinData.title)}</b>${marker._pinEmoji ? " " + marker._pinEmoji : ""}${anonBadge}${trustBadge}<br>${escapeHtml(pinData.note)}${customHtml}${mh}${r && r.ciphertext ? `<br><button class="download-media-btn" data-pid="${escapeHtml(rowData.pin_id)}" style="font-size:11px;padding:2px 8px;border:1px solid #2563eb;background:transparent;color:#2563eb;border-radius:3px;cursor:pointer;margin-top:4px;">⬇ Download</button>` : ""}<br><small style="color:var(--text-dim)">${rt}</small>${ttlHtml}${layerBadge}${voteBtns}${editBtns ? "<br>" + editBtns : ""}<br>${routeBtn}<hr style="margin:8px 0 4px;border-color:var(--border);"><div class="annotation-thread" data-pin-id="${escapeHtml(rowData.pin_id)}" style="max-height:240px;overflow-y:auto;font-size:12px;">Loading...</div></div>`;
				});
			})(m, pin, row);
			state.markers.push(m);
			indexMarker(m);
			try {
				window._spatialIdx?.insert(row.pin_id, pin.lat, pin.lng);
			} catch (e) {
				console.warn("[map]", e.message);
			}
		} catch (err) {
			console.warn("[loadPins] failed to load pin:", row.pin_id, err);
			window._toast?.("Some pins failed to load", "#f97316");
		}
		if (newMarkers.length > 0) state.clusterGroup?.addLayers(newMarkers);
		for (const [id, marker] of markerMap) if (!keepIds.has(id)) {
			state.clusterGroup?.removeLayer(marker);
			markerMap.delete(id);
		}
		applyTimeFilter();
	} finally {
		state._loadPinsBusy = false;
		const container = state.map?.getContainer();
		if (container) container.classList.remove("pins-loading");
		if (state._pinsNeedReload) {
			state._pinsNeedReload = false;
			setTimeout(() => loadPins(), 50);
		}
	}
}
function refreshPinMarkerPopup(marker) {
	if (!marker || !marker._pinId) return;
	const rowData = {
		pin_id: marker._pinId,
		author_pubkey: marker._authorPubkey
	};
	const pinData = marker._pinData || {};
	const gov = {
		ttl_enabled: false,
		ttl_base_mins: 10080,
		ttl_vote_mins: 360,
		ttl_min_mins: 60,
		ttl_max_mins: 43200,
		...state.currentCommunity?.governance || {}
	};
	const isAnon = marker._postedAnonymously;
	const isOwner = !isAnon && rowData.author_pubkey && rowData.author_pubkey === state.signingPublicKey;
	state.myRole;
	const isTutorial = window._tutorialPids?.includes(marker._pinId);
	const editBtns = isAnon || !isOwner || isTutorial ? "" : `<button class="edit-pin-btn" data-pid="${escapeHtml(marker._pinId)}" style="margin-top:6px;padding:4px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;">Edit</button> <button class="delete-pin-btn" data-pid="${escapeHtml(marker._pinId)}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">Delete</button>`;
	const anonBadge = isAnon ? `<br><span style="font-size:10px;color:var(--text-muted);">anonymous</span>` : "";
	const trust = marker._pinTrustLevel != null ? {
		level: marker._pinTrustLevel,
		color: marker._pinTrustColor
	} : pinTrustIndicator(marker._pinData || {}, state.signingPublicKey);
	const trustBadge = trust?.level && trust.level !== "neutral" ? `<span style="font-size:9px;color:${trust.color || "#9ca3af"};margin-left:4px;">${trust.level}</span>` : "";
	let mediaHtml = "";
	const r = marker._media;
	if (r) try {
		const mt = r.type;
		let tag = null;
		if (mt && mt.startsWith("image/")) tag = "img";
		else if (mt && mt.startsWith("video/")) tag = "video";
		if (tag) {
			const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
			const blob = new Blob([dec], { type: mt });
			const url = URL.createObjectURL(blob);
			if (tag === "img") mediaHtml = `<br><img src="${url}" style="max-width:200px;max-height:150px;margin-top:4px;">`;
			else if (tag === "video") mediaHtml = `<br><video src="${url}" controls style="max-width:200px;max-height:150px;margin-top:4px;"></video>`;
			else if (tag === "audio") mediaHtml = `<br><audio src="${url}" controls style="width:100%;max-width:200px;"></audio>`;
		}
	} catch (e) {
		console.warn("[map]", e.message);
	}
	const customHtml = buildCustomDataHTML(marker._pinData, marker._customData, marker._layerId, marker._layerName, marker._schemaId);
	const rt = relativeTime(marker._createdAt);
	const layerBadge = marker._layerName ? `<br><span class="layer-badge" style="border-color:${marker._layerColor};">📑 ${escapeHtml(marker._layerName)}</span>` : "";
	let ttlHtml = "";
	if (gov.ttl_enabled) {
		const atts = marker._pinData?.attestations || [];
		const up = atts.filter((a) => a.type === "confirmed").length;
		const down = atts.filter((a) => a.type === "disputed").length + atts.filter((a) => a.type === "flagged").length * 3;
		if (marker._ttlExpiresAt) {
			const remaining = marker._ttlExpiresAt - Date.now();
			if (remaining > 0) {
				const mins = Math.ceil(remaining / 6e4);
				const h = Math.floor(mins / 60);
				const m = mins % 60;
				ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Expires in ${h > 0 ? h + "h " : ""}${m}m · ✅ ${up} ⚠️🚩 ${down}</small>`;
			} else ttlHtml = `<br><small style="color:#dc2626;">⏳ Expired · ✅ ${up} ⚠️🚩 ${down}</small>`;
		} else ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Pending · ✅ ${up} ⚠️🚩 ${down}</small>`;
	}
	const refreshVoteBtns = !isAnon && state.signingSecretKey && marker._authorPubkey !== state.signingPublicKey ? `<br><button class="vote-up-btn" data-pid="${escapeHtml(marker._pinId)}" style="padding:2px 8px;border:1px solid #16a34a;background:var(--bg-card);color:#16a34a;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">👍</button><button class="vote-down-btn" data-pid="${escapeHtml(marker._pinId)}" style="padding:2px 8px;border:1px solid #f97316;background:var(--bg-card);color:#f97316;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">👎</button><button class="flag-btn" data-pid="${escapeHtml(marker._pinId)}" style="padding:2px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">🚩</button>` : "";
	const html = `<div style="position:relative;"><button class="pin-expand-btn" data-pid="${escapeHtml(marker._pinId)}" style="position:absolute;top:2px;right:2px;padding:1px 6px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:14px;line-height:1.3;color:var(--text-dim);" title="${t("expand") || "Expand"}">↗</button><b>${escapeHtml(pinData.title || "")}</b>${marker._pinEmoji ? " " + marker._pinEmoji : ""}${anonBadge}${trustBadge}<br>${escapeHtml(pinData.note || "")}${customHtml}${mediaHtml}${r && r.ciphertext ? `<br><button class="download-media-btn" data-pid="${escapeHtml(marker._pinId)}" style="font-size:11px;padding:2px 8px;border:1px solid #2563eb;background:transparent;color:#2563eb;border-radius:3px;cursor:pointer;margin-top:4px;">⬇ Download</button>` : ""}<br><small style="color:var(--text-dim)">${rt}</small>${ttlHtml}${layerBadge}${refreshVoteBtns}${editBtns ? "<br>" + editBtns : ""}<hr style="margin:8px 0 4px;border-color:var(--border);"><div class="annotation-thread" data-pin-id="${escapeHtml(marker._pinId)}" style="max-height:240px;overflow-y:auto;font-size:12px;">Loading...</div></div>`;
	marker.unbindPopup();
	marker.bindPopup(html);
	marker.openPopup();
}
function showPinDetailModal(pinId) {
	const marker = state.markers.find((m) => m._pinId === pinId);
	if (!marker || !state.dek) return;
	if (window._pinDetailClean) {
		window._pinDetailClean();
		window._pinDetailClean = null;
	}
	const pinData = marker._pinData || {};
	const gov = {
		ttl_enabled: false,
		ttl_base_mins: 10080,
		ttl_vote_mins: 360,
		ttl_min_mins: 60,
		ttl_max_mins: 43200,
		...state.currentCommunity?.governance || {}
	};
	const isAnon = marker._postedAnonymously;
	const isOwner = !isAnon && marker._authorPubkey && marker._authorPubkey === state.signingPublicKey;
	state.myRole;
	const isTutorial = window._tutorialPids?.includes(pinId);
	const editBtns = isAnon || !isOwner || isTutorial ? "" : `<button class="edit-pin-btn" data-pid="${escapeHtml(pinId)}" style="margin-top:6px;padding:4px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;">${t("edit")}</button> <button class="delete-pin-btn" data-pid="${escapeHtml(pinId)}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">${t("delete")}</button>`;
	const mediaUrls = [];
	let mediaHtml = "";
	const r = marker._media;
	if (r) try {
		const mt = r.type;
		let tag = null;
		if (mt && mt.startsWith("image/")) tag = "img";
		else if (mt && mt.startsWith("video/")) tag = "video";
		else if (mt && mt.startsWith("audio/")) tag = "audio";
		if (tag) {
			const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
			const blob = new Blob([dec], { type: mt });
			const url = URL.createObjectURL(blob);
			mediaUrls.push(url);
			if (tag === "img") mediaHtml = `<br><img src="${url}" style="max-width:100%;max-height:50vh;margin-top:6px;border-radius:4px;">`;
			else if (tag === "video") mediaHtml = `<br><video src="${url}" controls style="max-width:100%;max-height:50vh;margin-top:6px;border-radius:4px;"></video>`;
			else if (tag === "audio") mediaHtml = `<br><audio src="${url}" controls style="width:100%;"></audio>`;
		}
	} catch (e) {
		console.warn("[map]", e.message);
	}
	let ttlHtml = "";
	if (gov.ttl_enabled) {
		const atts = marker._pinData?.attestations || [];
		const up = atts.filter((a) => a.type === "confirmed").length;
		const down = atts.filter((a) => a.type === "disputed").length + atts.filter((a) => a.type === "flagged").length * 3;
		if (marker._ttlExpiresAt) {
			const remaining = marker._ttlExpiresAt - Date.now();
			if (remaining > 0) {
				const mins = Math.ceil(remaining / 6e4);
				const h = Math.floor(mins / 60);
				const m = mins % 60;
				ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Expires in ${h > 0 ? h + "h " : ""}${m}m · ✅ ${up} ⚠️🚩 ${down}</small>`;
			} else ttlHtml = `<br><small style="color:#dc2626;">⏳ Expired · ✅ ${up} ⚠️🚩 ${down}</small>`;
		} else ttlHtml = `<br><small style="color:var(--text-dim);">⏳ Pending · ✅ ${up} ⚠️🚩 ${down}</small>`;
	}
	const customHtml = buildCustomDataHTML(pinData, marker._customData, marker._layerId, marker._layerName, marker._schemaId);
	const layerBadge = marker._layerName ? `<br><span class="layer-badge" style="border-color:${marker._layerColor};">📑 ${escapeHtml(marker._layerName)}</span>` : "";
	const voteBtns = !isAnon && state.signingSecretKey && marker._authorPubkey !== state.signingPublicKey ? `<button class="vote-up-btn" data-pid="${escapeHtml(pinId)}" style="padding:2px 8px;border:1px solid #16a34a;background:var(--bg-card);color:#16a34a;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">👍</button><button class="vote-down-btn" data-pid="${escapeHtml(pinId)}" style="padding:2px 8px;border:1px solid #f97316;background:var(--bg-card);color:#f97316;border-radius:3px;cursor:pointer;font-size:11px;margin-right:4px;">👎</button><button class="flag-btn" data-pid="${escapeHtml(pinId)}" style="padding:2px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">🚩</button>` : "";
	const rt = relativeTime(marker._createdAt);
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div class="pin-detail-card" style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:560px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:85vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <div style="font-size:18px;font-weight:600;word-break:break-word;">${marker._pinEmoji ? marker._pinEmoji + " " : ""}${escapeHtml(pinData.title || "")}</div>
      <button id="pin-detail-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;flex-shrink:0;margin-left:8px;">×</button>
    </div>
    ${isAnon ? "<div style=\"font-size:10px;color:var(--text-muted);margin-bottom:4px;\">anonymous</div>" : ""}
    <div style="overflow-y:auto;flex:1;">
      <div style="font-size:14px;color:var(--text);white-space:pre-wrap;word-break:break-word;margin-bottom:8px;">${escapeHtml(pinData.note || "")}</div>
      ${customHtml}
      ${mediaHtml}
      ${r && r.ciphertext ? `<br><button class="download-media-btn" data-pid="${escapeHtml(pinId)}" style="font-size:11px;padding:2px 8px;border:1px solid #2563eb;background:transparent;color:#2563eb;border-radius:3px;cursor:pointer;margin-top:4px;">⬇ Download</button>` : ""}
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px;">${rt}</div>
      ${ttlHtml}
      ${layerBadge}
      <div style="margin-top:8px;">${voteBtns ? voteBtns + "<br>" : ""}${editBtns ? editBtns : ""}
        ${!isTutorial ? `<button class="osm-edit-btn" data-lat="${pinData.lat}" data-lng="${pinData.lng}" style="padding:4px 8px;border:1px solid #7c3aed;background:var(--bg-card);color:#7c3aed;border-radius:3px;cursor:pointer;font-size:12px;margin-left:4px;">&#x1F310; Edit in OSM</button>` : ""}
        <button class="pin-route-btn" data-lat="${pinData.lat}" data-lng="${pinData.lng}" style="padding:4px 8px;border:1px solid #7c3aed;background:var(--bg-card);color:#7c3aed;border-radius:3px;cursor:pointer;font-size:12px;margin-left:4px;">&#x1F6E3; Route</button>
        <button class="pin-collect-btn" data-pid="${escapeHtml(pinId)}" style="padding:4px 8px;border:1px solid #eab308;background:var(--bg-card);color:#eab308;border-radius:3px;cursor:pointer;font-size:12px;margin-left:4px;">&#x1F4C1; Collect</button>
      </div>
      <hr style="margin:12px 0 8px;border-color:var(--border);">
      <div class="annotation-thread pin-detail-thread" data-pin-id="${escapeHtml(pinId)}" style="max-height:none;overflow-y:visible;font-size:13px;">Loading...</div>
    </div>
  </div>`;
	document.body.appendChild(ov);
	const card = ov.querySelector(".pin-detail-card");
	const threadEl = ov.querySelector(".pin-detail-thread");
	const clean = () => {
		for (const u of mediaUrls) URL.revokeObjectURL(u);
		ov.remove();
		window._pinDetailClean = null;
	};
	window._pinDetailClean = clean;
	ov.querySelector("#pin-detail-close").onclick = clean;
	ov.addEventListener("click", (e) => {
		if (e.target === ov) clean();
	});
	card.addEventListener("click", (e) => {
		if (e.target.matches(".edit-pin-btn")) setTimeout(() => clean(), 100);
		if (e.target.matches(".osm-edit-btn")) {
			const lat = parseFloat(e.target.dataset.lat);
			const lng = parseFloat(e.target.dataset.lng);
			window.open(`https://www.openstreetmap.org/edit?editor=id#map=18/${lat}/${lng}`, "_blank");
		}
		if (e.target.matches(".pin-route-btn")) import("./map-routing.js").then((r) => {
			if (!r.isRoutingActive()) r.toggleRouting();
			r.addWaypoint(parseFloat(e.target.dataset.lat), parseFloat(e.target.dataset.lng));
		});
		if (e.target.matches(".pin-collect-btn")) showCollectionPicker(e.target.dataset.pid, state.currentSet);
	}, true);
	renderAnnotationThread(pinId, threadEl);
}
var _selectedMarkers = /* @__PURE__ */ new Set();
function toggleMarkerSelection(m) {
	if (_selectedMarkers.has(m)) {
		_selectedMarkers.delete(m);
		m.setIcon(pinIcon(m._pinColor || "#2563eb"));
	} else {
		_selectedMarkers.add(m);
		m.setIcon(pinIcon("#f59e0b"));
	}
}
function clearSelection() {
	for (const m of _selectedMarkers) m.setIcon(pinIcon(m._pinColor || "#2563eb"));
	_selectedMarkers.clear();
}
function canDeletePin(markerOrRow) {
	if (markerOrRow?.posted_anonymously || markerOrRow?._postedAnonymously) return false;
	const authorPubkey = markerOrRow?.author_pubkey || markerOrRow?._authorPubkey;
	const isOwner = authorPubkey && authorPubkey === state.signingPublicKey;
	const myRole = state.myRole;
	return (isOwner || myRole === "maintainer" || myRole === "founder") && myRole !== "reader";
}
function canModifyDrawing(row) {
	if (row?.posted_anonymously) return false;
	const isOwner = row?.author_pubkey && row.author_pubkey === state.signingPublicKey;
	const myRole = state.myRole;
	return (isOwner || myRole === "maintainer" || myRole === "founder") && myRole !== "reader";
}
async function deleteSelected() {
	if (_selectedMarkers.size === 0) {
		const popup = state.map?.getPopup();
		if (popup) {
			const el = popup.getContent();
			const pid = typeof el === "string" ? el.match(/data-pid="([^"]+)"/)?.[1] : null;
			if (pid) await deletePin(pid);
		}
		return;
	}
	if (!await confirmDialog(`Delete ${_selectedMarkers.size} pin${_selectedMarkers.size > 1 ? "s" : ""}?`)) return;
	for (const m of _selectedMarkers) {
		const pid = m._pinId;
		if (!pid) continue;
		if (!canDeletePin(m)) continue;
		await deletePin(pid);
	}
	clearSelection();
	await loadPins();
}
function placePin() {
	if (!state.map || !state.currentSet) return;
	state.placingPin = !state.placingPin;
	state.map.getContainer().style.cursor = state.placingPin ? "crosshair" : "";
}
var _collectionMarkers = null;
var _collectionBanner = null;
var _undoStack = [];
var _redoStack = [];
var MAX_UNDO = 30;
function pushUndo(action) {
	action._set = state.currentSet;
	_undoStack.push(action);
	if (_undoStack.length > MAX_UNDO) _undoStack.shift();
	_redoStack.length = 0;
}
async function undo() {
	const action = _undoStack.pop();
	if (!action) return;
	if (action._set && action._set !== state.currentSet) {
		toast("Cannot undo across different maps", "#f97316");
		_undoStack.push(action);
		return;
	}
	playUndo();
	if (action.kind === "pin") {
		_redoStack.push({
			kind: "pin",
			type: action.type === "delete" ? "save" : "delete",
			pin: action.pin,
			pid: action.pid
		});
		if (action.type === "delete") {
			await savePin$1(action.pin);
			window._broadcast?.("new_pin", action.pin);
		} else {
			await deletePin$1(action.pid);
			window._broadcast?.("delete_pin", { pin_id: action.pid });
		}
		await loadPins();
	} else if (action.kind === "drawing") {
		_redoStack.push({
			kind: "drawing",
			type: action.type === "delete" ? "save" : "delete",
			drawing: action.drawing,
			did: action.did
		});
		if (action.type === "delete") {
			await saveDrawing$1(action.drawing);
			window._broadcast?.("new_drawing", action.drawing);
		} else {
			await deleteDrawing$1(action.did);
			window._broadcast?.("delete_drawing", { drawing_id: action.did });
		}
		await loadDrawings();
	}
}
async function redo() {
	const action = _redoStack.pop();
	if (!action) return;
	if (action._set && action._set !== state.currentSet) {
		toast("Cannot redo across different maps", "#f97316");
		_redoStack.push(action);
		return;
	}
	playRedo();
	if (action.kind === "pin") {
		_undoStack.push({
			kind: "pin",
			type: action.type === "delete" ? "save" : "delete",
			pin: action.pin,
			pid: action.pid
		});
		if (action.type === "delete") {
			await savePin$1(action.pin);
			window._broadcast?.("new_pin", action.pin);
		} else {
			await deletePin$1(action.pid);
			window._broadcast?.("delete_pin", { pin_id: action.pid });
		}
		await loadPins();
	} else if (action.kind === "drawing") {
		_undoStack.push({
			kind: "drawing",
			type: action.type === "delete" ? "save" : "delete",
			drawing: action.drawing,
			did: action.did
		});
		if (action.type === "delete") {
			await saveDrawing$1(action.drawing);
			window._broadcast?.("new_drawing", action.drawing);
		} else {
			await deleteDrawing$1(action.did);
			window._broadcast?.("delete_drawing", { drawing_id: action.did });
		}
		await loadDrawings();
	}
}
async function savePin(lat, lng, title, note, color, media, emoji, layerId, schemaId, customData, validFrom, validUntil, postedAnonymously) {
	if (!state.dek || !state.currentSet) return;
	if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
		toast("Invalid coordinates", "#dc2626");
		return;
	}
	title = String(title || "Untitled").slice(0, 500);
	emoji = String(emoji || "").replace(/<[^>]*>/g, "").slice(0, 8);
	const pid = generate_uuid();
	const enc = encrypt_pin_data(title, note, lat, lng, color, state.dek);
	const pin = {
		pin_id: pid,
		team_id: state.currentSet,
		layer_id: layerId || (state.layers[0] ? state.layers[0].layer_id : null),
		ciphertext: enc.ciphertext,
		nonce: enc.nonce,
		created_at: Date.now(),
		map_zoom: state.map?.getZoom() || 13
	};
	if (!postedAnonymously && state.signingPublicKey) pin.author_pubkey = state.signingPublicKey;
	if (postedAnonymously) pin.posted_anonymously = true;
	if (!postedAnonymously && state.signingPublicKey && state.signingSecretKey) {
		const ts = Date.now();
		const payload = encode_hex(new TextEncoder().encode(`${pid}|up|${ts}`));
		pin.votes = [{
			direction: "up",
			pubkey: state.signingPublicKey,
			timestamp: ts,
			signature: sign(payload, state.signingSecretKey)
		}];
	}
	const gov = {
		ttl_enabled: false,
		ttl_base_mins: 10080,
		ttl_vote_mins: 360,
		ttl_min_mins: 60,
		ttl_max_mins: 43200,
		...state.currentCommunity?.governance || {}
	};
	if (gov.ttl_enabled) {
		const now = Date.now();
		pin.ttl_base_at = now;
		pin.ttl_expires_at = now + (gov.ttl_base_mins || 10080) * 6e4;
	}
	if (schemaId) pin.schema_id = schemaId;
	if (customData) {
		const cdEnc = encrypt_raw_bytes(new TextEncoder().encode(JSON.stringify(customData)), state.dek);
		pin.custom_data = {
			ciphertext: cdEnc.ciphertext,
			nonce: cdEnc.nonce
		};
	}
	if (validFrom !== null && validFrom !== void 0 && validFrom !== "") pin.valid_from = parseInt(validFrom, 10);
	if (validUntil !== null && validUntil !== void 0 && validUntil !== "") pin.valid_until = parseInt(validUntil, 10);
	if (media) pin.media = media;
	if (emoji) pin.emoji = emoji;
	await savePin$1(pin);
	if (state._decryptedPinCache) state._decryptedPinCache.delete(pid);
	pushUndo({
		kind: "pin",
		type: "save",
		pin,
		pid
	});
	window._broadcast?.("new_pin", pin);
	await loadPins();
	window._addHistory?.(t("pinAdded"), title);
	try {
		navigator.vibrate?.(20);
	} catch (e) {
		console.warn("[map]", e.message);
	}
	playPinDrop();
}
async function deletePin(pid) {
	if (state._deletingPin) return;
	state._deletingPin = true;
	try {
		const row = (await getPins(state.currentSet)).find((p) => p.pin_id === pid);
		if (!canDeletePin(row)) {
			window._toast?.("Not authorized to delete this pin", "#dc2626");
			return;
		}
		if (row) pushUndo({
			kind: "pin",
			type: "delete",
			pin: row,
			pid
		});
		const anns = await getAnnotationsByPin(pid, 0, 1e4);
		for (const a of anns || []) await deleteAnnotation(a.annotation_id);
		await deletePin$1(pid);
		if (state._decryptedPinCache) state._decryptedPinCache.delete(pid);
		window._broadcast?.("delete_pin", { pin_id: pid });
		await loadPins();
		window._addHistory?.(t("pinDeleted"), pid.slice(0, 8));
	} finally {
		state._deletingPin = false;
	}
	try {
		navigator.vibrate?.(20);
	} catch (e) {
		console.warn("[map]", e.message);
	}
	window._toast?.("Pin deleted. Undo?", "#f97316", 5e3, () => {
		undo();
	});
}
async function updatePin(pid, title, note, color, media, emoji, layerId, schemaId, customData, validFrom, validUntil) {
	if (!state.dek || !state.currentSet) return;
	title = String(title || "Untitled").slice(0, 500);
	emoji = String(emoji || "").replace(/<[^>]*>/g, "").slice(0, 8);
	const row = (await getPins(state.currentSet)).find((p) => p.pin_id === pid);
	if (!row) return;
	const pin = decrypt_pin_data(row.ciphertext, row.nonce, state.dek);
	const enc = encrypt_pin_data(title, note, pin.lat, pin.lng, color, state.dek);
	const updated = {
		pin_id: pid,
		team_id: state.currentSet,
		layer_id: layerId !== void 0 ? layerId : row.layer_id,
		ciphertext: enc.ciphertext,
		nonce: enc.nonce,
		created_at: row.created_at || Date.now(),
		map_zoom: row.map_zoom || 13,
		ttl_base_at: row.ttl_base_at,
		ttl_expires_at: row.ttl_expires_at,
		vote_count_up: row.vote_count_up ?? 0,
		vote_count_down: row.vote_count_down ?? 0,
		attestations: row.attestations || [],
		posted_anonymously: row.posted_anonymously || false
	};
	if (schemaId !== void 0) updated.schema_id = schemaId;
	else if (row.schema_id) updated.schema_id = row.schema_id;
	if (customData !== void 0 && customData !== null) {
		const cdEnc = encrypt_raw_bytes(new TextEncoder().encode(JSON.stringify(customData)), state.dek);
		updated.custom_data = {
			ciphertext: cdEnc.ciphertext,
			nonce: cdEnc.nonce
		};
	} else if (row.custom_data) updated.custom_data = row.custom_data;
	if (media !== void 0) updated.media = media;
	else if (row.media) updated.media = row.media;
	if (emoji !== void 0) updated.emoji = emoji;
	else if (row.emoji) updated.emoji = row.emoji;
	if (validFrom !== void 0) updated.valid_from = validFrom !== "" ? parseInt(validFrom, 10) : null;
	else if (row.valid_from !== void 0) updated.valid_from = row.valid_from;
	if (validUntil !== void 0) updated.valid_until = validUntil !== "" ? parseInt(validUntil, 10) : null;
	else if (row.valid_until !== void 0) updated.valid_until = row.valid_until;
	if (row.author_pubkey) updated.author_pubkey = row.author_pubkey;
	await savePin$1(updated);
	if (state._decryptedPinCache) state._decryptedPinCache.delete(pid);
	window._broadcast?.("new_pin", updated);
	await loadPins();
	window._addHistory?.(t("pinEdited"), title);
}
function showEditPinForm(pid) {
	if (window._showEditPinForm) return window._showEditPinForm(pid);
	if (!state.dek || !state.currentSet) return;
	getPins(state.currentSet).then((pins) => {
		const row = pins.find((p) => p.pin_id === pid);
		if (!row) return;
		const pin = decrypt_pin_data(row.ciphertext, row.nonce, state.dek);
		const ov = document.createElement("div");
		ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
		const curColor = pin.color || "#2563eb";
		const layerOptions = state.layers.map((l) => `<option value="${l.layer_id}" ${l.layer_id === row.layer_id ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("");
		const schemaOpts = `<option value="">none</option>` + state.schemas.map((s) => `<option value="${s.schema_id}" ${s.schema_id === row.schema_id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
		ov.innerHTML = buildPinFormHTML({
			prefix: "edit-pin",
			title: t("editPin"),
			titleValue: pin.title || "",
			note: pin.note || "",
			color: curColor,
			emoji: row.emoji,
			layerOptions,
			schemaOptions: schemaOpts,
			showRecording: false,
			showCancel: true,
			showTTL: false,
			showAnon: false,
			showTime: true,
			timeFrom: row.valid_from,
			timeUntil: row.valid_until
		});
		document.body.appendChild(ov);
		document.getElementById("edit-pin-title").focus();
		const editNoteTextarea = document.getElementById("edit-pin-note");
		if (editNoteTextarea) {
			const geoBtn = document.createElement("button");
			geoBtn.type = "button";
			geoBtn.textContent = "📍";
			geoBtn.title = t("reverseGeocode") || "Fill address";
			geoBtn.style.cssText = "position:relative;width:28px;height:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;";
			geoBtn.onclick = async () => {
				geoBtn.textContent = "⏳";
				const address = await reverseGeocode(pin.lat, pin.lng);
				geoBtn.textContent = "📍";
				if (address) {
					const current = editNoteTextarea.value.trim();
					editNoteTextarea.value = current ? current + "\n" + address : address;
					toast("Address filled", "#16a34a");
				} else toast("Could not find address", "#dc2626");
			};
			editNoteTextarea.parentNode.insertBefore(geoBtn, editNoteTextarea.nextSibling);
		}
		const clean = () => ov.remove();
		document.getElementById("edit-pin-cancel").onclick = clean;
		ov.onclick = (e) => {
			if (e.target === ov) clean();
		};
		document.getElementById("edit-pin-title").addEventListener("keydown", (e) => {
			if (e.key === "Enter") document.getElementById("edit-pin-save").click();
		});
		document.getElementById("edit-pin-color-picker");
		wireColorPicker("edit-pin-color-picker", "edit-pin-color", "edit-pin-hex", COLORS);
		renderSchemaFieldsById(row.schema_id, "edit-schema-fields", row.custom_data);
		document.getElementById("edit-pin-schema").addEventListener("change", () => {
			const sid = document.getElementById("edit-pin-schema").value;
			renderSchemaFieldsById(sid || null, "edit-schema-fields", row.custom_data);
		});
		if (row.valid_from) document.getElementById("edit-pin-time-from").value = row.valid_from;
		if (row.valid_until) document.getElementById("edit-pin-time-to").value = row.valid_until;
		document.getElementById("edit-pin-layer").addEventListener("change", () => {
			const lid = document.getElementById("edit-pin-layer").value;
			const sid = state.layers.find((l) => l.layer_id === lid)?.default_schema_id || "";
			document.getElementById("edit-pin-schema").value = sid;
			renderSchemaFieldsById(sid || null, "edit-schema-fields", row.custom_data);
		});
		const editPinEmojiBtn = document.getElementById("edit-pin-emoji-btn");
		const editPinEmojiInput = document.getElementById("edit-pin-emoji");
		editPinEmojiBtn.onclick = () => {
			editPinEmojiInput.focus();
			document.execCommand?.("insertText", false, "😊");
		};
		document.getElementById("edit-pin-save").onclick = async () => {
			const t = document.getElementById("edit-pin-title").value.trim();
			const n = document.getElementById("edit-pin-note").value.trim();
			const color = document.getElementById("edit-pin-color").value;
			const emoji = document.getElementById("edit-pin-emoji").value.trim();
			const layerId = document.getElementById("edit-pin-layer").value;
			const schemaData = collectSchemaData("edit-schema-fields");
			const schemaId = document.getElementById("edit-pin-schema").value || null;
			const validFrom = document.getElementById("edit-pin-time-from").value;
			const validUntil = document.getElementById("edit-pin-time-to").value;
			const file = document.getElementById("edit-pin-media").files[0];
			let media = void 0;
			if (file) {
				const prog = showProgressDialog("Processing media...");
				try {
					await checkStorageQuota(file.size, "attachment");
					prog.update(5, "Compressing media...");
					const c = await compressMedia(file, (pct) => prog.update(5 + Math.round(pct * .75), "Compressing media..."));
					prog.update(80, "Encrypting...");
					const enc = encrypt_raw_bytes(new Uint8Array(c.buffer), state.dek);
					prog.update(90, "Saving...");
					media = {
						type: c.type,
						name: c.name,
						ciphertext: enc.ciphertext,
						nonce: enc.nonce
					};
					prog.update(100, "Done");
					prog.done();
				} catch (e) {
					prog.done();
					throw e;
				}
			}
			clean();
			await updatePin(pid, t || "Untitled", n, color, media, emoji, layerId, schemaId, schemaData, validFrom, validUntil);
			state.map.closePopup();
		};
	}).catch(() => {});
}
function showDrawingForm(g) {
	const gov = {
		anonymous_posting: "forbidden",
		...state.currentCommunity?.governance || {}
	};
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	const colorCircles = colorPresetsHTML(COLORS, "#2563eb");
	const layerOpts = state.layers.map((l) => `<option value="${l.layer_id}">${escapeHtml(l.name)}</option>`).join("");
	const isColl = g.type === "FeatureCollection";
	let radiusHtml = "";
	if (isColl) {
		let d = 0;
		for (const f of g.features) if (f.geometry?.type === "LineString") {
			const c = f.geometry.coordinates;
			for (let i = 1; i < c.length; i++) d += leaflet_shim_default.latLng(c[i - 1][1], c[i - 1][0]).distanceTo([c[i][1], c[i][0]]);
		}
		if (d > 0) radiusHtml = `<div style="margin-bottom:10px;padding:6px 8px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:12px;color:#166534;"><b>${t("length")}:</b> ${fmtDist(d)}</div>`;
	} else if (g.geometry?.type === "LineString") {
		const c = g.geometry.coordinates;
		let d = 0;
		for (let i = 1; i < c.length; i++) d += leaflet_shim_default.latLng(c[i - 1][1], c[i - 1][0]).distanceTo([c[i][1], c[i][0]]);
		radiusHtml = `<div style="margin-bottom:10px;padding:6px 8px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:12px;color:#166534;"><b>${t("length")}:</b> ${fmtDist(d)}</div>`;
	}
	if (g.geometry?.type === "Point" && g.properties?.radius) {
		const r = g.properties.radius;
		radiusHtml = `<div style="margin-bottom:10px;padding:6px 8px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:12px;color:#166534;"><b>${t("circumference")}:</b> ${fmtDist(2 * Math.PI * r)}<br><b>${t("diameter")}:</b> ${fmtDist(r * 2)}<br><b>${t("area")}:</b> ${fmtArea(Math.PI * r * r)}&nbsp;${toggleLink()}</div>`;
	}
	const anonOpt = gov.anonymous_posting === "allowed" || gov.anonymous_posting === "members_only" ? `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="drawing-anonymous" /> Post anonymously</label>` : "";
	ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:280px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("newDrawing")}</h3>${radiusHtml}<input id="drawing-title" placeholder="${t("title")}" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;" /><textarea id="drawing-note" placeholder="${t("description")}" rows="3" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;resize:vertical;"></textarea><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("color")}</div><div id="drawing-color-picker" style="display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap;">${colorCircles}</div><input type="hidden" id="drawing-color" value="#2563eb" /><label style="display:flex;align-items:center;gap:4px;font-size:12px;margin-bottom:8px;"><input type="checkbox" id="drawing-arrow" /> ${t("arrow")}</label><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("layer") || "Layer"}</div><select id="drawing-layer" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${layerOpts}</select>${anonOpt}<label style="font-size:12px;color:var(--text-dim);">${t("attachment")}</label><input type="file" id="drawing-media" style="font-size:12px;padding:4px;border:1px solid var(--border);border-radius:3px;width:100%;box-sizing:border-box;margin-bottom:12px;background:var(--bg-input);" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="drawing-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="drawing-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button></div></div>`;
	document.body.appendChild(ov);
	document.getElementById("drawing-title").focus();
	const clean = () => ov.remove();
	document.getElementById("drawing-cancel").onclick = clean;
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("drawing-title").addEventListener("keydown", (e) => {
		if (e.key === "Enter") document.getElementById("drawing-save").click();
	});
	document.getElementById("drawing-color-picker");
	wireColorPicker("drawing-color-picker", "drawing-color", null, COLORS);
	document.getElementById("drawing-save").onclick = async () => {
		const ti = document.getElementById("drawing-title").value.trim(), nn = document.getElementById("drawing-note").value.trim(), arrow = document.getElementById("drawing-arrow").checked;
		const color = document.getElementById("drawing-color").value;
		const layerId = document.getElementById("drawing-layer").value;
		g.properties = g.properties || {};
		g.properties.title = ti || "Drawing";
		g.properties.note = nn;
		g.properties.arrow = arrow;
		g.properties.color = color;
		if (isColl) for (const f of g.features) {
			f.properties = f.properties || {};
			if (!f.properties.color) f.properties.color = color;
			if (arrow && f.geometry?.type === "LineString") f.properties.arrow = true;
		}
		const file = document.getElementById("drawing-media").files[0];
		let media = null;
		if (file) {
			const prog = showProgressDialog("Processing media...");
			try {
				await checkStorageQuota(file.size, "attachment");
				prog.update(5, "Compressing media...");
				const c = await compressMedia(file, (pct) => prog.update(5 + Math.round(pct * .75), "Compressing media..."));
				prog.update(80, "Encrypting...");
				const enc = encrypt_raw_bytes(new Uint8Array(c.buffer), state.dek);
				prog.update(90, "Saving...");
				media = {
					type: c.type,
					name: c.name,
					ciphertext: enc.ciphertext,
					nonce: enc.nonce
				};
				prog.update(100, "Done");
				prog.done();
			} catch (e) {
				prog.done();
				throw e;
			}
		}
		clean();
		const anon = document.getElementById("drawing-anonymous")?.checked || false;
		await saveDrawing(g, media, layerId, anon);
	};
}
function buildPinFormHTML(opts) {
	const p = opts.prefix;
	const colorCircles = colorPresetsHTML(COLORS, opts.color || "#2563eb");
	const hueHtml = hueDotHTML(opts.color || "#2563eb", `${p}-hue`);
	const hexHtml = hexInputHTML(`${p}-hex`, escapeHtml(opts.color || "#2563eb"));
	const titleVal = escapeHtml(opts.titleValue || "");
	const noteVal = escapeHtml(opts.note || "");
	const emojiVal = escapeHtml(opts.emoji || "");
	const extras = opts.showTTL ? `${opts.ttlInfo || ""}` : "";
	const anonHTML = opts.showAnon ? `<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-dim);margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="${p}-anonymous" /> Post anonymously</label>` : "";
	const mediaSection = opts.showRecording ? `<input type="file" id="${p}-media" accept="image/*,video/*,audio/*" style="font-size:12px;margin-bottom:10px;display:block;" />` : `<div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("photoVideo")}</div><input type="file" id="${p}-media" accept="image/*,video/*,audio/*" style="font-size:12px;margin-bottom:10px;display:block;background:var(--bg-input);border:1px solid var(--border);border-radius:4px;padding:4px;width:100%;box-sizing:border-box;" />`;
	const timeFromVal = opts.timeFrom != null ? opts.timeFrom : "";
	const timeUntilVal = opts.timeUntil != null ? opts.timeUntil : "";
	const timeSection = opts.showTime ? `<div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("timeFrom")}</div><input type="text" id="${p}-time-from" placeholder="YYYY" value="${timeFromVal}" style="width:100%;padding:6px;margin-bottom:4px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;" /><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("timeTo")}</div><input type="text" id="${p}-time-to" placeholder="YYYY" value="${timeUntilVal}" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;" />` : "";
	return `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${opts.title}</h3>${extras}<input id="${p}-title" placeholder="${t("title")}" value="${titleVal}" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;" /><textarea id="${p}-note" placeholder="${t("description")}" rows="3" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;resize:vertical;background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:13px;">${noteVal}</textarea><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("color")}</div><div id="${p}-color-picker" style="display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">${colorCircles}${hueHtml}${hexHtml}</div><input type="hidden" id="${p}-color" value="${escapeHtml(opts.color || "#2563eb")}" /><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("emoji") || "Emoji"}</div><div style="display:flex;gap:4px;margin-bottom:8px;"><input type="text" id="${p}-emoji" placeholder="😊" value="${emojiVal}" maxlength="2" style="width:56px;height:42px;text-align:center;font-size:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);padding:0;box-sizing:border-box;" /><button type="button" id="${p}-emoji-btn" style="width:28px;height:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;">😊</button></div><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("layer") || "Layer"}</div><select id="${p}-layer" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${opts.layerOptions}</select><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("schema") || "Schema"}</div><select id="${p}-schema" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:13px;">${opts.schemaOptions}</select><div id="${p === "pin" ? "schema-fields" : "edit-schema-fields"}" style="margin-bottom:8px;"></div>${anonHTML}${timeSection}${mediaSection}<div style="display:flex;gap:8px;justify-content:flex-end;"><button id="${p}-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="${p}-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button></div></div>`;
}
function showPinForm(lat, lng) {
	if (window._showPinForm) return window._showPinForm(lat, lng);
	const gov = {
		ttl_enabled: false,
		ttl_base_mins: 10080,
		ttl_vote_mins: 360,
		ttl_min_mins: 60,
		ttl_max_mins: 43200,
		anonymous_posting: "forbidden",
		...state.currentCommunity?.governance || {}
	};
	const ttlInfo = gov.ttl_enabled ? `<div style="font-size:10px;color:var(--text-dim);margin:4px 0;">⏳ TTL: ${gov.ttl_base_mins} min base + ${gov.ttl_vote_mins} min/vote · min ${gov.ttl_min_mins} · max ${gov.ttl_max_mins}</div>` : "";
	const defaultSchemaId = state.layers.find((l) => l.layer_id === state.activeLayerId)?.default_schema_id || null;
	const layerOptions = state.layers.map((l) => `<option value="${l.layer_id}" ${l.layer_id === state.activeLayerId ? "selected" : ""}>${escapeHtml(l.name)}</option>`).join("");
	const schemaOptions = `<option value="">none</option>` + state.schemas.map((s) => `<option value="${s.schema_id}" ${s.schema_id === defaultSchemaId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = buildPinFormHTML({
		prefix: "pin",
		title: t("newPin"),
		titleValue: "",
		note: "",
		color: "#2563eb",
		emoji: "",
		layerOptions,
		schemaOptions,
		showRecording: true,
		showCancel: false,
		showTTL: gov.ttl_enabled,
		ttlInfo,
		showAnon: gov.anonymous_posting === "allowed" || gov.anonymous_posting === "members_only",
		showTime: true
	});
	document.body.appendChild(ov);
	document.getElementById("pin-title").focus();
	const noteTextarea = document.getElementById("pin-note");
	if (noteTextarea) {
		const geoBtn = document.createElement("button");
		geoBtn.type = "button";
		geoBtn.textContent = "📍";
		geoBtn.title = t("reverseGeocode") || "Fill address";
		geoBtn.style.cssText = "position:absolute;right:16px;margin-top:6px;width:28px;height:28px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;";
		geoBtn.style.position = "relative";
		geoBtn.onclick = async () => {
			geoBtn.textContent = "⏳";
			const address = await reverseGeocode(lat, lng);
			geoBtn.textContent = "📍";
			if (address) {
				const current = noteTextarea.value.trim();
				noteTextarea.value = current ? current + "\n" + address : address;
				toast("Address filled", "#16a34a");
			} else toast("Could not find address", "#dc2626");
		};
		noteTextarea.parentNode.insertBefore(geoBtn, noteTextarea.nextSibling);
	}
	let mediaRecorder = null, mediaStream = null, recordedChunks = [], recordType = null;
	let recordBlob = null, recordTimer = null, recordStartTime = 0, _cameraFacing = "environment";
	function formatTime(ms) {
		const s = Math.floor(ms / 1e3);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
	}
	async function switchCamera() {
		if (!mediaStream || !recordType) return;
		const prevRecorder = mediaRecorder;
		const prevStream = mediaStream;
		if (prevRecorder) prevRecorder.onstop = null;
		if (recordTimer) {
			clearInterval(recordTimer);
			recordTimer = null;
		}
		prevRecorder?.stop();
		prevStream.getTracks().forEach((t) => t.stop());
		mediaRecorder = null;
		mediaStream = null;
		recordedChunks = [];
		_cameraFacing = _cameraFacing === "environment" ? "user" : "environment";
		if (recordType === "video") startRecording("video");
		else startSnapPhoto();
	}
	function createRecordingUI() {
		const mediaInput = document.getElementById("pin-media");
		if (!mediaInput || !window.MediaRecorder) return;
		const preview = document.createElement("video");
		preview.id = "rec-preview";
		preview.style.cssText = "display:none;width:100%;max-height:240px;margin-bottom:8px;border-radius:4px;background:#000;";
		preview.muted = true;
		preview.autoplay = true;
		preview.playsInline = true;
		mediaInput.parentNode.insertBefore(preview, mediaInput);
		const bar = document.createElement("div");
		bar.id = "rec-bar";
		bar.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:8px;";
		bar.innerHTML = `<button type="button" id="rec-video-btn" style="padding:4px 10px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:4px;cursor:pointer;font-size:12px;">📹 Record Video</button><button type="button" id="rec-audio-btn" style="padding:4px 10px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:4px;cursor:pointer;font-size:12px;">🎤 Record Audio</button><button type="button" id="rec-snap-btn" style="padding:4px 10px;border:1px solid #7c3aed;background:var(--bg-card);color:#7c3aed;border-radius:4px;cursor:pointer;font-size:12px;">📷 Snap Photo</button><span id="rec-status" style="display:none;font-size:12px;color:var(--text-dim);gap:6px;align-items:center;"></span>`;
		mediaInput.parentNode.insertBefore(bar, mediaInput);
		document.getElementById("rec-video-btn").onclick = () => startRecording("video");
		document.getElementById("rec-audio-btn").onclick = () => startRecording("audio");
		document.getElementById("rec-snap-btn").onclick = () => startSnapPhoto();
	}
	async function startRecording(type) {
		if (mediaRecorder || mediaStream) return;
		recordType = type;
		try {
			const constraints = type === "video" ? {
				video: {
					width: { ideal: 640 },
					height: { ideal: 480 },
					facingMode: _cameraFacing
				},
				audio: true
			} : { audio: true };
			mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
			const mime = type === "video" ? MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" : "audio/webm";
			recordedChunks = [];
			mediaRecorder = new MediaRecorder(mediaStream, {
				mimeType: mime,
				videoBitsPerSecond: 15e5
			});
			if (type === "video") {
				const preview = document.getElementById("rec-preview");
				if (preview) {
					preview.srcObject = mediaStream;
					preview.style.display = "block";
				}
			}
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) recordedChunks.push(e.data);
			};
			mediaRecorder.onstop = async () => {
				const prev = document.getElementById("rec-preview");
				if (prev) {
					prev.srcObject = null;
					prev.style.display = "none";
				}
				mediaStream.getTracks().forEach((t) => t.stop());
				mediaStream = null;
				mediaRecorder = null;
				if (recordTimer) {
					clearInterval(recordTimer);
					recordTimer = null;
				}
				recordBlob = new Blob(recordedChunks, { type: mime });
				const status = document.getElementById("rec-status");
				if (status) {
					status.style.display = "flex";
					status.innerHTML = `<span style="color:#16a34a;">✅ Recorded ${formatTime(Date.now() - recordStartTime)}</span><button type="button" id="rec-discard" style="padding:2px 6px;border:1px solid #dc2626;color:#dc2626;background:none;border-radius:3px;cursor:pointer;font-size:11px;">Discard</button>`;
					document.getElementById("rec-discard").onclick = () => {
						recordBlob = null;
						recordedChunks = [];
						status.style.display = "none";
						updateRecButtons();
					};
				}
				updateRecButtons();
			};
			mediaRecorder.start(1e3);
			recordStartTime = Date.now();
			updateRecButtons();
			const status = document.getElementById("rec-status");
			if (status) {
				status.style.display = "flex";
				const switchBtn = type === "video" ? `<button type="button" id="rec-switch-cam" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">🔄</button>` : "";
				status.innerHTML = `<span style="color:#dc2626;">⏺ Recording... ${formatTime(0)}</span>${switchBtn}<button type="button" id="rec-stop" style="padding:2px 8px;border:none;background:#dc2626;color:white;border-radius:3px;cursor:pointer;font-size:11px;">⏹ Stop</button>`;
				if (type === "video") document.getElementById("rec-switch-cam").onclick = () => switchCamera();
				document.getElementById("rec-stop").onclick = () => {
					if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
				};
				recordTimer = setInterval(() => {
					const elapsed = Date.now() - recordStartTime;
					const s = status.querySelector("span");
					if (s) s.textContent = `⏺ Recording... ${formatTime(elapsed)}`;
					if (elapsed >= (type === "video" ? 12e4 : 3e5) && mediaRecorder?.state === "recording") {
						mediaRecorder.stop();
						toast("Recording limit reached", "#f97316");
					}
				}, 500);
			}
			document.getElementById("pin-media").style.display = "none";
		} catch (err) {
			toast(type === "video" ? "Camera/mic access denied" : "Microphone access denied", "#dc2626");
			recordType = null;
		}
	}
	function updateRecButtons() {
		const vb = document.getElementById("rec-video-btn"), ab = document.getElementById("rec-audio-btn"), sb = document.getElementById("rec-snap-btn");
		if (!vb || !ab) return;
		const busy = !!mediaRecorder || !!recordBlob;
		vb.disabled = busy;
		ab.disabled = busy;
		if (sb) sb.disabled = busy;
		vb.style.opacity = busy ? "0.4" : "1";
		ab.style.opacity = busy ? "0.4" : "1";
		if (sb) sb.style.opacity = busy ? "0.4" : "1";
	}
	async function startSnapPhoto() {
		recordType = "snap";
		if (mediaRecorder || mediaStream || recordBlob) return;
		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({ video: {
				width: { ideal: 1280 },
				height: { ideal: 720 },
				facingMode: _cameraFacing
			} });
			const preview = document.getElementById("rec-preview");
			if (preview) {
				preview.srcObject = mediaStream;
				preview.style.display = "block";
			}
			updateRecButtons();
			const status = document.getElementById("rec-status");
			if (status) {
				status.style.display = "flex";
				status.innerHTML = `<button type="button" id="rec-capture" style="padding:4px 12px;border:none;background:#7c3aed;color:white;border-radius:4px;cursor:pointer;font-size:12px;">📸 Capture</button><button type="button" id="rec-switch-cam-snap" style="padding:2px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;">🔄</button><button type="button" id="rec-cancel-snap" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:11px;">Cancel</button>`;
				document.getElementById("rec-switch-cam-snap").onclick = () => switchCamera();
				const cleanupSnap = () => {
					if (mediaStream) {
						mediaStream.getTracks().forEach((t) => t.stop());
						mediaStream = null;
					}
					if (preview) {
						preview.srcObject = null;
						preview.style.display = "none";
					}
					status.style.display = "none";
					updateRecButtons();
				};
				document.getElementById("rec-cancel-snap").onclick = cleanupSnap;
				document.getElementById("rec-capture").onclick = () => {
					if (!preview || !mediaStream) return;
					const canvas = document.createElement("canvas");
					canvas.width = preview.videoWidth || 640;
					canvas.height = preview.videoHeight || 480;
					canvas.getContext("2d").drawImage(preview, 0, 0, canvas.width, canvas.height);
					canvas.toBlob((blob) => {
						if (!blob) {
							toast("Snapshot failed", "#dc2626");
							cleanupSnap();
							return;
						}
						recordBlob = blob;
						cleanupSnap();
						if (status) {
							status.style.display = "flex";
							status.innerHTML = `<span style="color:#16a34a;">📸 Photo captured</span><button type="button" id="rec-discard" style="padding:2px 6px;border:1px solid #dc2626;color:#dc2626;background:none;border-radius:3px;cursor:pointer;font-size:11px;">Discard</button>`;
							document.getElementById("rec-discard").onclick = () => {
								recordBlob = null;
								status.style.display = "none";
								updateRecButtons();
							};
						}
					}, "image/jpeg", .85);
				};
			}
			document.getElementById("pin-media").style.display = "none";
		} catch (err) {
			toast("Camera access denied", "#dc2626");
		}
	}
	createRecordingUI();
	const clean = () => {
		if (mediaStream) {
			mediaStream.getTracks().forEach((t) => t.stop());
			mediaStream = null;
		}
		if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
		mediaRecorder = null;
		recordBlob = null;
		recordedChunks = [];
		ov.remove();
	};
	document.getElementById("pin-cancel").onclick = clean;
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("pin-title").addEventListener("keydown", (e) => {
		if (e.key === "Enter") document.getElementById("pin-save").click();
	});
	document.getElementById("pin-color-picker");
	wireColorPicker("pin-color-picker", "pin-color", "pin-hex", COLORS);
	document.getElementById("pin-schema").addEventListener("change", () => {
		const sid = document.getElementById("pin-schema").value;
		renderSchemaFieldsById(sid || null, "schema-fields", null);
	});
	document.getElementById("pin-layer").addEventListener("change", () => {
		const lid = document.getElementById("pin-layer").value;
		const sid = state.layers.find((l) => l.layer_id === lid)?.default_schema_id || "";
		document.getElementById("pin-schema").value = sid;
		renderSchemaFieldsById(sid || null, "schema-fields", null);
	});
	if (defaultSchemaId) renderSchemaFieldsById(defaultSchemaId, "schema-fields", null);
	const pinEmojiBtn = document.getElementById("pin-emoji-btn");
	const pinEmojiInput = document.getElementById("pin-emoji");
	pinEmojiBtn.onclick = () => {
		pinEmojiInput.focus();
		document.execCommand?.("insertText", false, "😊");
	};
	document.getElementById("pin-save").onclick = async () => {
		const t = document.getElementById("pin-title").value.trim(), n = document.getElementById("pin-note").value.trim();
		const color = document.getElementById("pin-color").value;
		const emoji = document.getElementById("pin-emoji").value.trim();
		const layerId = document.getElementById("pin-layer").value;
		const schemaData = collectSchemaData("schema-fields");
		const schemaId = document.getElementById("pin-schema").value || null;
		const validFrom = document.getElementById("pin-time-from").value;
		const validUntil = document.getElementById("pin-time-to").value;
		const file = document.getElementById("pin-media").files[0];
		let media = null;
		const sourceFile = file || (recordBlob ? new File([recordBlob], `recording-${Date.now()}.webm`, { type: recordBlob.type }) : null);
		if (sourceFile) {
			const prog = showProgressDialog("Processing media...");
			try {
				await checkStorageQuota(sourceFile.size, "attachment");
				prog.update(5, "Compressing media...");
				const c = await compressMedia(sourceFile, (pct) => prog.update(5 + Math.round(pct * .75), "Compressing media..."));
				prog.update(80, "Encrypting...");
				const enc = encrypt_raw_bytes(new Uint8Array(c.buffer), state.dek);
				prog.update(90, "Saving pin...");
				media = {
					type: c.type,
					name: c.name,
					ciphertext: enc.ciphertext,
					nonce: enc.nonce
				};
				prog.update(100, "Done");
				prog.done();
			} catch (e) {
				prog.done();
				throw e;
			}
		}
		if (mediaStream) {
			mediaStream.getTracks().forEach((t) => t.stop());
			mediaStream = null;
		}
		if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
		if (recordTimer) {
			clearInterval(recordTimer);
			recordTimer = null;
		}
		mediaRecorder = null;
		recordBlob = null;
		recordedChunks = [];
		clean();
		const postedAnonymously = document.getElementById("pin-anonymous")?.checked || false;
		await savePin(lat, lng, t || "Untitled", n, color, media, emoji, layerId, schemaId, schemaData, validFrom, validUntil, postedAnonymously);
	};
}
function addDrawControl() {
	const toolbar = leaflet_shim_default.DomUtil.create("div");
	toolbar.style.cssText = "position:absolute;top:175px;right:8px;z-index:1000;display:flex;flex-direction:column;gap:2px;";
	const shapeOpts = {
		color: "#2563eb",
		weight: 2,
		fillOpacity: .15
	};
	const toolDefs = [
		{
			title: `${t("polyline")}`,
			svg: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><polyline points=\"2,14 6,6 10,10 14,2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
			create: () => new leaflet_shim_default.Draw.Polyline(state.map, { shapeOptions: shapeOpts })
		},
		{
			title: `${t("polygon")}`,
			svg: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><path d=\"M8 2L14 6L12 12L4 12L2 6Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/></svg>",
			create: () => new leaflet_shim_default.Draw.Polygon(state.map, {
				shapeOptions: shapeOpts,
				allowIntersection: false,
				showArea: true
			})
		},
		{
			title: `${t("rectangle")}`,
			svg: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><rect x=\"2\" y=\"3\" width=\"12\" height=\"10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" rx=\"1\"/></svg>",
			create: () => new leaflet_shim_default.Draw.Rectangle(state.map, { shapeOptions: shapeOpts })
		},
		{
			title: `${t("circle")}`,
			svg: "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><circle cx=\"8\" cy=\"8\" r=\"6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"/></svg>",
			create: () => new leaflet_shim_default.Draw.Circle(state.map, { shapeOptions: shapeOpts })
		}
	];
	let activeBtn = null;
	let activeHandler = null;
	function resetActive() {
		if (activeHandler) {
			activeHandler.disable();
			activeHandler = null;
		}
		if (activeBtn) {
			activeBtn.style.background = "white";
			activeBtn.style.color = "#374151";
			activeBtn = null;
		}
	}
	toolDefs.forEach((def) => {
		const btn = leaflet_shim_default.DomUtil.create("button");
		btn.title = def.title;
		btn.innerHTML = def.svg;
		btn.style.cssText = "width:36px;height:36px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);color:var(--text);cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;padding:0;";
		btn.onclick = (e) => {
			e.stopPropagation();
			if (activeBtn === btn) {
				resetActive();
				return;
			}
			resetActive();
			activeBtn = btn;
			btn.style.background = "#2563eb";
			btn.style.color = "white";
			activeHandler = def.create();
			activeHandler.enable();
		};
		toolbar.appendChild(btn);
	});
	state.map.getContainer().appendChild(toolbar);
	state.map.on(leaflet_shim_default.Draw.Event.CREATED, (e) => {
		resetActive();
		const l = e.layer, g = l.toGeoJSON();
		if (l instanceof leaflet_shim_default.Circle) {
			g.properties = g.properties || {};
			g.properties.radius = l.getRadius();
		}
		showDrawingForm(g);
	});
	state.map.on(leaflet_shim_default.Draw.Event.DRAWSTOP, () => resetActive());
}
function geoJsonToLayer(g) {
	if (g.type === "FeatureCollection") {
		const group = leaflet_shim_default.featureGroup();
		for (const feature of g.features) group.addLayer(geoJsonToLayer(feature));
		return group;
	}
	const c = g.properties?.color || "#2563eb";
	if (g.geometry.type === "Point" && g.properties?.radius) {
		const [lng, lat] = g.geometry.coordinates;
		return leaflet_shim_default.circle([lat, lng], {
			radius: g.properties.radius,
			color: c,
			weight: 2,
			fillOpacity: .15
		});
	}
	const layer = leaflet_shim_default.geoJSON(g, { style: {
		color: c,
		weight: g.properties?.["stroke-width"] || 2,
		opacity: g.properties?.["stroke-opacity"] ?? 1,
		fillOpacity: .15
	} });
	if (g.properties?.arrow && g.geometry.type === "LineString") {
		layer.on("add", function() {
			const coords = g.geometry.coordinates;
			if (coords && coords.length >= 2) {
				const last = coords[coords.length - 1], prev = coords[coords.length - 2];
				const angle = Math.atan2(last[1] - prev[1], last[0] - prev[0]) * 180 / Math.PI;
				const arrow = leaflet_shim_default.marker([last[1], last[0]], { icon: leaflet_shim_default.divIcon({
					className: "arrowhead",
					html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:12px solid ${c};transform:rotate(${angle - 90}deg);"></div>`,
					iconSize: [10, 12],
					iconAnchor: [5, 6]
				}) });
				arrow.addTo(state.map);
				layer._arrowhead = arrow;
			}
		});
		layer.remove = function() {
			if (layer._arrowhead) state.map.removeLayer(layer._arrowhead);
			return leaflet_shim_default.Layer.prototype.remove.call(this);
		};
	}
	return layer;
}
var _metricMode = localStorage.getItem("pins-metric") !== "0";
function persistMetric() {
	localStorage.setItem("pins-metric", _metricMode ? "1" : "0");
}
function toggleMetricMode() {
	_metricMode = !_metricMode;
	persistMetric();
}
function isMetricMode() {
	return _metricMode;
}
function fmt(n, dec) {
	return new Intl.NumberFormat("en", { maximumFractionDigits: dec }).format(n);
}
function fmtDist(m) {
	if (_metricMode) return m >= 1e3 ? `${fmt(m / 1e3, 1)} km` : `${fmt(m, 0)} m`;
	const mi = m / 1609.344;
	const yd = m / .9144;
	return mi >= 1 ? `${fmt(mi, 2)} mi` : `${fmt(yd, 0)} yd`;
}
function fmtArea(sqM) {
	if (_metricMode) return sqM >= 1e6 ? `${fmt(sqM / 1e6, 1)} km²` : `${fmt(sqM, 0)} m²`;
	const sqMi = sqM / 259e4;
	const sqYd = sqM * 1.19599;
	return sqMi >= 1 ? `${fmt(sqMi, 2)} mi²` : `${fmt(sqYd, 0)} yd²`;
}
function toggleLink() {
	return ` <a href="#" class="metric-toggle" style="font-size:10px;color:var(--text-dim);text-decoration:none;white-space:nowrap;">(${_metricMode ? "show 🦶" : "show m"})</a>`;
}
function geomMetrics(g) {
	const json = encodeURIComponent(JSON.stringify(g));
	const tl = toggleLink();
	let html = "";
	if (g.type === "FeatureCollection") {
		const { length: totalM } = JSON.parse(compute_geometry(JSON.stringify(g)));
		if (totalM > 0) html = `<b>${t("length")}:</b> ${fmtDist(totalM)}&nbsp;${tl}`;
	}
	const type = g.geometry?.type;
	if (type === "Point" && g.properties?.radius) {
		const r = g.properties.radius;
		const circ = 2 * Math.PI * r;
		const area = Math.PI * r * r;
		html = `<b>${t("circumference")}:</b> ${fmtDist(circ)}<br><b>${t("diameter")}:</b> ${fmtDist(r * 2)}<br><b>${t("area")}:</b> ${fmtArea(area)}&nbsp;${tl}`;
	} else if (type === "LineString") {
		const { length: totalM } = JSON.parse(compute_geometry(JSON.stringify(g)));
		if (totalM > 0) html = `<b>${t("length")}:</b> ${fmtDist(totalM)}&nbsp;${tl}`;
	} else if (type === "Polygon") {
		const { perimeter: totalM, area } = JSON.parse(compute_geometry(JSON.stringify(g)));
		html = `<b>${t("perimeter")}:</b> ${fmtDist(totalM)}<br><b>${t("area")}:</b> ${fmtArea(area)}&nbsp;${tl}`;
	}
	return html ? `<span class="metrics-box" data-json="${json}">${html}</span>` : "";
}
async function saveDrawing(g, mediaObj, layerId, postedAnonymously = false) {
	if (!state.dek || !state.currentSet) return;
	const gov = {
		anonymous_posting: "forbidden",
		...state.currentCommunity?.governance || {}
	};
	const isAnon = (gov.anonymous_posting === "allowed" || gov.anonymous_posting === "members_only") && postedAnonymously;
	const did = generate_uuid();
	g.id = did;
	const enc = encrypt_geojson(JSON.stringify(g), state.dek);
	const d = {
		drawing_id: did,
		team_id: state.currentSet,
		layer_id: layerId || (state.layers[0] ? state.layers[0].layer_id : null),
		encrypted_geojson: enc.ciphertext,
		nonce: enc.nonce,
		created_at: Date.now()
	};
	if (isAnon) d.posted_anonymously = true;
	else if (state.signingPublicKey) d.author_pubkey = state.signingPublicKey;
	if (mediaObj) d.media = mediaObj;
	await saveDrawing$1(d);
	pushUndo({
		kind: "drawing",
		type: "save",
		drawing: d,
		did
	});
	window._broadcast?.("new_drawing", d);
	await loadDrawings();
	window._addHistory?.(t("drawingAdded"), g.properties?.title || "Untitled");
	playSave();
}
function buildDrawingPopup(g, row, layer, opacity) {
	const title = escapeHtml(g.properties?.title || "Drawing"), n = escapeHtml(g.properties?.note || "");
	const metrics = geomMetrics(g);
	const mins = metrics ? `<div style="margin-top:4px;padding:4px 6px;background:#f0fdf4;border:1px solid #86efac;border-radius:3px;font-size:11px;color:#166534;">${metrics}</div>` : "";
	let mh = "";
	if (row && row.media) try {
		const mt = row.media.type;
		let tag = null;
		if (mt === "image/png" || mt === "image/jpeg" || mt === "image/gif" || mt === "image/webp") tag = "img";
		else if (mt === "video/mp4" || mt === "video/webm") tag = "video";
		if (tag) {
			const dec = decrypt_raw_bytes(row.media.ciphertext, row.media.nonce, state.dek);
			const blob = new Blob([dec], { type: mt });
			const url = URL.createObjectURL(blob);
			if (tag === "img") mh = `<br><img src="${url}" style="max-width:200px;max-height:150px;margin-top:4px;">`;
			else mh = `<br><video src="${url}" controls style="max-width:200px;max-height:150px;margin-top:4px;"></video>`;
		} else mh = `<br><a href="#" class="dwg-attachment" data-did="${escapeHtml(row.drawing_id)}" style="font-size:12px;">${escapeHtml(row.media.name || t("attachment"))}</a>`;
	} catch (e) {
		console.warn("[map]", e.message);
	}
	const did = row ? escapeHtml(row.drawing_id) : "";
	const layerBadge = layer && layer.layer_id ? `<span class="layer-badge" style="border-color:${layer.color};">📑 ${escapeHtml(layer.name)}</span><br>` : "";
	const isAnon = row?.posted_anonymously;
	const isOwner = !isAnon && row?.author_pubkey && row.author_pubkey === state.signingPublicKey;
	const myRole = state.myRole;
	const canModerate = myRole === "maintainer" || myRole === "founder";
	const canEdit = !isAnon && (isOwner || canModerate) && myRole !== "reader";
	const canDelete = !isAnon && (isOwner || canModerate) && myRole !== "reader";
	const anonBadge = isAnon ? `<br><span style="font-size:10px;color:var(--text-muted);">anonymous</span>` : "";
	const editBtns = !canEdit && !canDelete ? "" : `${canEdit ? `<button class="edit-dwg-btn" data-did="${did}" style="margin-top:6px;padding:4px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:12px;">${t("edit")}</button>` : ""}${canDelete ? `<button class="delete-dwg-btn" data-did="${did}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">${t("delete")}</button>` : ""}`;
	return `<b>${title}</b>${anonBadge}<br>${n}${mins}${mh}<br>${layerBadge}${editBtns}`;
}
async function loadDrawings() {
	if (!state.dek || !state.currentSet) return;
	if (state.layers.length === 0) await loadLayersForSet(state.currentSet);
	state.drawingLayers.forEach((l) => state.map.removeLayer(l));
	state.drawingLayers.length = 0;
	const layerMap = new Map(state.layers.map((l) => [l.layer_id, l]));
	const defaultLayer = state.layers[0];
	for (const row of await getDrawings(state.currentSet)) try {
		const g = JSON.parse(decrypt_geojson(row.encrypted_geojson, row.nonce, state.dek));
		const layerId = row.layer_id || (defaultLayer ? defaultLayer.layer_id : null);
		const layer = layerId ? layerMap.get(layerId) : defaultLayer;
		const opacity = layer && layer.visible ? layer.opacity : 0;
		const drawLayer = geoJsonToLayer(g).addTo(state.map);
		drawLayer.setStyle({
			opacity,
			fillOpacity: opacity * .15
		});
		if (row.posted_anonymously) drawLayer.setStyle({
			opacity: Math.max(opacity * .7, .2),
			fillOpacity: Math.max(opacity * .15 * .7, .03)
		});
		state.drawingLayers.push(drawLayer);
		drawLayer._geojson = g;
		drawLayer._row = row;
		drawLayer._layerId = layerId;
		drawLayer._validFrom = row.valid_from !== void 0 ? row.valid_from : null;
		drawLayer._validTo = row.valid_until !== void 0 ? row.valid_until : null;
		drawLayer.bindPopup(buildDrawingPopup(g, row, layer, opacity));
	} catch (e) {
		console.warn("[map]", e.message);
	}
	applyTimeFilter();
}
async function loadChains() {
	if (!state.currentSet) return;
	state.chainLayers.forEach((l) => state.map.removeLayer(l));
	state.chainLayers.length = 0;
	const chains = await getChainsByCommunity(state.currentSet) || [];
	for (const c of chains) try {
		const coords = [];
		for (const pid of c.pin_ids || []) {
			const m = state.markers.find((mk) => mk._pinId === pid);
			if (m) coords.push(m.getLatLng());
		}
		if (coords.length < 2) continue;
		const entries = c.pin_entries || [];
		const pc = {};
		for (const pid of c.pin_ids) {
			const m = state.markers.find((mk) => mk._pinId === pid);
			if (m) pc[pid] = m.getLatLng();
		}
		const group = leaflet_shim_default.featureGroup().addTo(state.map);
		group._chainId = c.chain_id;
		group._chainName = c.name;
		group._chainPinIds = c.pin_ids;
		let segCoords = [];
		for (let i = 0; i < c.pin_ids.length; i++) {
			const pid = c.pin_ids[i];
			if (!pc[pid]) continue;
			if (i > 0) {
				if (entries.find((e) => e.pin_id === c.pin_ids[i - 1])?.branches?.length > 0 && segCoords.length > 0) {
					if (segCoords.length >= 2) leaflet_shim_default.polyline(segCoords, {
						color: "#2563eb",
						weight: 3,
						dashArray: "8 4",
						interactive: false
					}).addTo(group);
					segCoords = [];
				}
			}
			segCoords.push(pc[pid]);
		}
		if (segCoords.length >= 2) leaflet_shim_default.polyline(segCoords, {
			color: "#2563eb",
			weight: 3,
			dashArray: "8 4",
			interactive: false
		}).addTo(group);
		for (const entry of entries) {
			if (!entry.branches?.length) continue;
			const from = pc[entry.pin_id];
			if (!from) continue;
			for (const b of entry.branches) {
				const to = pc[b.next_pin_id];
				if (to) leaflet_shim_default.polyline([from, to], {
					color: "#7c3aed",
					weight: 2,
					dashArray: "4 4",
					interactive: false
				}).addTo(group);
			}
		}
		const isAuthor = c.author_pubkey && c.author_pubkey === state.signingPublicKey;
		group.bindPopup(`<b>${escapeHtml(c.name)}</b><br><span style="font-size:11px;color:var(--text-dim);">${coords.length} pins</span>
        <br><button class="chain-popup-walk" data-cid="${escapeHtml(c.chain_id)}" style="margin-top:4px;padding:3px 10px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:11px;">▶ Walk</button>
        ${isAuthor ? `<button class="chain-popup-edit" data-cid="${escapeHtml(c.chain_id)}" style="margin-top:4px;margin-left:4px;padding:3px 10px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);border-radius:3px;cursor:pointer;font-size:11px;">✏ Edit</button>
        <button class="chain-popup-delete" data-cid="${escapeHtml(c.chain_id)}" style="margin-top:4px;margin-left:4px;padding:3px 10px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">× Delete</button>` : ""}`);
		group.on("popupopen", () => {
			const el = group.getPopup()?.getElement();
			const editBtn = el?.querySelector(".chain-popup-edit");
			const walkBtn = el?.querySelector(".chain-popup-walk");
			const delBtn = el?.querySelector(".chain-popup-delete");
			if (editBtn) editBtn.onclick = () => {
				showNarrativeChainBuilder(c.chain_id);
			};
			if (walkBtn) walkBtn.onclick = () => {
				renderChainStory(c.chain_id);
			};
			if (delBtn) delBtn.onclick = async () => {
				if (!await confirmDialog("Delete this chain?")) return;
				await deleteChain(c.chain_id);
				state.map.removeLayer(group);
				state.chainLayers = state.chainLayers.filter((cl) => cl._chainId !== c.chain_id);
				window._broadcast?.("delete_chain", { chain_id: c.chain_id });
				toast("Chain deleted", "#f97316");
			};
		});
		state.chainLayers.push(group);
	} catch (e) {
		console.warn("[map]", e.message);
	}
}
async function loadSubscribedPins() {
	state.subscribedMarkers.forEach((m) => m.remove());
	state.subscribedMarkers.length = 0;
	state.subscribedDrawingLayers.forEach((l) => state.map.removeLayer(l));
	state.subscribedDrawingLayers.length = 0;
	const subs = await getAllSubscribedLayers();
	if (!subs || subs.length === 0) return;
	state._subscribedCache = state._subscribedCache || /* @__PURE__ */ new Map();
	const fetchedCommunities = /* @__PURE__ */ new Set();
	for (const sub of subs) {
		const dekKey = `${sub.source_community_id}:${sub.source_layer_id}`;
		const dek = state.subscribedDEKs.get(dekKey);
		if (!dek) continue;
		let pins = null;
		if (fetchedCommunities.has(sub.source_community_id)) pins = state._subscribedCache.get(`pins:${sub.source_community_id}`);
		else try {
			pins = await getPins(sub.source_community_id);
			state._subscribedCache.set(`pins:${sub.source_community_id}`, pins);
			fetchedCommunities.add(sub.source_community_id);
		} catch (_) {
			continue;
		}
		if (!pins) continue;
		for (const row of pins) try {
			let pin;
			const cacheKey = `dec:${sub.source_community_id}:${row.pin_id}`;
			const cached = state._subscribedCache.get(cacheKey);
			if (cached && cached.ciphertext === row.ciphertext) pin = cached.pin;
			else {
				pin = decrypt_pin_data(row.ciphertext, row.nonce, dek);
				state._subscribedCache.set(cacheKey, {
					pin,
					ciphertext: row.ciphertext
				});
			}
			pin.pin_id = row.pin_id;
			const marker = leaflet_shim_default.marker([pin.lat, pin.lng], {
				icon: pinIcon(pin.color || "#7c3aed"),
				opacity: .7
			});
			marker._pinTitle = pin.title || "Untitled";
			marker._pinData = pin;
			marker._pinId = row.pin_id;
			marker._pinColor = pin.color || "#7c3aed";
			marker._pinCreatedAt = row.created_at;
			marker._authorPubkey = row.author_pubkey;
			marker._postedAnonymously = row.posted_anonymously;
			marker._sourceCommunityId = sub.source_community_id;
			marker._sourceCommunityName = sub.source_community_name;
			marker._sourceLayerName = sub.source_layer_name;
			marker.bindPopup(`<b>${escapeHtml(pin.title || "Untitled")}</b><br>${escapeHtml((pin.note || "").slice(0, 200))}<br><small style="color:var(--text-dim);">Via ${escapeHtml(sub.source_community_name)} / ${escapeHtml(sub.source_layer_name)}</small>`);
			marker.addTo(state.map);
			state.subscribedMarkers.push(marker);
		} catch (err) {
			console.warn("[loadSubscribed] pin render failed:", err.message);
		}
		try {
			let drawings = state._subscribedCache.get(`drawings:${sub.source_community_id}`);
			if (drawings === void 0) {
				drawings = await getDrawings(sub.source_community_id);
				state._subscribedCache.set(`drawings:${sub.source_community_id}`, drawings);
			}
			if (!drawings) continue;
			for (const row of drawings) try {
				const geo = decrypt_geojson(row.ciphertext, row.nonce, dek);
				if (!geo) continue;
				const drawLayer = leaflet_shim_default.geoJSON(geo, { style: () => ({
					color: "#7c3aed",
					opacity: row.posted_anonymously ? .42 : .6,
					fillOpacity: row.posted_anonymously ? .07 : .1
				}) });
				drawLayer._drawingId = row.drawing_id;
				drawLayer._sourceCommunityId = sub.source_community_id;
				drawLayer._sourceCommunityName = sub.source_community_name;
				drawLayer.addTo(state.map);
				state.subscribedDrawingLayers.push(drawLayer);
			} catch (err) {
				console.warn("[loadSubscribed] drawing render failed:", err.message);
			}
		} catch (e) {
			console.warn("[map]", e.message);
		}
	}
}
async function deleteDrawing(did) {
	const row = (await getDrawings(state.currentSet)).find((d) => d.drawing_id === did);
	if (!canModifyDrawing(row)) {
		window._toast?.("Not authorized to delete this drawing", "#dc2626");
		return;
	}
	if (row) pushUndo({
		kind: "drawing",
		type: "delete",
		drawing: row,
		did
	});
	await deleteDrawing$1(did);
	window._broadcast?.("delete_drawing", { drawing_id: did });
	await loadDrawings();
	window._addHistory?.(t("drawingDeleted"), did.slice(0, 8));
}
function showEditDrawingForm(did) {
	if (!state.dek || !state.currentSet) return;
	getDrawings(state.currentSet).then((drawings) => {
		const row = drawings.find((d) => d.drawing_id === did);
		if (!row) return;
		if (!canModifyDrawing(row)) {
			window._toast?.("Not authorized to edit this drawing", "#dc2626");
			return;
		}
		try {
			const g = JSON.parse(decrypt_geojson(row.encrypted_geojson, row.nonce, state.dek));
			const ov = document.createElement("div");
			ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
			const curColor = g.properties?.color || "#2563eb";
			const curArrow = g.properties?.arrow ? "checked" : "";
			const colorCircles = colorPresetsHTML(COLORS, curColor);
			ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("editDrawing")}</h3><input id="edit-dwg-title" placeholder="${t("title")}" value="${escapeHtml(g.properties?.title || "")}" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;" /><textarea id="edit-dwg-note" placeholder="${t("description")}" rows="3" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;resize:vertical;">${escapeHtml(g.properties?.note || "")}</textarea><div style="margin-bottom:8px;font-size:12px;color:var(--text-dim);">${t("color")}</div><div id="edit-dwg-color-picker" style="display:flex;gap:2px;margin-bottom:8px;flex-wrap:wrap;">${colorCircles}</div><input type="hidden" id="edit-dwg-color" value="${escapeHtml(curColor)}" /><label style="display:flex;align-items:center;gap:4px;font-size:12px;margin-bottom:12px;"><input type="checkbox" id="edit-dwg-arrow" ${curArrow} /> ${t("arrow")}</label><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="edit-dwg-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="edit-dwg-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button></div></div>`;
			document.body.appendChild(ov);
			document.getElementById("edit-dwg-title").focus();
			const clean = () => ov.remove();
			document.getElementById("edit-dwg-cancel").onclick = clean;
			ov.onclick = (e) => {
				if (e.target === ov) clean();
			};
			document.getElementById("edit-dwg-title").addEventListener("keydown", (e) => {
				if (e.key === "Enter") document.getElementById("edit-dwg-save").click();
			});
			const picker = document.getElementById("edit-dwg-color-picker");
			picker.querySelectorAll(".color-preset").forEach((c) => {
				c.onclick = () => {
					document.getElementById("edit-dwg-color").value = c.dataset.color;
					picker.querySelectorAll(".color-preset").forEach((s) => s.style.border = "2px solid transparent");
					c.style.border = "2px solid #111";
				};
			});
			document.getElementById("edit-dwg-save").onclick = async () => {
				const t = document.getElementById("edit-dwg-title").value.trim();
				const n = document.getElementById("edit-dwg-note").value.trim();
				const color = document.getElementById("edit-dwg-color").value;
				const arrow = document.getElementById("edit-dwg-arrow").checked;
				clean();
				await updateDrawing(row, t || "Drawing", n, color, arrow);
				state.map.closePopup();
			};
		} catch (e) {
			console.warn("[map]", e.message);
		}
	}).catch(() => {});
}
async function updateDrawing(row, title, note, color, arrow) {
	if (!state.dek || !state.currentSet) return;
	if (!canModifyDrawing(row)) {
		window._toast?.("Not authorized to edit this drawing", "#dc2626");
		return;
	}
	try {
		const g = JSON.parse(decrypt_geojson(row.encrypted_geojson, row.nonce, state.dek));
		g.properties = g.properties || {};
		g.properties.title = title;
		g.properties.note = note;
		g.properties.color = color;
		g.properties.arrow = arrow;
		const enc = encrypt_geojson(JSON.stringify(g), state.dek);
		row.encrypted_geojson = enc.ciphertext;
		row.nonce = enc.nonce;
		await saveDrawing$1(row);
		window._broadcast?.("new_drawing", row);
		await loadDrawings();
		window._addHistory?.(t("drawingEdited"), title);
	} catch (e) {
		console.warn("[map]", e.message);
	}
}
async function downloadDrawingAttachment(did) {
	if (!state.dek) return;
	try {
		const row = (await getDrawings(state.currentSet)).find((d) => d.drawing_id === did);
		if (!row || !row.media) return;
		const dec = decrypt_raw_bytes(row.media.ciphertext, row.media.nonce, state.dek);
		const blob = new Blob([dec], { type: row.media.type || "application/octet-stream" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = row.media.name || "attachment";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	} catch (e) {
		console.warn("[map]", e.message);
	}
}
function downloadPinMedia(pinId) {
	const m = state.markers.find((mk) => mk._pinId === pinId);
	if (!m) return;
	if (!m._media) {
		window._toast?.("No attachment");
		return;
	}
	if (!state.dek) {
		window._toast?.("Cannot decrypt — no key available");
		return;
	}
	try {
		const r = m._media;
		const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
		const blob = new Blob([dec], { type: r.type || "application/octet-stream" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = r.name || "attachment";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	} catch (_) {
		window._toast?.("Download failed");
	}
}
function addPinButton() {
	if (!window._drawerActive) {
		const searchInput = leaflet_shim_default.DomUtil.create("input");
		searchInput.type = "text";
		searchInput.id = "filter-input";
		searchInput.placeholder = `${t("filterPins")}`;
		searchInput.style.cssText = "position:absolute;top:80px;left:50%;transform:translateX(-50%);z-index:1000;width:200px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:14px;box-shadow:0 1px 5px rgba(0,0,0,0.15);";
		searchInput.oninput = () => {
			const q = searchInput.value.toLowerCase().trim();
			for (let i = 0; i < state.markers.length; i++) {
				const match = !q || state.pinSearchText[i] && state.pinSearchText[i].includes(q);
				state.markers[i].setOpacity(match ? 1 : .15);
			}
		};
		state.map.getContainer().appendChild(searchInput);
		const osmSearch = leaflet_shim_default.DomUtil.create("input");
		osmSearch.type = "text";
		osmSearch.id = "osm-search";
		osmSearch.placeholder = `${t("searchPlaces")}`;
		osmSearch.style.cssText = "position:absolute;top:40px;left:50%;transform:translateX(-50%);z-index:1000;width:200px;padding:6px 8px;border:1px solid #2563eb;border-radius:4px;font-size:14px;box-shadow:0 1px 5px rgba(0,0,0,0.15);";
		let searchTimer;
		let searchAbort = null;
		osmSearch.oninput = () => {
			clearTimeout(searchTimer);
			const q = osmSearch.value.trim();
			if (q.length < 3) return;
			searchTimer = setTimeout(async () => {
				const now = Date.now();
				if (now - (state._nominatimLastCall || 0) < 2e3) return;
				state._nominatimLastCall = now;
				if (searchAbort) searchAbort.abort();
				searchAbort = new AbortController();
				try {
					const data = await (await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en`, { signal: searchAbort.signal })).json();
					if (!data.features || !data.features.length) return;
					const f = data.features[0];
					const extent = f.properties.extent;
					if (extent && extent.length === 4) state.map.fitBounds([[extent[1], extent[0]], [extent[3], extent[2]]]);
					else {
						const [lng, lat] = f.geometry.coordinates;
						state.map.setView([lat, lng], 15);
					}
				} catch (e) {
					if (e.name !== "AbortError") console.warn("[search] failed:", e.message);
				}
			}, 750);
		};
		state.map.getContainer().appendChild(osmSearch);
	}
	if (!window._drawerActive) {
		const btn = leaflet_shim_default.DomUtil.create("button");
		btn.textContent = "📌";
		btn.title = `${t("createPin")}`;
		btn.style.cssText = "position:absolute;top:95px;right:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:6px;background:var(--accent,#2563eb);color:white;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;transition:background 0.15s;";
		btn.onclick = (e) => {
			e.stopPropagation();
			state.placingPin = !state.placingPin;
			btn.textContent = state.placingPin ? "📍" : "📌";
			btn.style.background = state.placingPin ? "var(--accent-active,#1d4ed8)" : "var(--accent,#2563eb)";
			state.map.getContainer().style.cursor = state.placingPin ? "crosshair" : "";
		};
		state.map.getContainer().appendChild(btn);
	}
	if (!window._drawerActive) {
		const fsBtn = leaflet_shim_default.DomUtil.create("button");
		fsBtn.textContent = "⛶";
		fsBtn.title = `${t("fullscreen")}`;
		fsBtn.style.cssText = "position:absolute;top:108px;left:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:18px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
		fsBtn.onclick = () => {
			if (!document.fullscreenElement) document.documentElement.requestFullscreen();
			else document.exitFullscreen();
		};
		if (!window.matchMedia("(display-mode: standalone)").matches) state.map.getContainer().appendChild(fsBtn);
	}
	if (!window._drawerActive) {
		const svBtn = leaflet_shim_default.DomUtil.create("button");
		svBtn.textContent = "🚶";
		svBtn.title = `${t("streetView")}`;
		svBtn.style.cssText = "position:absolute;top:150px;left:8px;z-index:1000;width:32px;height:32px;border:none;border-radius:4px;background:#059669;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
		svBtn.onclick = (e) => {
			e.stopPropagation();
			state.streetViewing = !state.streetViewing;
			svBtn.style.background = state.streetViewing ? "#047857" : "#059669";
			state.map.getContainer().style.cursor = state.streetViewing ? "crosshair" : "";
		};
		state.map.getContainer().appendChild(svBtn);
	}
}
function addFreeDrawButton() {
	initFreeDraw(showDrawingForm);
	addFreeDrawButton$1();
}
function addGridOverlay() {
	let enabled = false;
	let gridLayer = null;
	const btn = leaflet_shim_default.DomUtil.create("button", "leaflet-control");
	btn.textContent = "▦";
	btn.title = "Grid overlay";
	btn.style.cssText = "width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;margin-left:2px;";
	for (const key of Object.keys(state.map._layers || {})) {
		const l = state.map._layers[key];
		if (l._url && l._url.includes("ArcGIS")) break;
	}
	function drawGrid() {
		if (gridLayer) state.map.removeLayer(gridLayer);
		const bounds = state.map.getBounds();
		const zoom = state.map.getZoom();
		let step;
		if (zoom <= 3) step = 10;
		else if (zoom <= 6) step = 5;
		else if (zoom <= 9) step = 1;
		else step = .1;
		const lines = [];
		const isSatellite = document.querySelector(".leaflet-control-layers-selector:checked + span")?.textContent?.toLowerCase().includes("satellite");
		const style = {
			color: isSatellite ? "white" : "var(--text)",
			weight: 1,
			opacity: isSatellite ? .35 : .25,
			dashArray: "6 4",
			interactive: false
		};
		const south = Math.floor(bounds.getSouth() / step) * step;
		const north = Math.ceil(bounds.getNorth() / step) * step;
		for (let lat = south; lat <= north; lat += step) lines.push(leaflet_shim_default.polyline([[lat, bounds.getWest()], [lat, bounds.getEast()]], style));
		const west = Math.floor(bounds.getWest() / step) * step;
		const east = Math.ceil(bounds.getEast() / step) * step;
		for (let lng = west; lng <= east; lng += step) lines.push(leaflet_shim_default.polyline([[bounds.getSouth(), lng], [bounds.getNorth(), lng]], style));
		gridLayer = leaflet_shim_default.layerGroup(lines).addTo(state.map);
	}
	btn.onclick = (e) => {
		e.stopPropagation();
		enabled = !enabled;
		btn.style.background = enabled ? "#4b5563" : "#6b7280";
		if (enabled) {
			drawGrid();
			state.map.on("moveend zoomend baselayerchange", drawGrid);
		} else {
			if (gridLayer) state.map.removeLayer(gridLayer);
			gridLayer = null;
			state.map.off("moveend zoomend baselayerchange", drawGrid);
		}
	};
	const layersCtrl = state.map.getContainer().querySelector(".leaflet-control-layers");
	if (layersCtrl) layersCtrl.after(btn);
	else {
		btn.style.position = "absolute";
		btn.style.top = "62px";
		btn.style.left = "8px";
		state.map.getContainer().appendChild(btn);
	}
}
function addMeasureButton() {
	const btn = leaflet_shim_default.DomUtil.create("button");
	btn.textContent = "📏";
	btn.title = "Measure distance";
	btn.style.cssText = "position:absolute;top:177px;right:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#0891b2;color:white;font-size:18px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
	let pointA = null, measureLayer = null;
	function clearMeasureLayer() {
		if (measureLayer) {
			state.map.removeLayer(measureLayer);
			measureLayer = null;
		}
	}
	btn.onclick = (e) => {
		e.stopPropagation();
		state.measuring = !state.measuring;
		if (state.measuring) {
			btn.style.background = "#0e7490";
			state.map.getContainer().style.cursor = "crosshair";
		} else {
			btn.style.background = "#0891b2";
			state.map.getContainer().style.cursor = "";
			pointA = null;
			clearMeasureLayer();
		}
	};
	state.map.getContainer().appendChild(btn);
	state.map.on("click", (e) => {
		if (!state.measuring || state.freeDrawing) return;
		const ll = e.latlng;
		if (!pointA) {
			pointA = ll;
			clearMeasureLayer();
			const marker = leaflet_shim_default.circleMarker([ll.lat, ll.lng], {
				radius: 5,
				color: "#0891b2",
				fillColor: "#0891b2",
				fillOpacity: .6,
				weight: 2
			}).addTo(state.map);
			measureLayer = leaflet_shim_default.layerGroup([marker]).addTo(state.map);
		} else {
			clearMeasureLayer();
			const markerA = leaflet_shim_default.circleMarker([pointA.lat, pointA.lng], {
				radius: 5,
				color: "#0891b2",
				fillColor: "#0891b2",
				fillOpacity: .6,
				weight: 2
			});
			const markerB = leaflet_shim_default.circleMarker([ll.lat, ll.lng], {
				radius: 5,
				color: "#0891b2",
				fillColor: "#0891b2",
				fillOpacity: .6,
				weight: 2
			});
			const line = leaflet_shim_default.polyline([[pointA.lat, pointA.lng], [ll.lat, ll.lng]], {
				color: "#0891b2",
				weight: 2,
				dashArray: "6 4"
			});
			const dist = pointA.distanceTo(ll);
			const mainUnit = fmtDist(dist);
			const altUnit = _metricMode ? dist >= 1609.344 ? `${fmt(dist / 1609.344, 2)} mi` : `${fmt(dist / .9144, 0)} yd` : dist >= 1e3 ? `${fmt(dist / 1e3, 1)} km` : `${fmt(dist, 0)} m`;
			const label = leaflet_shim_default.divIcon({
				className: "",
				html: `<div style="background:var(--bg-card);color:var(--text);padding:6px 12px;border-radius:8px;font-size:15px;font-weight:700;white-space:nowrap;box-shadow:0 2px 12px rgba(0,0,0,0.25);border:1px solid var(--border);text-align:center;line-height:1.4;">${mainUnit}<br><span style="font-size:11px;font-weight:400;color:var(--text-dim);">${altUnit}</span></div>`,
				iconSize: [140, 52],
				iconAnchor: [70, 26]
			});
			const mid = leaflet_shim_default.latLng((pointA.lat + ll.lat) / 2, (pointA.lng + ll.lng) / 2);
			const labelMarker = leaflet_shim_default.marker(mid, { icon: label });
			measureLayer = leaflet_shim_default.layerGroup([
				markerA,
				markerB,
				line,
				labelMarker
			]).addTo(state.map);
			pointA = null;
		}
	});
}
function applyTimeFilter() {
	const hasFilter = state.timeFrom !== null || state.timeTo !== null;
	const hasTrustFilter = state.minTrustScore !== null && state.minTrustScore !== void 0;
	const now = (/* @__PURE__ */ new Date()).getFullYear();
	for (const m of state.markers) {
		let visible = true;
		if (hasFilter) {
			const pf = m._validFrom, pt = m._validTo;
			if (pf !== null || pt !== null) if (pf !== null && pt !== null && pf >= 1 && pf <= 12 && pt >= 1 && pt <= 12) {
				const tf = state.timeFrom ?? state.timeTo ?? now - 10;
				const tt = state.timeTo ?? state.timeFrom ?? now + 10;
				let yearVisible = false;
				for (let y = tf; y <= tt; y++) {
					let seasonStart = y + (pf <= pt ? 0 : -1);
					let seasonEnd = y + (pf <= pt ? 0 : 1);
					if (seasonStart <= tt && seasonEnd >= tf) yearVisible = true;
				}
				visible = yearVisible;
			} else visible = (state.timeFrom === null || pt === null || pt >= state.timeFrom) && (state.timeTo === null || pf === null || pf <= state.timeTo);
		}
		if (hasTrustFilter && visible) {
			if (m._pinTrustLevel !== null) {
				if ((m._pinTrustScore ?? 0) < state.minTrustScore) visible = false;
			}
		}
		m.setOpacity(visible ? m._layerOpacity || 1 : 0);
	}
	for (const dl of state.drawingLayers) {
		let visible = true;
		if (hasFilter) {
			const pf = dl._validFrom, pt = dl._validTo;
			if (pf !== null || pt !== null) if (pf !== null && pt !== null && pf >= 1 && pf <= 12 && pt >= 1 && pt <= 12) {
				const tf = state.timeFrom ?? state.timeTo ?? now - 10;
				const tt = state.timeTo ?? state.timeFrom ?? now + 10;
				let yearVisible = false;
				for (let y = tf; y <= tt; y++) {
					yearVisible = true;
					break;
				}
				visible = yearVisible;
			} else visible = (state.timeFrom === null || pt === null || pt >= state.timeFrom) && (state.timeTo === null || pf === null || pf <= state.timeTo);
		}
		dl.setStyle({
			opacity: visible ? 1 : 0,
			fillOpacity: visible ? .15 : 0,
			transition: "opacity 0.3s ease"
		});
	}
}
function readTimeInputs() {
	const fromEl = document.getElementById("time-from");
	const toEl = document.getElementById("time-to");
	state.timeFrom = fromEl?.value ? parseInt(fromEl.value, 10) : null;
	state.timeTo = toEl?.value ? parseInt(toEl.value, 10) : null;
}
function addTimeSlider() {
	const btn = leaflet_shim_default.DomUtil.create("button");
	btn.textContent = "⏳";
	btn.title = "Time filter";
	btn.style.cssText = "position:absolute;top:290px;left:3px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
	state.map.getContainer().appendChild(btn);
	const container = leaflet_shim_default.DomUtil.create("div");
	container.id = "time-slider";
	container.style.cssText = "display:none;position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:1000;align-items:center;gap:8px;padding:6px 12px;background:var(--bg-glass);backdrop-filter:blur(4px);border-radius:6px;box-shadow:0 1px 5px var(--shadow);font-size:12px;white-space:nowrap;";
	container.innerHTML = `
    <span style="color:var(--text-dim);">⏳</span>
    <input id="time-from" type="number" placeholder="-∞" style="width:70px;padding:3px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;text-align:center;" />
    <span style="color:var(--text-dim);">–</span>
    <input id="time-to" type="number" placeholder="∞" style="width:70px;padding:3px 4px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;text-align:center;" />
    <button id="time-reset" style="padding:3px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;">reset</button>
    <button id="time-apply" style="padding:3px 8px;border:none;background:#2563eb;color:white;border-radius:3px;cursor:pointer;font-size:11px;">apply</button>
  `;
	state.map.getContainer().appendChild(container);
	let visible = false;
	btn.onclick = (e) => {
		e.stopPropagation();
		visible = !visible;
		container.style.display = visible ? "flex" : "none";
		btn.style.background = visible ? "#4b5563" : "#6b7280";
		if (visible) {
			if (state.timeFrom) document.getElementById("time-from").value = state.timeFrom;
			if (state.timeTo) document.getElementById("time-to").value = state.timeTo;
		} else {
			state.timeFrom = null;
			state.timeTo = null;
			document.getElementById("time-from").value = "";
			document.getElementById("time-to").value = "";
			applyTimeFilter();
		}
	};
	document.getElementById("time-reset").onclick = () => {
		document.getElementById("time-from").value = "";
		document.getElementById("time-to").value = "";
		state.timeFrom = null;
		state.timeTo = null;
		applyTimeFilter();
	};
	document.getElementById("time-apply").onclick = () => {
		readTimeInputs();
		applyTimeFilter();
	};
	document.getElementById("time-from").addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			readTimeInputs();
			applyTimeFilter();
		}
	});
	document.getElementById("time-to").addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			readTimeInputs();
			applyTimeFilter();
		}
	});
}
function generateLocationMarker(lat, lng, communityId) {
	const c = state.currentCommunity;
	if (!c) {
		toast("No community active", "#dc2626");
		return;
	}
	const nameBytes = new TextEncoder().encode(c.name || "");
	const cidBytes = hexToBytes((communityId || state.currentSet || "").replace(/-/g, ""));
	const relayUrl = c.relay_url || "";
	const relayBytes = relayUrl ? new TextEncoder().encode(relayUrl) : new Uint8Array(0);
	const flags = c.password_hash ? 1 : 0;
	const focusStr = `${lat.toFixed(6)},${lng.toFixed(6)}`;
	const focusBytes = new TextEncoder().encode(focusStr);
	const total = 1 + nameBytes.length + 16 + 1 + relayBytes.length + 1 + focusBytes.length;
	console.log("[gen-loc] encoding: total=", total, "nameLen=", nameBytes.length, "relayLen=", relayBytes.length, "focusLen=", focusBytes.length, "focusStr=", focusStr);
	const buf = new Uint8Array(total);
	let pos = 0;
	buf[pos++] = nameBytes.length;
	buf.set(nameBytes, pos);
	pos += nameBytes.length;
	buf.set(cidBytes, pos);
	pos += 16;
	buf[pos++] = relayBytes.length;
	if (relayBytes.length > 0) buf.set(relayBytes, pos);
	pos += relayBytes.length;
	buf[pos++] = flags;
	if (focusBytes.length > 0) buf.set(focusBytes, pos);
	const b64 = base64url_encode(buf);
	const link = window.location.origin + window.location.pathname + "#community=" + b64;
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div style="background:white;padding:24px;border-radius:8px;max-width:360px;width:90%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <h3 style="margin:0 0 8px;color:#111;">📍 Location Marker</h3>
    <p style="font-size:12px;color:#666;margin:0 0 12px;">Community: <b>${escapeHtml(c.name)}</b><br>Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}</p>
    <div id="loc-qr" style="margin-bottom:12px;"></div>
    <p style="font-size:10px;color:#888;margin:0 0 8px;">Print this and place it at the location. Scanning opens the community map centered here.</p>
    <button id="loc-print" style="padding:8px 16px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:13px;">Print</button>
    <button id="loc-close" style="padding:8px 16px;border:1px solid #ccc;background:white;border-radius:4px;cursor:pointer;font-size:13px;margin-left:8px;">Close</button>
  </div>`;
	document.body.appendChild(ov);
	document.getElementById("loc-close").onclick = () => ov.remove();
	ov.onclick = (e) => {
		if (e.target === ov) ov.remove();
	};
	import("./e2e_core.js").then((mod) => {
		const qrSvg = mod.generate_qr_svg(link);
		document.getElementById("loc-qr").innerHTML = qrSvg || "<p style='color:#dc2626;'>QR generation failed</p>";
	}).catch(() => {});
	document.getElementById("loc-print").onclick = () => {
		const w = window.open("", "_blank", "width=400,height=500");
		if (w) {
			w.document.body.innerHTML = ov.querySelector("div").innerHTML;
			w.document.body.style.cssText = "text-align:center;font-family:sans-serif;padding:20px;";
			w.print();
		}
	};
}
function addChainTool() {
	const btn = leaflet_shim_default.DomUtil.create("button");
	btn.textContent = "🔗";
	btn.title = "Pin Chains";
	btn.style.cssText = "position:absolute;top:362px;left:3px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
	state.map.getContainer().appendChild(btn);
	btn.onclick = () => showChainsModal();
}
async function showChainsModal() {
	const chains = await getChainsByCommunity(state.currentSet) || [];
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-width:420px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:80vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">🔗 Chains</h3>
      <button id="chain-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
    <div id="chain-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;">${chains.length > 0 ? chains.map((c) => {
		const cl = state.chainLayers.find((cl) => cl._chainId === c.chain_id);
		const visible = cl ? cl._visible !== false : true;
		const eyeIcon = visible ? "👁" : "–";
		const isAuthor = c.author_pubkey && c.author_pubkey === state.signingPublicKey;
		return `<div style="padding:8px;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:13px;">${escapeHtml(c.name)} <span style="font-size:10px;color:var(--text-dim);">${(c.pin_ids || []).length} pins</span></span>
          <div style="display:flex;align-items:center;gap:6px;">
            ${isAuthor ? `<button class="chain-edit-btn" data-cid="${escapeHtml(c.chain_id)}" style="padding:3px 6px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:12px;" title="Edit">✏</button>` : ""}
            <button class="chain-eye-btn" data-cid="${escapeHtml(c.chain_id)}" style="padding:3px 7px;border:1px solid var(--border);background:var(--bg-card);border-radius:3px;cursor:pointer;font-size:12px;${visible ? "color:#16a34a;" : "color:var(--text-dim);"}">${eyeIcon}</button>
            <button class="chain-walk-btn" data-cid="${escapeHtml(c.chain_id)}" style="padding:3px 8px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:3px;cursor:pointer;font-size:11px;">▶ Walk</button>
            ${isAuthor ? `<button class="chain-del-btn" data-cid="${escapeHtml(c.chain_id)}" style="padding:3px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:13px;line-height:1;">×</button>` : ""}
          </div>
        </div>`;
	}).join("") : "<div style=\"padding:12px;color:var(--text-dim);text-align:center;\">No chains yet</div>"}</div>
    <button id="chain-new-btn" style="margin-top:8px;width:100%;padding:8px;border:1px dashed #2563eb;background:transparent;color:#2563eb;border-radius:4px;cursor:pointer;font-size:13px;">+ New Chain</button>
  </div>`;
	document.body.appendChild(ov);
	document.getElementById("chain-close").onclick = () => ov.remove();
	ov.onclick = (e) => {
		if (e.target === ov) ov.remove();
	};
	document.querySelectorAll(".chain-eye-btn").forEach((b) => {
		b.onclick = async (e) => {
			e.stopPropagation();
			const cl = state.chainLayers.find((cl) => cl._chainId === b.dataset.cid);
			if (cl) {
				cl._visible = !(cl._visible !== false);
				if (cl._visible !== false) state.map.addLayer(cl);
				else state.map.removeLayer(cl);
			}
			(await getChainsByCommunity(state.currentSet) || []).find((c) => c.chain_id === b.dataset.cid);
			const visible = cl ? cl._visible !== false : true;
			b.textContent = visible ? "👁" : "–";
			b.style.color = visible ? "#16a34a" : "var(--text-dim)";
		};
	});
	document.querySelectorAll(".chain-edit-btn").forEach((b) => {
		b.onclick = async (e) => {
			e.stopPropagation();
			ov.remove();
			showNarrativeChainBuilder(b.dataset.cid);
		};
	});
	document.querySelectorAll(".chain-walk-btn").forEach((b) => {
		b.onclick = async (e) => {
			e.stopPropagation();
			ov.remove();
			renderChainStory(b.dataset.cid);
		};
	});
	document.querySelectorAll(".chain-del-btn").forEach((b) => {
		b.onclick = async (e) => {
			e.stopPropagation();
			if (!await confirmDialog("Delete this chain? Pins are not affected.")) return;
			await deleteChain(b.dataset.cid);
			window._broadcast?.("delete_chain", { chain_id: b.dataset.cid });
			const cl = state.chainLayers.find((cl) => cl._chainId === b.dataset.cid);
			if (cl) {
				state.map.removeLayer(cl);
				state.chainLayers = state.chainLayers.filter((cl2) => cl2._chainId !== b.dataset.cid);
			}
			ov.remove();
			showChainsModal();
			toast("Chain deleted", "#f97316");
		};
	});
	document.getElementById("chain-new-btn").onclick = async () => {
		ov.remove();
		showNarrativeChainBuilder();
	};
}
function showNotificationsModal() {
	const notifications = state.notifications || [];
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:340px;max-width:440px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-height:75vh;display:flex;flex-direction:column;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">🔔 Notifications</h3>
      <div style="display:flex;align-items:center;gap:8px;">
        <button id="notif-clear" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:11px;">Clear</button>
        <button id="notif-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
      </div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-light);margin-bottom:8px;font-size:12px;color:var(--text-dim);cursor:pointer;">
      <input type="checkbox" id="notif-push-toggle" style="accent-color:#2563eb;cursor:pointer;">
      Push notifications (kept intentionally vague)
    </label>
    <div id="notif-list" style="flex:1;overflow-y:auto;border:1px solid var(--border-light);border-radius:4px;min-height:40px;">${notifications.length > 0 ? notifications.map((n) => {
		const icon = {
			comment: "💬",
			reply: "↩",
			vote: "▲",
			pin_added: "📌"
		}[n.type] || "💬";
		const action = {
			comment: "commented on",
			reply: "replied to your comment on",
			vote: "voted on your comment on",
			pin_added: "new pin"
		}[n.type] || "updated";
		n.read;
		return `<div ${n.read ? "class='notif-row'" : "class='notif-row' style='border-left:3px solid #2563eb;'"} data-nid="${escapeHtml(n.id)}" data-pid="${escapeHtml(n.pin_id)}">
            <div style="display:flex;gap:8px;align-items:flex-start;">
              <span style="font-size:16px;flex-shrink:0;">${icon}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;"><b>${escapeHtml(n.by_name)}</b> ${action} ${escapeHtml(n.pin_title)}</div>
                ${n.text_preview ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">"${escapeHtml(n.text_preview)}"</div>` : ""}
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${relativeTime(n.created_at)}</div>
              </div>
            </div>
          </div>`;
	}).join("") : "<div style=\"padding:16px;color:var(--text-dim);text-align:center;\">No notifications</div>"}</div>
  </div>`;
	document.body.appendChild(ov);
	document.getElementById("notif-close").onclick = () => ov.remove();
	ov.onclick = (e) => {
		if (e.target === ov) ov.remove();
	};
	document.getElementById("notif-clear").onclick = () => {
		state.notifications = [];
		ov.remove();
		showNotificationsModal();
	};
	const pushToggle = document.getElementById("notif-push-toggle");
	if (pushToggle) {
		pushToggle.checked = window._isPushEnabled?.() || false;
		pushToggle.onchange = async () => {
			await window._togglePush?.();
			pushToggle.checked = window._isPushEnabled?.() || false;
		};
	}
	for (const n of state.notifications) n.read = true;
	window._renderUI?.();
	ov.querySelectorAll("[data-nid]").forEach((row) => {
		row.onclick = async () => {
			const pid = row.dataset.pid;
			if (pid && state.map) {
				const m = state.markers.find((mk) => mk._pinId === pid);
				if (m) {
					state.map.flyTo(m.getLatLng(), 15, { duration: 1 });
					setTimeout(() => showPinDetailModal(pid), 800);
				}
			}
			ov.remove();
		};
	});
}
var _cbPins = [], _cbNarratives = {};
var _cbBranches = {};
var _cbSelMarkers = [], _cbClickBindings = [];
var _cbPreviewPoly = null;
var _cbBranchPreviewPolys = [];
var _cbPanel = null;
var _cbMinimized = false;
var _cbEditChainId = null;
var _cbConnectFrom = null;
function showNarrativeChainBuilder(chainId) {
	if (!state.map || !state.currentSet) return;
	_cbEditChainId = chainId || null;
	_cbPins = [];
	_cbNarratives = {};
	_cbBranches = {};
	_cbSelMarkers = [];
	_cbClickBindings = [];
	_cbPreviewPoly = null;
	_cbBranchPreviewPolys = [];
	_cbMinimized = false;
	_cbConnectFrom = null;
	const isEditing = !!chainId;
	const title = isEditing ? "🔗 Edit Chain" : "🔗 New Chain";
	const saveLabel = isEditing ? "Update Chain" : "Save Chain";
	const panel = document.createElement("div");
	panel.id = "chain-builder-panel";
	panel.innerHTML = `<div class="cb-header">
    <h3 style="margin:0;font-size:14px;">${title}</h3>
    <div style="display:flex;align-items:center;gap:4px;">
      <button id="cb-minimize" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1;padding:0 4px;" title="Minimize">⊟</button>
      <button id="cb-close" style="background:none;border:none;font-size:20px;cursor:pointer;color:#9ca3af;line-height:1;">×</button>
    </div>
  </div>
  <div id="cb-mini-bar">
    <span>🔗 <span id="cb-mini-name">${title}</span> · <span id="cb-mini-count">0</span> pins</span>
    <div style="display:flex;align-items:center;gap:6px;">
      <button id="cb-expand" style="padding:4px 10px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:4px;cursor:pointer;font-size:12px;">⊞ Expand</button>
      <button id="cb-mini-cancel" style="padding:4px 10px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;">Cancel</button>
    </div>
  </div>
  <div class="cb-body">
    <input id="cb-name" placeholder="Chain name" autocomplete="off" />
    <textarea id="cb-desc" placeholder="Describe the story this chain tells…" rows="3"></textarea>
    <input id="cb-tags" placeholder="Tags (comma-separated)" autocomplete="off" />
    <div class="cb-section-title">Waypoints</div>
    <div id="cb-waypoints"></div>
    <div id="cb-empty-msg" style="padding:12px;color:var(--text-dim);text-align:center;font-size:11px;">Click any pin on the map to add it to the chain</div>
  </div>
  <div class="cb-footer">
    <button id="cb-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;">Cancel</button>
    <button id="cb-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:12px;">${saveLabel}</button>
  </div>`;
	document.body.appendChild(panel);
	_cbPanel = panel;
	enterChainPinSelect();
	renderChainWaypoints();
	if (isEditing) getChain(chainId).then((chain) => {
		if (!chain || !_cbPanel) return;
		document.getElementById("cb-name").value = chain.name || "";
		document.getElementById("cb-desc").value = chain.description || "";
		document.getElementById("cb-tags").value = (chain.tags || []).join(", ");
		if (chain.pin_entries) {
			_cbPins = [];
			for (const entry of chain.pin_entries) {
				if (!_cbPins.includes(entry.pin_id)) _cbPins.push(entry.pin_id);
				_cbNarratives[entry.pin_id] = entry.narrative || "";
				_cbBranches[entry.pin_id] = (entry.branches || []).map((b) => ({
					label: b.label || "",
					next_pin_id: b.next_pin_id || ""
				}));
			}
			for (const pid of _cbPins) {
				const m = state.markers.find((mk) => mk._pinId === pid);
				if (m) {
					const ring = leaflet_shim_default.circleMarker(m.getLatLng(), {
						radius: 16,
						color: "#2563eb",
						fillColor: "transparent",
						weight: 3,
						interactive: false
					}).addTo(state.map);
					_cbSelMarkers.push(ring);
				}
			}
			renderChainWaypoints();
		}
	});
	const closeBuilder = () => {
		exitChainPinSelect();
		panel.remove();
		_cbPanel = null;
	};
	document.getElementById("cb-close").onclick = closeBuilder;
	document.getElementById("cb-cancel").onclick = closeBuilder;
	document.getElementById("cb-mini-cancel").onclick = closeBuilder;
	document.addEventListener("keydown", function onEsc(e) {
		if (e.key === "Escape") {
			if (_cbConnectFrom) {
				cancelConnectMode();
				return;
			}
			closeBuilder();
			document.removeEventListener("keydown", onEsc);
		}
	});
	document.getElementById("cb-minimize").onclick = () => toggleChainBuilderMinimize();
	document.getElementById("cb-expand").onclick = () => toggleChainBuilderMinimize();
	document.getElementById("cb-save").onclick = async () => {
		const name = document.getElementById("cb-name").value.trim();
		const desc = document.getElementById("cb-desc").value.trim();
		const tagsRaw = document.getElementById("cb-tags").value.trim();
		if (!name) {
			toast("Enter a chain name", "#f97316");
			return;
		}
		if (_cbPins.length < 2) {
			toast("Select at least 2 pins", "#f97316");
			return;
		}
		const now = Date.now();
		const chain = {
			chain_id: _cbEditChainId || generate_uuid(),
			community_id: state.currentSet,
			name,
			description: desc,
			cover_pin_id: null,
			author_pubkey: state.signingPublicKey || "",
			author_display_name: state.displayName || "Me",
			tags: tagsRaw ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
			pin_entries: _cbPins.map((pid) => {
				const filtered = (_cbBranches[pid] || []).filter((b) => b && b.label && b.label.trim() && b.next_pin_id);
				return {
					pin_id: pid,
					narrative: _cbNarratives[pid] || "",
					audio_ciphertext: null,
					audio_nonce: null,
					audio_type: null,
					branches: filtered
				};
			}),
			pin_ids: [..._cbPins],
			created_at: _cbEditChainId ? void 0 : now,
			updated_at: now
		};
		if (_cbEditChainId) {
			const existing = await getChain(_cbEditChainId);
			if (existing && existing.author_pubkey && existing.author_pubkey !== state.signingPublicKey) {
				toast("Only the chain author can edit", "#dc2626");
				return;
			}
			if (existing) chain.created_at = existing.created_at;
		}
		await saveChain(chain);
		window._broadcast?.("new_chain", chain);
		exitChainPinSelect();
		panel.remove();
		_cbPanel = null;
		await loadChains();
		toast(_cbEditChainId ? "Chain updated: " + name : "Chain saved: " + name, "#16a34a");
	};
}
function toggleChainBuilderMinimize() {
	if (!_cbPanel) return;
	_cbMinimized = !_cbMinimized;
	_cbPanel.classList.toggle("cb-minimized", _cbMinimized);
	if (_cbMinimized) {
		const name = document.getElementById("cb-name")?.value?.trim() || "New Chain";
		document.getElementById("cb-mini-name").textContent = name;
		document.getElementById("cb-mini-count").textContent = _cbPins.length;
	}
}
function enterChainPinSelect() {
	for (const mk of state.markers) {
		const handler = (e) => {
			leaflet_shim_default.DomEvent.stop(e);
			if (!mk._pinId) return;
			if (_cbConnectFrom) {
				if (mk._pinId === _cbConnectFrom) {
					cancelConnectMode();
					return;
				}
				if (!_cbPins.includes(mk._pinId)) return;
				if (!_cbBranches[_cbConnectFrom]) _cbBranches[_cbConnectFrom] = [];
				if (!_cbBranches[_cbConnectFrom].some((b) => b.next_pin_id === mk._pinId)) _cbBranches[_cbConnectFrom].push({
					label: "",
					next_pin_id: mk._pinId
				});
				cancelConnectMode();
				renderChainWaypoints();
				return;
			}
			if (_cbPins.includes(mk._pinId)) return;
			_cbPins.push(mk._pinId);
			_cbNarratives[mk._pinId] = _cbNarratives[mk._pinId] || "";
			_cbBranches[mk._pinId] = _cbBranches[mk._pinId] || [];
			const ring = leaflet_shim_default.circleMarker(mk.getLatLng(), {
				radius: 16,
				color: "#2563eb",
				fillColor: "transparent",
				weight: 3,
				interactive: false
			}).addTo(state.map);
			_cbSelMarkers.push(ring);
			renderChainWaypoints();
		};
		mk.on("click", handler);
		_cbClickBindings.push({
			mk,
			handler
		});
	}
	state.map.getContainer().style.cursor = "crosshair";
}
function enterConnectMode(sourcePid) {
	_cbConnectFrom = sourcePid;
	renderChainWaypoints();
}
function cancelConnectMode() {
	_cbConnectFrom = null;
	renderChainWaypoints();
}
function exitChainPinSelect() {
	state.map.getContainer().style.cursor = "";
	for (const { mk, handler } of _cbClickBindings) mk.off("click", handler);
	_cbClickBindings.length = 0;
	for (const r of _cbSelMarkers) state.map.removeLayer(r);
	_cbSelMarkers.length = 0;
	if (_cbPreviewPoly) {
		state.map.removeLayer(_cbPreviewPoly);
		_cbPreviewPoly = null;
	}
	for (const bp of _cbBranchPreviewPolys) state.map.removeLayer(bp);
	_cbBranchPreviewPolys.length = 0;
}
function updateChainPreview() {
	if (_cbPreviewPoly) {
		state.map.removeLayer(_cbPreviewPoly);
		_cbPreviewPoly = null;
	}
	for (const bp of _cbBranchPreviewPolys) state.map.removeLayer(bp);
	_cbBranchPreviewPolys.length = 0;
	if (_cbPins.length < 2) return;
	const pc = {};
	for (const pid of _cbPins) {
		const m = state.markers.find((mk) => mk._pinId === pid);
		if (m) pc[pid] = m.getLatLng();
	}
	let segCoords = [];
	for (let i = 0; i < _cbPins.length; i++) {
		if (!pc[_cbPins[i]]) continue;
		if (i > 0) {
			if (_cbBranches[_cbPins[i - 1]]?.length > 0 && segCoords.length > 0) {
				if (segCoords.length >= 2) {
					const bp = leaflet_shim_default.polyline(segCoords, {
						color: "#2563eb",
						weight: 3,
						dashArray: "8 4",
						interactive: false
					}).addTo(state.map);
					_cbBranchPreviewPolys.push(bp);
				}
				segCoords = [];
			}
		}
		segCoords.push(pc[_cbPins[i]]);
	}
	if (segCoords.length >= 2) {
		const bp = leaflet_shim_default.polyline(segCoords, {
			color: "#2563eb",
			weight: 3,
			dashArray: "8 4",
			interactive: false
		}).addTo(state.map);
		_cbBranchPreviewPolys.push(bp);
		_cbPreviewPoly = bp;
	}
	for (const pid of _cbPins) {
		const branches = _cbBranches[pid];
		if (!branches?.length) continue;
		const from = pc[pid];
		if (!from) continue;
		for (const b of branches) {
			if (!b.next_pin_id) continue;
			const to = pc[b.next_pin_id];
			if (!to) continue;
			const bp = leaflet_shim_default.polyline([from, to], {
				color: "#7c3aed",
				weight: 2,
				dashArray: "4 4",
				interactive: false
			}).addTo(state.map);
			_cbBranchPreviewPolys.push(bp);
		}
	}
}
function renderChainWaypoints() {
	if (!_cbPanel) return;
	const list = _cbPanel.querySelector("#cb-waypoints");
	const empty = _cbPanel.querySelector("#cb-empty-msg");
	if (!list) return;
	if (_cbPins.length === 0) {
		list.innerHTML = "";
		if (empty) empty.style.display = "block";
		updateChainPreview();
		return;
	}
	if (empty) empty.style.display = "none";
	list.innerHTML = _cbPins.map((pid, i) => {
		const m = state.markers.find((mk) => mk._pinId === pid);
		const title = m ? m._pinTitle || m._pinData?.title || "Untitled" : "[deleted]";
		const narrative = _cbNarratives[pid] || "";
		const first = i === 0, last = i === _cbPins.length - 1;
		const branches = _cbBranches[pid] || [];
		const isConnectSource = _cbConnectFrom === pid;
		const otherPids = _cbPins.filter((p) => p !== pid);
		const branchRows = branches.map((b, bi) => {
			const targetPid = b.next_pin_id;
			const targetIdx = _cbPins.indexOf(targetPid);
			const tm = state.markers.find((mk) => mk._pinId === targetPid);
			const tTitle = tm ? tm._pinTitle || tm._pinData?.title || "Untitled" : "[deleted]";
			const targetLabel = targetIdx >= 0 ? `#${targetIdx + 1} ${escapeHtml(tTitle.slice(0, 20))}` : "[deleted]";
			return `<div class="cb-branch-row" style="display:flex;align-items:center;gap:4px;margin-top:3px;">
        <span style="font-size:11px;color:#7c3aed;flex-shrink:0;">→</span>
        <span style="font-size:11px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${targetIdx < 0 ? "color:#dc2626;" : ""}">${targetLabel}</span>
        <button data-br-rm="${pid}" data-br-idx="${bi}" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:13px;padding:0 2px;line-height:1;flex-shrink:0;" title="Remove branch">×</button>
      </div>`;
		}).join("");
		const connectHighlight = isConnectSource ? "border-color:#7c3aed;box-shadow:0 0 0 1px #7c3aed;" : "";
		const connectLabel = isConnectSource ? " <span style=\"font-size:10px;color:#7c3aed;font-weight:600;\">(click target)</span>" : "";
		return `<div class="cb-waypoint" style="${connectHighlight}">
      <div class="wp-header">
        <span class="wp-pin-title">${i + 1}. ${escapeHtml(title)}${connectLabel}</span>
        <div class="wp-actions">
          <button data-wp-up="${pid}" ${first ? "disabled style='visibility:hidden;'" : ""}>▲</button>
          <button data-wp-down="${pid}" ${last ? "disabled style='visibility:hidden;'" : ""}>▼</button>
          <button data-wp-rm="${pid}" class="wp-remove">×</button>
        </div>
      </div>
      <textarea data-wp-narr="${pid}" placeholder="Narrative for this waypoint…" rows="2">${escapeHtml(narrative)}</textarea>
      <div class="cb-branches" style="margin-top:6px;border-top:1px solid var(--border-light);padding-top:4px;">
        ${branchRows || `<div style="font-size:10px;color:var(--text-muted);">no destinations</div>`}
        ${otherPids.length > 0 ? `<button data-br-connect="${pid}" style="margin-top:4px;padding:3px 8px;border:1px solid #7c3aed;background:transparent;color:#7c3aed;border-radius:3px;cursor:pointer;font-size:11px;${isConnectSource ? "background:#7c3aed;color:white;" : ""}">${isConnectSource ? "✓ Done / Cancel" : "⊕ Connect to pin"}</button>` : ""}
      </div>
    </div>`;
	}).join("");
	list.querySelectorAll("[data-wp-up]").forEach((btn) => {
		btn.onclick = () => {
			const pid = btn.dataset.wpUp;
			const idx = _cbPins.indexOf(pid);
			if (idx > 0) {
				[_cbPins[idx], _cbPins[idx - 1]] = [_cbPins[idx - 1], _cbPins[idx]];
				renderChainWaypoints();
			}
		};
	});
	list.querySelectorAll("[data-wp-down]").forEach((btn) => {
		btn.onclick = () => {
			const pid = btn.dataset.wpDown;
			const idx = _cbPins.indexOf(pid);
			if (idx >= 0 && idx < _cbPins.length - 1) {
				[_cbPins[idx], _cbPins[idx + 1]] = [_cbPins[idx + 1], _cbPins[idx]];
				renderChainWaypoints();
			}
		};
	});
	list.querySelectorAll("[data-wp-rm]").forEach((btn) => {
		btn.onclick = () => {
			const pid = btn.dataset.wpRm;
			_cbPins = _cbPins.filter((p) => p !== pid);
			delete _cbNarratives[pid];
			delete _cbBranches[pid];
			for (const otherPid of _cbPins) if (_cbBranches[otherPid]) _cbBranches[otherPid] = _cbBranches[otherPid].filter((b) => b.next_pin_id !== pid);
			const ringIdx = _cbSelMarkers.findIndex((r) => {
				const m = state.markers.find((mk) => mk._pinId === pid);
				return m && r.getLatLng().equals(m.getLatLng());
			});
			if (ringIdx >= 0) {
				state.map.removeLayer(_cbSelMarkers[ringIdx]);
				_cbSelMarkers.splice(ringIdx, 1);
			}
			renderChainWaypoints();
		};
	});
	list.querySelectorAll("[data-wp-narr]").forEach((ta) => {
		const pid = ta.dataset.wpNarr;
		ta.oninput = () => {
			_cbNarratives[pid] = ta.value;
		};
	});
	list.querySelectorAll("[data-br-connect]").forEach((btn) => {
		btn.onclick = () => {
			const pid = btn.dataset.brConnect;
			if (_cbConnectFrom === pid) cancelConnectMode();
			else enterConnectMode(pid);
		};
	});
	list.querySelectorAll("[data-br-rm]").forEach((btn) => {
		btn.onclick = () => {
			const pid = btn.dataset.brRm;
			const idx = parseInt(btn.dataset.brIdx, 10);
			if (_cbBranches[pid]) {
				_cbBranches[pid].splice(idx, 1);
				renderChainWaypoints();
			}
		};
	});
	if (_cbConnectFrom) {
		const srcIdx = _cbPins.indexOf(_cbConnectFrom);
		const srcM = state.markers.find((mk) => mk._pinId === _cbConnectFrom);
		const srcTitle = srcM ? srcM._pinTitle || "Untitled" : "source";
		const banner = document.createElement("div");
		banner.id = "cb-connect-banner";
		banner.style.cssText = "padding:6px 8px;margin-bottom:6px;background:rgba(124,58,237,0.1);border:1px solid #7c3aed;border-radius:4px;font-size:11px;color:#7c3aed;text-align:center;";
		banner.textContent = `⊕ Connecting from #${srcIdx + 1} ${escapeHtml(srcTitle)} — click a target pin on the map`;
		list.insertBefore(banner, list.firstChild);
	}
	if (_cbMinimized && _cbPanel) {
		const countEl = _cbPanel.querySelector("#cb-mini-count");
		if (countEl) countEl.textContent = _cbPins.length;
	}
	updateChainPreview();
}
async function renderChainStory(chainId) {
	const chain = await getChain(chainId);
	if (!chain || !chain.pin_entries?.length) return;
	const validEntries = [];
	const coords = [];
	for (const entry of chain.pin_entries) {
		const m = state.markers.find((mk) => mk._pinId === entry.pin_id);
		if (m) {
			validEntries.push(entry);
			coords.push(m.getLatLng());
		}
	}
	if (coords.length < 2) return;
	const pinCoordMap = {};
	validEntries.forEach((e) => {
		const m = state.markers.find((mk) => mk._pinId === e.pin_id);
		if (m) pinCoordMap[e.pin_id] = m.getLatLng();
	});
	const storyGroup = leaflet_shim_default.featureGroup().addTo(state.map);
	let segCoords = [];
	for (let i = 0; i < validEntries.length; i++) {
		const coord = pinCoordMap[validEntries[i].pin_id];
		if (!coord) continue;
		if (i > 0) {
			if (validEntries[i - 1].branches?.length > 0 && segCoords.length > 0) {
				if (segCoords.length >= 2) leaflet_shim_default.polyline(segCoords, {
					color: "#2563eb",
					weight: 3,
					dashArray: "8 4",
					interactive: false
				}).addTo(storyGroup);
				segCoords = [];
			}
		}
		segCoords.push(coord);
	}
	if (segCoords.length >= 2) leaflet_shim_default.polyline(segCoords, {
		color: "#2563eb",
		weight: 3,
		dashArray: "8 4",
		interactive: false
	}).addTo(storyGroup);
	for (const entry of validEntries) {
		if (!entry.branches?.length) continue;
		const from = pinCoordMap[entry.pin_id];
		if (!from) continue;
		for (const b of entry.branches) {
			const to = pinCoordMap[b.next_pin_id];
			if (to) leaflet_shim_default.polyline([from, to], {
				color: "#7c3aed",
				weight: 2,
				dashArray: "4 4",
				interactive: false
			}).addTo(storyGroup);
		}
	}
	const waypointMarkers = [];
	validEntries.forEach((entry, i) => {
		const m = state.markers.find((mk) => mk._pinId === entry.pin_id);
		if (!m) return;
		const numIcon = leaflet_shim_default.divIcon({
			className: "chain-waypoint-marker",
			html: `<span>${i + 1}</span>`,
			iconSize: [24, 24],
			iconAnchor: [12, 12]
		});
		const wm = leaflet_shim_default.marker(m.getLatLng(), {
			icon: numIcon,
			interactive: false
		}).addTo(state.map);
		waypointMarkers.push(wm);
	});
	const highlightWaypoint = (idx) => {
		waypointMarkers.forEach((wm, i) => {
			const el = wm.getElement();
			if (!el) return;
			const span = el.querySelector("span");
			if (!span) return;
			span.style.background = i === idx ? "#2563eb" : "#6b7280";
			span.style.transform = i === idx ? "scale(1.3)" : "scale(1)";
			span.style.transition = "transform 0.15s, background 0.15s";
		});
	};
	state.map.fitBounds(storyGroup.getBounds().pad(.1));
	const pinIndexMap = {};
	validEntries.forEach((e, i) => {
		pinIndexMap[e.pin_id] = i;
	});
	const renderCard = (index, pid, marker) => {
		highlightWaypoint(index);
		const entry = validEntries.find((e) => e.pin_id === pid);
		const narrative = entry?.narrative || "";
		const pinData = marker._pinData || {};
		const pinTitle = marker._pinTitle || pinData.title || "Untitled";
		const pinNote = pinData.note || "";
		const tags = chain.tags || [];
		const branches = entry?.branches || [];
		let mediaHtml = "";
		const r = marker._media;
		if (r && state.dek) try {
			const dec = decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
			const mt = r.type || "";
			const blob = new Blob([dec], { type: mt });
			const url = URL.createObjectURL(blob);
			if (mt.startsWith("image/")) mediaHtml = `<img src="${url}" style="max-width:100%;max-height:25vh;border-radius:6px;margin-top:8px;">`;
			else if (mt.startsWith("video/")) mediaHtml = `<video src="${url}" controls style="max-width:100%;max-height:25vh;border-radius:6px;margin-top:8px;"></video>`;
			else if (mt.startsWith("audio/")) mediaHtml = `<audio src="${url}" controls style="width:100%;margin-top:8px;"></audio>`;
		} catch (e) {
			console.warn("[map]", e.message);
		}
		let branchHtml = "";
		const validBranches = branches.filter((b) => b.label && b.next_pin_id && pinIndexMap[b.next_pin_id] !== void 0);
		if (validBranches.length > 0) branchHtml = `<div style="border-top:1px solid var(--border-light);padding-top:8px;margin-top:8px;">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Choose your path:</div>
        ${validBranches.map((b) => `<button class="chain-branch-btn" data-jump="${pinIndexMap[b.next_pin_id]}" style="display:block;width:100%;padding:6px 10px;margin-bottom:4px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:4px;cursor:pointer;font-size:12px;text-align:left;">▶ ${escapeHtml(b.label)}</button>`).join("")}
      </div>`;
		const tagLine = tags.length ? ` · ${escapeHtml(tags.join(", "))}` : "";
		const narrativeBlock = narrative ? `<div style="font-size:14px;line-height:1.5;margin-bottom:10px;white-space:pre-wrap;">${escapeHtml(narrative)}</div>` : "";
		const hasSecondary = pinTitle || pinNote || mediaHtml;
		const html = `<div style="padding:4px 0;">
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">
        Stop ${index + 1} of ${validEntries.length}${tagLine}
      </div>
      ${narrativeBlock}
      ${hasSecondary ? `<div style="border-top:1px solid var(--border-light);padding-top:8px;margin-top:8px;">
        ${pinTitle ? `<div style="font-size:12px;font-weight:600;">📌 ${escapeHtml(pinTitle)}</div>` : ""}
        ${pinNote ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${escapeHtml(pinNote)}</div>` : ""}
        ${mediaHtml}
      </div>` : ""}
      ${branchHtml}
    </div>`;
		setTimeout(() => {
			const card = document.getElementById("slideshow-card");
			if (!card) return;
			card.querySelectorAll(".chain-branch-btn").forEach((btn) => {
				btn.onclick = () => {
					const jumpIdx = parseInt(btn.dataset.jump, 10);
					if (window._slideshowGoTo) window._slideshowGoTo(jumpIdx);
				};
			});
		}, 0);
		return html;
	};
	const onExit = () => {
		state.map.removeLayer(storyGroup);
		waypointMarkers.forEach((wm) => state.map.removeLayer(wm));
	};
	startSlideshow(validEntries.map((e) => e.pin_id), {
		cardRenderer: renderCard,
		onExit,
		autoPlay: false,
		speed: 7e3,
		loop: false
	});
}
function addSelectionTool() {
	let selecting = false, lassoMode = false, selStart = null, selRect = null, selPoly = null;
	let selectedPins = [], selectedDrawings = [], selBar = null;
	const btn = leaflet_shim_default.DomUtil.create("button");
	btn.textContent = "⊞";
	btn.title = "Select (right-click for lasso)";
	btn.style.cssText = "position:absolute;top:214px;right:8px;z-index:1000;width:36px;height:36px;border:none;border-radius:4px;background:#6b7280;color:white;font-size:16px;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;";
	function clearSelLayer() {
		if (selRect) {
			state.map.removeLayer(selRect);
			selRect = null;
		}
		if (selPoly) {
			state.map.removeLayer(selPoly);
			selPoly = null;
		}
	}
	function clearSelection() {
		selectedPins.forEach((m) => {
			const icon = m._icon;
			if (icon) icon.style.filter = "";
		});
		selectedDrawings.forEach((l) => {
			l.setStyle({ color: l._origColor || l.options?.color || "#2563eb" });
		});
		selectedPins = [];
		selectedDrawings = [];
		if (selBar) {
			selBar.remove();
			selBar = null;
		}
		clearSelLayer();
	}
	function showSelBar() {
		if (selBar) selBar.remove();
		const total = selectedPins.length + selectedDrawings.length;
		if (total === 0) return;
		selBar = document.createElement("div");
		selBar.style.cssText = "position:absolute;top:214px;right:48px;z-index:1001;display:flex;gap:4px;";
		const delBtn = document.createElement("button");
		delBtn.textContent = `${t("delete")} (${total})`;
		delBtn.style.cssText = "height:28px;border:none;border-radius:4px;background:#dc2626;color:white;cursor:pointer;font-size:12px;font-weight:600;padding:0 8px;white-space:nowrap;";
		delBtn.onclick = async () => {
			for (const m of selectedPins) if (canDeletePin(m)) await deletePin(m._pinId);
			for (const l of selectedDrawings) await deleteDrawing(l._drawingId || l._row?.drawing_id);
			clearSelection();
			selecting = false;
			btn.style.background = "#6b7280";
			state.map.getContainer().style.cursor = "";
		};
		selBar.appendChild(delBtn);
		state.map.getContainer().appendChild(selBar);
	}
	function selectionForBounds(bounds) {
		clearSelection();
		const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
		_selectMarkers(sw.lat, sw.lng, ne.lat, ne.lng, (m) => bounds.contains(m.getLatLng()));
		state.drawingLayers.forEach((l) => {
			try {
				const lb = l.getBounds();
				if (lb && bounds.intersects(lb)) {
					selectedDrawings.push(l);
					l._origColor = l.options?.color || l._origColor;
					l.setStyle({
						color: "#2563eb",
						weight: (l.options?.weight || 2) + 1
					});
				}
			} catch (e) {
				console.warn("[map]", e.message);
			}
		});
		if (selectedPins.length + selectedDrawings.length > 0) showSelBar();
	}
	function selectionForPoly(latlngs) {
		clearSelection();
		const polyArr = latlngs.map((ll) => [ll.lng, ll.lat]);
		let sw_lat = Infinity, sw_lng = Infinity, ne_lat = -Infinity, ne_lng = -Infinity;
		for (const [lng, lat] of polyArr) {
			if (lat < sw_lat) sw_lat = lat;
			if (lat > ne_lat) ne_lat = lat;
			if (lng < sw_lng) sw_lng = lng;
			if (lng > ne_lng) ne_lng = lng;
		}
		_selectMarkers(sw_lat, sw_lng, ne_lat, ne_lng, (m) => {
			const ll = m.getLatLng();
			return pointInPolygon([ll.lng, ll.lat], polyArr);
		});
		state.drawingLayers.forEach((l) => {
			try {
				const lb = l.getBounds();
				if (lb) {
					const c = lb.getCenter();
					if (pointInPolygon([c.lng, c.lat], polyArr)) {
						selectedDrawings.push(l);
						l._origColor = l.options?.color || l._origColor;
						l.setStyle({
							color: "#2563eb",
							weight: (l.options?.weight || 2) + 1
						});
					}
				}
			} catch (e) {
				console.warn("[map]", e.message);
			}
		});
		if (selectedPins.length + selectedDrawings.length > 0) showSelBar();
	}
	function _selectMarkers(sw_lat, sw_lng, ne_lat, ne_lng, testFn) {
		const idx = window._spatialIdx;
		if (idx) try {
			const pinIds = idx.queryBbox(sw_lat, sw_lng, ne_lat, ne_lng);
			for (const pid of pinIds) {
				const m = state._markerMap?.get(pid);
				if (m && testFn(m)) {
					selectedPins.push(m);
					const icon = m._icon;
					if (icon) icon.style.filter = "drop-shadow(0 0 4px #2563eb) brightness(1.2)";
				}
			}
			return;
		} catch (_) {}
		state.markers.forEach((m) => {
			if (testFn(m)) {
				selectedPins.push(m);
				const icon = m._icon;
				if (icon) icon.style.filter = "drop-shadow(0 0 4px #2563eb) brightness(1.2)";
			}
		});
	}
	function pointInPolygon(point, polygon) {
		let inside = false;
		for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) if (polygon[i][1] > point[1] !== polygon[j][1] > point[1] && point[0] < (polygon[j][0] - polygon[i][0]) * (point[1] - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0]) inside = !inside;
		return inside;
	}
	btn.onclick = (e) => {
		e.stopPropagation();
		selecting = !selecting;
		btn.style.background = selecting ? "#4b5563" : "#6b7280";
		state.map.getContainer().style.cursor = selecting ? "crosshair" : "";
		if (selecting) state.map.dragging.disable();
		else {
			state.map.dragging.enable();
			clearSelection();
		}
	};
	btn.oncontextmenu = (e) => {
		e.preventDefault();
		e.stopPropagation();
		lassoMode = !lassoMode;
		btn.textContent = lassoMode ? "◌" : "⊞";
		if (!selecting) btn.click();
	};
	state.map.getContainer().appendChild(btn);
	state.map.getContainer().addEventListener("pointerdown", (e) => {
		if (!selecting) return;
		if (e.target.closest("button")) return;
		if (e.target.closest("#free-draw-toolbar")) return;
		e.preventDefault();
		e.stopPropagation();
		const rc = state.map.getContainer().getBoundingClientRect();
		selStart = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
		if (lassoMode) selPoly = leaflet_shim_default.polyline([[selStart.lat, selStart.lng]], {
			color: "#2563eb",
			weight: 1.5,
			dashArray: "4 4"
		}).addTo(state.map);
	});
	state.map.getContainer().addEventListener("pointermove", (e) => {
		if (!selecting || !selStart) return;
		const rc = state.map.getContainer().getBoundingClientRect();
		const curr = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
		if (lassoMode && selPoly) {
			const ll = selPoly.getLatLngs();
			ll.push([curr.lat, curr.lng]);
			selPoly.setLatLngs(ll);
		} else if (!lassoMode) {
			clearSelLayer();
			selRect = leaflet_shim_default.rectangle(leaflet_shim_default.latLngBounds(selStart, curr), {
				color: "#2563eb",
				weight: 1.5,
				dashArray: "4 4",
				fillOpacity: .08
			}).addTo(state.map);
		}
	});
	state.map.getContainer().addEventListener("pointerup", (e) => {
		if (!selecting || !selStart) return;
		const rc = state.map.getContainer().getBoundingClientRect();
		const curr = state.map.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
		if (lassoMode && selPoly) {
			const ll = selPoly.getLatLngs();
			if (ll.length > 3) selectionForPoly(ll);
			clearSelLayer();
		} else if (!lassoMode) {
			if (selStart.distanceTo(curr) > 5) selectionForBounds(leaflet_shim_default.latLngBounds(selStart, curr));
			clearSelLayer();
		}
		selStart = null;
	});
}
async function renderAnnotationThread(pinId, threadEl) {
	if (!state.dek) return;
	const threads = threadEl ? [threadEl] : document.querySelectorAll(`[data-pin-id="${pinId}"]`);
	if (threads.length === 0) return;
	const annotations = await getAnnotationsByPin(pinId, 0, 100);
	const tombstones = await getTombstoneTargetIds(annotations.map((a) => a.annotation_id));
	const visible = annotations.filter((a) => !tombstones.has(a.annotation_id));
	let html = "<div class=\"ann-thread-header\">Comments</div>";
	if (visible.length === 0) html += "<div style=\"color:var(--text-dim);font-size:11px;padding:4px 0;\">No comments yet</div>";
	const annMap = {};
	for (const a of visible) annMap[a.annotation_id] = a;
	const topLevel = visible.filter((a) => !a.parent_id);
	const replies = {};
	for (const a of visible) if (a.parent_id) {
		replies[a.parent_id] = replies[a.parent_id] || [];
		replies[a.parent_id].push(a);
	}
	function renderAnn(ann, depth) {
		try {
			const dec = decrypt_annotation(ann.ciphertext, ann.nonce, state.dek);
			const text = dec.text || "";
			const authorName = dec.author_name || "anon";
			const annType = dec.annotation_type || "comment";
			const ttl = dec.ttl;
			const votes = ann.votes || [];
			const scoreColor = trustScoreColor(state.signingPublicKey ? computeAnnotationScore(ann, state.signingPublicKey) : 0);
			const upvotesRaw = votes.filter((v) => v.direction === "up").length;
			const downvotesRaw = votes.filter((v) => v.direction === "down").length;
			const typeIcon = {
				comment: "💬",
				update: "🔄",
				dispute: "⚠️",
				flag: "🚩",
				death_mark: "💀",
				story: "📖"
			}[annType] || "💬";
			const typeClass = annType === "death_mark" ? "ann-death" : annType === "dispute" ? "ann-dispute" : "";
			const ttlLabel = ttl ? ` · expires ${relativeTime(Date.now() - ttl * 1e3)}` : "";
			const indent = depth > 0 ? `margin-left:${Math.min(depth * 16, 64)}px;border-left:2px solid var(--border-light);padding-left:8px;` : "";
			let mediaHtml = "";
			if (ann.media && state.dek) try {
				const decMedia = decrypt_raw_bytes(ann.media.ciphertext, ann.media.nonce, state.dek);
				const mt = ann.media.type || "";
				const blob = new Blob([decMedia], { type: mt });
				const url = URL.createObjectURL(blob);
				if (mt.startsWith("image/")) mediaHtml = `<img src="${url}" class="ann-media-img">`;
				else if (mt.startsWith("video/")) mediaHtml = `<video src="${url}" controls class="ann-media-vid"></video>`;
				else if (mt.startsWith("audio/")) mediaHtml = `<audio src="${url}" controls class="ann-media-aud"></audio>`;
			} catch (e) {
				console.warn("[map]", e.message);
			}
			let h = `<div class="ann-item ${typeClass}" data-ann-id="${escapeHtml(ann.annotation_id)}" style="${indent}">
        <div class="ann-meta">
          <span class="ann-author">${escapeHtml(authorName)}</span>
          <span class="ann-type-icon">${typeIcon}</span>
          <span class="ann-time">${relativeTime(ann.created_at)}</span>
          ${ttlLabel ? `<span class="ann-ttl">${ttlLabel}</span>` : ""}
        </div>
        <div class="ann-text">${escapeHtml(text)}</div>
        ${mediaHtml}
        <div class="ann-actions">
          <button class="ann-vote-btn ann-up" data-ann-id="${escapeHtml(ann.annotation_id)}">▲ <span class="ann-up-count">${upvotesRaw}</span></button>
          <span class="ann-score" style="font-size:11px;color:${scoreColor};font-weight:600;min-width:28px;text-align:center;">${upvotesRaw - downvotesRaw > 0 ? "+" : ""}${upvotesRaw - downvotesRaw}</span>
          <button class="ann-vote-btn ann-down" data-ann-id="${escapeHtml(ann.annotation_id)}">▼ <span class="ann-down-count">${downvotesRaw}</span></button>
          <button class="ann-reply-btn" data-ann-id="${escapeHtml(ann.annotation_id)}" style="padding:1px 6px;border:1px solid var(--border);background:var(--bg-input);border-radius:3px;cursor:pointer;font-size:11px;color:var(--text-dim);">↩ Reply</button>
          ${ann.author_pubkey === state.signingPublicKey ? `<button class="ann-delete-btn" data-ann-id="${escapeHtml(ann.annotation_id)}">×</button>` : ""}
        </div>
      </div>`;
			const childReplies = replies[ann.annotation_id] || [];
			for (const child of childReplies) h += renderAnn(child, depth + 1);
			return h;
		} catch (_) {
			return "<div class=\"ann-item ann-encrypted\" style=\"opacity:0.4;font-size:11px;color:var(--text-dim);\">🔒 encrypted annotation</div>";
		}
	}
	for (const ann of topLevel) html += renderAnn(ann, 0);
	html += `<div class="ann-form">
    <textarea class="ann-input" placeholder="Add a comment..." rows="2"></textarea>
    <button class="ann-submit-btn">Post</button>
    <input type="file" class="ann-file-input" accept="image/*,video/*,audio/*" style="display:none;" />
    <button class="ann-attach-btn" title="Attach media" style="padding:4px 8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;flex-shrink:0;">📎</button>
    <span class="ann-file-name" style="display:none;font-size:10px;color:var(--text-dim);align-self:center;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
  </div>`;
	for (const el of threads) el.innerHTML = html;
}
function refreshPinPopup(pinId) {
	if (!pinId) return;
	const marker = state.markers.find((m) => m._pinId === pinId);
	if (marker && marker.isPopupOpen && marker.isPopupOpen()) renderAnnotationThread(pinId);
}
function addWatermark() {
	const el = document.createElement("a");
	el.href = window.location.origin + window.location.pathname;
	el.target = "_blank";
	el.id = "piggpin-watermark";
	el.textContent = "piggPin";
	el.title = "Made with piggPin";
	state.map.getContainer().appendChild(el);
}
function reverseGeocode(lat, lng) {
	if (!navigator.onLine) return Promise.resolve(null);
	const now = Date.now();
	if (now - (state._nominatimLastCall || 0) < 2e3) return Promise.resolve(null);
	state._nominatimLastCall = now;
	const url = `https://photon.komoot.io/reverse/?lat=${lat}&lon=${lng}&limit=1&lang=en`;
	return fetch(url, { headers: { "User-Agent": "piggPin/0.0.1" } }).then((r) => r.json()).then((data) => {
		if (!data.features || !data.features.length) return null;
		const p = data.features[0].properties;
		return p.name || [
			p.street,
			p.housenumber,
			p.city,
			p.country
		].filter(Boolean).join(", ") || null;
	}).catch(() => null);
}
function showOSMContextMenu(lat, lng, x, y) {
	const menu = document.createElement("div");
	menu.id = "map-context-menu";
	menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:4000;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);padding:4px;min-width:190px;`;
	menu.innerHTML = `
    <button class="ctx-edit-osm" style="display:flex;align-items:center;gap:6px;width:100%;padding:6px 10px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:3px;">&#x1F310; Edit in OpenStreetMap</button>
    <button class="ctx-note-osm" style="display:flex;align-items:center;gap:6px;width:100%;padding:6px 10px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:3px;">&#x1F4DD; Report a problem</button>
    <button class="ctx-route-here" style="display:flex;align-items:center;gap:6px;width:100%;padding:6px 10px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:3px;">&#x1F6E3; Route</button>
    <hr style="margin:4px 0;border-color:var(--border);">
    <button class="ctx-pin-here" style="display:flex;align-items:center;gap:6px;width:100%;padding:6px 10px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:3px;">&#x1F4CC; Place pin here</button>
  `;
	document.body.appendChild(menu);
	menu.querySelector(".ctx-edit-osm").onclick = () => {
		window.open(`https://www.openstreetmap.org/edit?editor=id#map=18/${lat}/${lng}`, "_blank");
		menu.remove();
	};
	menu.querySelector(".ctx-note-osm").onclick = () => {
		if (localStorage.getItem("pins-osm-proxy")) showCreateNoteDialog(lat, lng);
		else window.open(`https://www.openstreetmap.org/note/new#map=18/${lat}/${lng}`, "_blank");
		menu.remove();
	};
	menu.querySelector(".ctx-route-here").onclick = () => {
		import("./map-routing.js").then((r) => {
			if (!r.isRoutingActive()) r.toggleRouting();
			r.addWaypoint(lat, lng);
		});
		menu.remove();
	};
	menu.querySelector(".ctx-pin-here").onclick = () => {
		state.placingPin = true;
		state.map.getContainer().style.cursor = "crosshair";
		showPinForm(lat, lng);
		menu.remove();
	};
	setTimeout(() => {
		const close = (ev) => {
			if (!menu.contains(ev.target)) {
				menu.remove();
				document.removeEventListener("click", close);
			}
		};
		document.addEventListener("click", close);
	}, 0);
}
var MAP_STYLES = [
	{
		url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
		label: "CARTO Positron (Light)"
	},
	{
		url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
		label: "CARTO Dark Matter (Dark)"
	},
	{
		url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
		label: "CARTO Voyager (Natural)"
	}
];
function showStylePicker() {
	const existing = document.getElementById("style-picker-menu");
	if (existing) {
		existing.remove();
		return;
	}
	const current = localStorage.getItem("pins-maplibre-style") || MAP_STYLES[0].url;
	const isCustom = current && !MAP_STYLES.some((s) => s.url === current);
	const menu = document.createElement("div");
	menu.id = "style-picker-menu";
	menu.style.cssText = "position:fixed;top:150px;left:12px;z-index:4000;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);padding:4px;min-width:220px;";
	menu.innerHTML = `<div style="padding:4px 10px;font-size:12px;font-weight:600;color:var(--text-dim);border-bottom:1px solid var(--border);margin-bottom:4px;">\u{1F3A8} Map Style</div>${MAP_STYLES.map((s) => {
		const active = s.url === current && !isCustom;
		return `<button class="style-pick" data-url="${s.url}" style="display:block;width:100%;padding:5px 10px;border:none;background:${active ? "var(--bg-input)" : "transparent"};color:var(--text);cursor:pointer;font-size:12px;text-align:left;border-radius:3px;">${active ? "◉" : "○"} ${s.label}</button>`;
	}).join("")}<hr style="margin:4px 0;border-color:var(--border);"><button class="style-pick" data-url="__custom__" style="display:block;width:100%;padding:5px 10px;border:none;background:${isCustom ? "var(--bg-input)" : "transparent"};color:var(--text);cursor:pointer;font-size:12px;text-align:left;border-radius:3px;">${isCustom ? "◉" : "○"} Custom URL...</button>`;
	document.body.appendChild(menu);
	menu.querySelectorAll(".style-pick").forEach((btn) => {
		btn.onclick = () => {
			let url = btn.dataset.url;
			if (url === "__custom__") {
				url = prompt("Enter MapLibre style URL:", current);
				if (!url) return;
			}
			localStorage.setItem("pins-maplibre-style", url);
			menu.remove();
			const mlMap = window._mlMap;
			if (mlMap && mlMap.setStyle) {
				mlMap.setStyle(url);
				toast("Style updated", "#16a34a");
			} else {
				const t = toast("Style saved — refresh and switch to the Vector layer to apply<br><b>Click to refresh</b>", "#f97316", 1e4);
				t.style.cursor = "pointer";
				t.onclick = () => location.reload();
			}
		};
	});
	setTimeout(() => {
		const close = (ev) => {
			if (!menu.contains(ev.target)) {
				menu.remove();
				document.removeEventListener("click", close);
			}
		};
		document.addEventListener("click", close);
	}, 0);
}
async function showCollectionPicker(pinId, teamId) {
	if (!pinId) return;
	const collections = await getCollections();
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div style="background:var(--bg-card);padding:12px;border-radius:8px;min-width:240px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <div style="font-weight:600;font-size:13px;margin-bottom:8px;">Add to Collection</div>
    <div style="max-height:200px;overflow-y:auto;margin-bottom:8px;">${collections.length > 0 ? collections.map((c) => `<button class="coll-item" data-cid="${c.collection_id}" style="display:block;width:100%;padding:6px 10px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:3px;">📁 ${escapeHtml(c.name)}</button>`).join("") : `<div style="text-align:center;color:var(--text-dim);padding:12px;font-size:12px;">No collections yet</div>`}</div>
    <button id="coll-new" style="display:block;width:100%;padding:6px;border:1px dashed var(--border);background:transparent;color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;">+ New Collection</button>
    <div id="coll-new-form" style="display:none;margin-top:4px;gap:4px;">
      <input id="coll-new-name" placeholder="Collection name" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:3px;font-size:12px;background:var(--bg-input);color:var(--text);" />
      <button id="coll-new-create" style="padding:4px 8px;border:none;background:#2563eb;color:white;border-radius:3px;cursor:pointer;font-size:11px;">Create</button>
    </div>
    <button id="coll-close" style="display:block;width:100%;padding:6px;margin-top:4px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;">Cancel</button>
  </div>`;
	document.body.appendChild(ov);
	const clean = () => ov.remove();
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	document.getElementById("coll-close").onclick = clean;
	ov.querySelectorAll(".coll-item").forEach((btn) => {
		btn.onclick = async () => {
			await addPinToCollection(btn.dataset.cid, pinId, teamId);
			toast("Added to collection", "#16a34a");
			clean();
		};
	});
	document.getElementById("coll-new").onclick = () => {
		document.getElementById("coll-new").style.display = "none";
		const form = document.getElementById("coll-new-form");
		form.style.display = "flex";
		document.getElementById("coll-new-name").focus();
	};
	document.getElementById("coll-new-create").onclick = () => {
		const name = document.getElementById("coll-new-name").value.trim();
		if (!name) {
			toast("Please enter a collection name", "#dc2626");
			return;
		}
		clean();
		const cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
		saveCollection({
			collection_id: cid,
			name,
			created_at: Date.now()
		}).then(() => {
			addPinToCollection(cid, pinId, teamId).then(() => {
				toast(`Added to "${name}"`, "#16a34a");
			});
		});
	};
	document.getElementById("coll-new-name").addEventListener("keydown", (e) => {
		if (e.key === "Enter") document.getElementById("coll-new-create").click();
	});
}
function showCollectionsModal() {
	const existing = document.getElementById("collections-modal");
	if (existing) {
		existing.remove();
		return;
	}
	const ov = document.createElement("div");
	ov.id = "collections-modal";
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
	getCollections().then((collections) => {
		ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:340px;max-width:420px;max-height:70vh;box-shadow:0 4px 20px rgba(0,0,0,0.3);display:flex;flex-direction:column;">
      <h3 style="margin:0 0 8px;">📁 Collections</h3>
      <div style="overflow-y:auto;flex:1;">${collections.length === 0 ? `<div style="text-align:center;color:var(--text-dim);padding:20px;">No collections yet. Use 📁 Collect on any pin to start one.</div>` : collections.map((c) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);">
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13px;">📁 ${escapeHtml(c.name)}</div>
          <div style="font-size:11px;color:var(--text-dim);">${new Date(c.created_at).toLocaleDateString()}</div>
        </div>
        <button class="coll-view-btn" data-cid="${c.collection_id}" style="padding:3px 8px;border:1px solid #2563eb;color:#2563eb;background:transparent;border-radius:3px;cursor:pointer;font-size:11px;">View</button>
        <button class="coll-delete-btn" data-cid="${c.collection_id}" style="padding:3px 8px;border:1px solid #dc2626;color:#dc2626;background:transparent;border-radius:3px;cursor:pointer;font-size:11px;">×</button>
      </div>`).join("")}</div>
      <button id="coll-mgr-close" style="display:block;width:100%;padding:7px;margin-top:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:13px;">Close</button>
    </div>`;
		document.body.appendChild(ov);
		const clean = () => ov.remove();
		ov.onclick = (e) => {
			if (e.target === ov) clean();
		};
		document.getElementById("coll-mgr-close").onclick = clean;
		ov.querySelectorAll(".coll-delete-btn").forEach((btn) => {
			btn.onclick = async () => {
				await deleteCollection(btn.dataset.cid);
				clean();
				showCollectionsModal();
			};
		});
		ov.querySelectorAll(".coll-view-btn").forEach((btn) => {
			btn.onclick = (e) => {
				e.stopPropagation();
				const cid = btn.dataset.cid;
				const existing = document.getElementById("coll-view-sub");
				if (existing) existing.remove();
				const sub = document.createElement("div");
				sub.id = "coll-view-sub";
				sub.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3100;display:flex;align-items:center;justify-content:center;";
				sub.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:260px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
          <div style="font-weight:600;font-size:14px;margin-bottom:10px;">View Collection</div>
          <button id="coll-overlay" style="display:block;width:100%;padding:8px;margin-bottom:6px;border:1px solid #eab308;background:transparent;color:#eab308;border-radius:4px;cursor:pointer;font-size:13px;">📍 Overlay on current map</button>
          <button id="coll-import" style="display:block;width:100%;padding:8px;margin-bottom:6px;border:1px solid #16a34a;background:transparent;color:#16a34a;border-radius:4px;cursor:pointer;font-size:13px;">🗺 Create as new map</button>
          <button id="coll-sub-close" style="display:block;width:100%;padding:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;">Cancel</button>
        </div>`;
				document.body.appendChild(sub);
				const sclean = () => sub.remove();
				sub.onclick = (ev) => {
					if (ev.target === sub) sclean();
				};
				document.getElementById("coll-sub-close").onclick = sclean;
				document.getElementById("coll-overlay").onclick = () => {
					sclean();
					viewCollectionPins(cid);
				};
				document.getElementById("coll-import").onclick = () => {
					sclean();
					importCollectionAsMap(cid);
				};
			};
		});
	});
}
function closeCollectionView() {
	if (_collectionMarkers) {
		_collectionMarkers.forEach((m) => state.map.removeLayer(m));
		_collectionMarkers = null;
	}
	if (_collectionBanner) {
		_collectionBanner.remove();
		_collectionBanner = null;
	}
}
async function viewCollectionPins(collectionId) {
	closeCollectionView();
	const pins = await getCollectionPins(collectionId);
	if (!pins.length) {
		toast("No pins in collection", "#f97316");
		return;
	}
	const coll = (await getCollections()).find((c) => c.collection_id === collectionId);
	_collectionBanner = document.createElement("div");
	_collectionBanner.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:1005;padding:6px 14px;background:var(--bg-glass);backdrop-filter:blur(4px);border:1px solid #eab308;border-radius:20px;font-size:13px;display:flex;align-items:center;gap:8px;white-space:nowrap;color:var(--text);box-shadow:0 2px 8px rgba(0,0,0,0.15);";
	_collectionBanner.innerHTML = `\u{1F4C1} ${escapeHtml(coll?.name || "Collection")} \u2014 ${pins.length} pin${pins.length !== 1 ? "s" : ""} <button id="coll-view-close" style="border:none;background:none;cursor:pointer;font-size:16px;padding:0 2px;color:var(--text-dim);line-height:1;">\u2715</button>`;
	state.map.getContainer().appendChild(_collectionBanner);
	document.getElementById("coll-view-close").onclick = closeCollectionView;
	_collectionMarkers = [];
	let loaded = 0;
	for (const cp of pins) try {
		const team = await getTeam(cp.team_id);
		if (!team) continue;
		const dk = unwrap_dek(team.wrapped_dek, team.secret_key);
		const pin = decrypt_pin_data(cp.ciphertext, cp.nonce, dk);
		const marker = leaflet_shim_default.marker([pin.lat, pin.lng], {
			icon: pinIcon(pin.color || "#eab308"),
			opacity: .85,
			zIndexOffset: 200
		}).addTo(state.map);
		marker.bindPopup(`<b>${escapeHtml(pin.title || "Untitled")}</b><br>${escapeHtml((pin.note || "").slice(0, 200))}<br><small style="color:var(--text-dim);">From: ${escapeHtml(team.name || cp.team_id.slice(0, 8))}</small>`);
		_collectionMarkers.push(marker);
		loaded++;
	} catch (e) {
		console.warn("[map]", e.message);
	}
	toast(`Loaded ${loaded} pin(s)`, "#16a34a");
}
async function importCollectionAsMap(collectionId) {
	const pins = await getCollectionPins(collectionId);
	if (!pins.length) {
		toast("No pins in collection", "#f97316");
		return;
	}
	const name = ((await getCollections()).find((c) => c.collection_id === collectionId)?.name || "Collection") + " (imported)";
	const sid = generate_uuid();
	const communityKp = generate_user_keypair();
	const memberKp = generate_user_keypair();
	const dk = generate_dek();
	await saveTeam({
		team_id: sid,
		name,
		public_key: encode_hex(communityKp.public),
		secret_key: encode_hex(memberKp.secret),
		wrapped_dek: wrap_dek(dk, encode_hex(memberKp.public)),
		community_public_key: encode_hex(communityKp.public),
		community_secret_key: encode_hex(communityKp.secret),
		community_wrapped_dek: wrap_dek(dk, encode_hex(communityKp.public))
	});
	await saveCommunity({
		community_id: sid,
		name,
		description: "",
		genesis_public_key: state.signingPublicKey || "",
		genesis_created_at: Date.now(),
		members: state.signingPublicKey ? [{
			pubkey: state.signingPublicKey,
			display_name: state.displayName,
			role: "founder",
			joined_at: Date.now(),
			vouched_by: null
		}] : [],
		governance: {
			contribution: "open",
			validation: "none",
			schema_authority: "any_member",
			key_rotation: "founder_only",
			fork_policy: "allowed",
			join_policy: "open"
		},
		bounds: null,
		relay_nodes: [],
		visibility: "local"
	});
	await saveLayers(sid, [{
		layer_id: generate_uuid(),
		name: "Imported",
		color: "#2563eb",
		visible: true,
		opacity: 1
	}]);
	const prog = showProgressDialog(`Importing ${pins.length} pins...`);
	let imported = 0;
	for (const cp of pins) try {
		const team = await getTeam(cp.team_id);
		if (!team) continue;
		const dkOld = unwrap_dek(team.wrapped_dek, team.secret_key);
		const pin = decrypt_pin_data(cp.ciphertext, cp.nonce, dkOld);
		const enc = encrypt_pin_data(pin.title || "Untitled", pin.note || "", pin.lat, pin.lng, pin.color || "#2563eb", dk);
		await savePin$1({
			pin_id: generate_uuid(),
			team_id: sid,
			layer_id: null,
			ciphertext: enc.ciphertext,
			nonce: enc.nonce,
			created_at: Date.now(),
			map_zoom: 13
		});
		imported++;
		if (imported % 10 === 0) prog.update(Math.round(imported / pins.length * 90), `${imported}/${pins.length}`);
	} catch (e) {
		console.warn("[map]", e.message);
	}
	prog.update(100, "Done");
	setTimeout(prog.done, 600);
	window._names[sid] = name;
	await window._loadSetList();
	await window._switchSet(sid);
	toast(`Created: ${name} \u2014 ${imported} pins`, "#16a34a");
}
//#endregion
//#region map-import.js
async function importLayerFromMap(sourceTeamId, sourceLayerId, targetLayerId, sourceSchemas) {
	if (!state.dek || !state.currentSet) return;
	const srcTeam = await getTeam(sourceTeamId);
	if (!srcTeam) {
		toast("Cannot access source map", "#dc2626");
		return;
	}
	const srcDek = unwrap_dek(srcTeam.wrapped_dek, srcTeam.secret_key);
	if (!srcDek) {
		toast("Cannot decrypt source map", "#dc2626");
		return;
	}
	let importedPins = 0, importedDrawings = 0;
	let erroredPins = 0, erroredDrawings = 0;
	const allPins = await getPins(sourceTeamId);
	const allDrawings = await getDrawings(sourceTeamId);
	const sourcePins = allPins.filter((p) => p.layer_id === sourceLayerId || !p.layer_id && !sourceLayerId);
	const sourceDrawings = allDrawings.filter((d) => d.layer_id === sourceLayerId || !d.layer_id && !sourceLayerId);
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
				map_zoom: row.map_zoom || 13
			};
			if (row.emoji) newPin.emoji = row.emoji;
			const tgtLayer = state.layers.find((l) => l.layer_id === targetLayerId);
			if (tgtLayer && tgtLayer.default_schema_id) newPin.schema_id = tgtLayer.default_schema_id;
			else if (row.schema_id) newPin.schema_id = row.schema_id;
			if (row.custom_data) {
				const encCustom = encrypt_raw_bytes(decrypt_raw_bytes(row.custom_data.ciphertext, row.custom_data.nonce, srcDek), state.dek);
				newPin.custom_data = {
					ciphertext: encCustom.ciphertext,
					nonce: encCustom.nonce
				};
			}
			if (row.media) {
				const encMedia = encrypt_raw_bytes(decrypt_raw_bytes(row.media.ciphertext, row.media.nonce, srcDek), state.dek);
				newPin.media = {
					type: /^(image|video|audio)\/[\w+.-]+$/.test(row.media.type) ? row.media.type : "application/octet-stream",
					name: (row.media.name || "file").replace(/[/\\]/g, "_").slice(0, 255),
					ciphertext: encMedia.ciphertext,
					nonce: encMedia.nonce
				};
			}
			await savePin$1(newPin);
			importedPins++;
		} catch (_) {
			erroredPins++;
		}
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
				nonce: enc.nonce
			};
			const tgtLayer2 = state.layers.find((l) => l.layer_id === targetLayerId);
			if (tgtLayer2 && tgtLayer2.default_schema_id) newDrawing.schema_id = tgtLayer2.default_schema_id;
			else if (row.schema_id) newDrawing.schema_id = row.schema_id;
			if (row.custom_data) {
				const encCustom = encrypt_raw_bytes(decrypt_raw_bytes(row.custom_data.ciphertext, row.custom_data.nonce, srcDek), state.dek);
				newDrawing.custom_data = {
					ciphertext: encCustom.ciphertext,
					nonce: encCustom.nonce
				};
			}
			if (row.media) {
				const encMedia = encrypt_raw_bytes(decrypt_raw_bytes(row.media.ciphertext, row.media.nonce, srcDek), state.dek);
				newDrawing.media = {
					type: /^(image|video|audio)\/[\w+.-]+$/.test(row.media.type || "") ? row.media.type : "application/octet-stream",
					name: (row.media.name || "file").replace(/[/\\]/g, "_").slice(0, 255),
					ciphertext: encMedia.ciphertext,
					nonce: encMedia.nonce
				};
			}
			await saveDrawing$1(newDrawing);
			importedDrawings++;
		} catch (_) {
			erroredDrawings++;
		}
		done++;
		if (prog && done % 5 === 0) prog.update(Math.round(done / totalItems * 90), `Importing ${done}/${totalItems}`);
	}
	if (prog) prog.done();
	await loadPins();
	await loadDrawings();
	const allSchemas = await getSchemas();
	const schemaIds = /* @__PURE__ */ new Set();
	for (const p of sourcePins) if (p.schema_id) schemaIds.add(p.schema_id);
	for (const d of sourceDrawings) if (d.schema_id) schemaIds.add(d.schema_id);
	for (const sid of schemaIds) if (!allSchemas.find((s) => s.schema_id === sid)) {
		const srcSchema = sourceSchemas?.find((s) => s.schema_id === sid);
		if (srcSchema) await saveSchema({
			schema_id: srcSchema.schema_id,
			name: srcSchema.name,
			fields: srcSchema.fields || []
		});
	}
	await loadSchemasForSet(state.currentSet);
	window._renderUI?.();
	let msg = `Imported ${importedPins} pin${importedPins !== 1 ? "s" : ""}, ${importedDrawings} drawing${importedDrawings !== 1 ? "s" : ""}`;
	if (erroredPins + erroredDrawings > 0) msg += ` (${erroredPins + erroredDrawings} skipped)`;
	toast(msg, importedPins + importedDrawings > 0 ? "#16a34a" : "#f97316");
}
function showImportFromMapModal() {
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	let sourceLayers = [], sourcePins = [], sourceDrawings = [], sourceSchemas = [];
	let selectedTeamId = null, selectedSourceLayerId = null;
	function renderSourceLayers() {
		if (!sourceLayers.length) {
			listEl.innerHTML = "<div style=\"color:var(--text-dim);text-align:center;padding:16px;font-size:12px;\">No layers in source map</div>";
			return;
		}
		listEl.innerHTML = sourceLayers.map((layer) => {
			const pinCount = sourcePins.filter((p) => p.layer_id === layer.layer_id || !p.layer_id && !layer.layer_id).length;
			const dwgCount = sourceDrawings.filter((d) => d.layer_id === layer.layer_id || !d.layer_id && !layer.layer_id).length;
			const sel = layer.layer_id === selectedSourceLayerId ? "selected" : "";
			return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-light);cursor:pointer;" class="im-layer-row" data-id="${layer.layer_id}">
        <span class="layer-dot" style="background:${layer.color || "#7c3aed"};${sel ? "box-shadow:0 0 0 2px #2563eb;" : ""}"></span>
        <span style="flex:1;font-size:13px;${sel ? "font-weight:600;" : ""}">${escapeHtml(layer.name)}</span>
        <span style="font-size:11px;color:var(--text-dim);">${pinCount} pin${pinCount !== 1 ? "s" : ""}${dwgCount ? ", " + dwgCount + " drawing" + (dwgCount !== 1 ? "s" : "") : ""}</span>
      </div>`;
		}).join("");
		listEl.querySelectorAll(".im-layer-row").forEach((row) => {
			row.onclick = () => {
				selectedSourceLayerId = row.dataset.id;
				renderSourceLayers();
			};
		});
	}
	function buildMapSelect() {
		const ids = Object.keys(window._names || {});
		return ids.filter((id) => id !== state.currentSet).length > 0 ? ids.filter((id) => id !== state.currentSet).map((id) => `<option value="${id}" ${id === selectedTeamId ? "selected" : ""}>${escapeHtml((window._names[id] || id).slice(0, 30))}</option>`).join("") : "<option value=\"\" disabled>No other maps available</option>";
	}
	const layerOpts = state.layers.map((l) => `<option value="${l.layer_id}">${escapeHtml(l.name)}</option>`).join("");
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
	const clean = () => {
		ov.remove();
	};
	document.getElementById("im-close").onclick = clean;
	ov.onclick = (e) => {
		if (e.target === ov) clean();
	};
	const mapSelect = document.getElementById("im-map-select");
	if (mapSelect && mapSelect.options.length > 0 && !mapSelect.options[0].disabled) mapSelect.dispatchEvent(new Event("change"));
	document.getElementById("im-map-select").onchange = async () => {
		const tid = document.getElementById("im-map-select").value;
		if (!tid) {
			sourceLayers = [];
			sourcePins = [];
			sourceDrawings = [];
			listEl.innerHTML = "";
			return;
		}
		selectedTeamId = tid;
		selectedSourceLayerId = null;
		listEl.innerHTML = "<div style=\"color:var(--text-dim);text-align:center;padding:16px;font-size:12px;\">Loading...</div>";
		try {
			if (!await getTeam(tid)) {
				listEl.innerHTML = "<div style=\"color:#dc2626;text-align:center;padding:16px;font-size:12px;\">Cannot read source map</div>";
				return;
			}
			sourcePins = await getPins(tid);
			sourceDrawings = await getDrawings(tid);
			sourceSchemas = await getSchemas();
			sourceLayers = await getLayers(tid) || [];
			if (sourceLayers.length === 0) sourceLayers = [{
				layer_id: null,
				name: "Default",
				color: "#7c3aed",
				visible: true,
				opacity: 1
			}];
			renderSourceLayers();
		} catch (e) {
			listEl.innerHTML = `<div style="color:#dc2626;text-align:center;padding:16px;font-size:12px;">Error: ${escapeHtml(e.message || "unknown")}</div>`;
		}
	};
	document.getElementById("im-do-btn").onclick = async () => {
		if (!selectedTeamId) {
			toast("No source map selected", "#f97316");
			return;
		}
		const sourceLayer = selectedSourceLayerId || (sourceLayers[0] ? sourceLayers[0].layer_id : null);
		const targetLayer = document.getElementById("im-target-layer").value;
		clean();
		await importLayerFromMap(selectedTeamId, sourceLayer, targetLayer, sourceSchemas);
	};
}
//#endregion
export { showCollectionPicker as $, geoJsonToLayer as A, loadSchemasForSet as At, pinIcon as B, deleteDrawing as C, renameLayer as Ct, downloadDrawingAttachment as D, toggleLayer as Dt, deleteSet as E, showLayersModal as Et, loadChains as F, refreshPinPopup as G, pushUndo as H, loadDrawings as I, renderChainStory as J, renameSet as K, loadPins as L, importCollectionAsMap as M, showSchemaEditorModal as Mt, initMap as N, showSchemaManagerModal as Nt, downloadPinMedia as O, buildCustomDataHTML as Ot, isMetricMode as P, showChainsModal as Q, loadSetList as R, createTutorial as S, refreshAllLayers as St, deleteSelected as T, showDiscoverModal as Tt, redo as U, placePin as V, refreshPinMarkerPopup as W, saveDrawing as X, reverseGeocode as Y, savePin as Z, closeCollectionView as _, updatePin as _t, addFreeDrawButton as a, showEditPinForm as at, createSet as b, deleteLayer as bt, addPinButton as c, showPinDetailModal as ct, addWatermark as d, showTemplatePicker as dt, showCollectionsModal as et, applyTimeFilter as f, startCurrentMapSlideshow as ft, clearSelection as g, undo as gt, canModifyDrawing as h, toggleMetricMode as ht, addDrawControl as i, showEditDrawingForm as it, geomMetrics as j, renderSchemaFieldsById as jt, generateLocationMarker as k, collectSchemaData as kt, addSelectionTool as l, showPinForm as lt, canDeletePin as m, switchSet as mt, showImportFromMapModal as n, showCreateTemplateModal as nt, addGridOverlay as o, showNarrativeChainBuilder as ot, buildDrawingPopup as p, startSlideshow as pt, renderAnnotationThread as q, addChainTool as r, showDrawingForm as rt, addMeasureButton as s, showNotificationsModal as st, importLayerFromMap as t, showCommunityDetails as tt, addTimeSlider as u, showSetsModal as ut, compressMedia as v, viewCollectionPins as vt, deletePin as w, setLayerOpacity as wt, createSetFromTemplate as x, loadLayersForSet as xt, compressVideoBytes as y, createLayer as yt, loadSubscribedPins as z };
