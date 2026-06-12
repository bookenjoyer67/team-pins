import { G as attr, K as escape_html, a as attr_class, c as ensure_array_like, d as spread_props, h as html, n as onDestroy, o as attr_style, p as stringify, u as slot } from "../../chunks/index-server.js";
import "../../chunks/e2e_core2.js";
import "../../chunks/db2.js";
import "../../chunks/peer2.js";
import "../../chunks/state.js";
import "../../chunks/dialogs.js";
import "../../chunks/sync2.js";
import "../../chunks/relay2.js";
import { n as state$1, s as t } from "../../chunks/leaflet-shim.js";
import { i as dialogs, n as cancelDialog } from "../../chunks/dialogs4.js";
new TextDecoder();
new TextEncoder();
//#endregion
//#region src/lib/components/ui/Modal.svelte
function Modal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { onClose = () => {}, children } = $$props;
		$$renderer.push(`<div class="modal-backdrop svelte-32v57s" role="dialog" tabindex="-1" autofocus=""><div class="modal-responsive svelte-32v57s">`);
		children?.($$renderer);
		$$renderer.push(`<!----></div></div>`);
	});
}
//#endregion
//#region src/lib/components/ui/ConfirmDialog.svelte
function ConfirmDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { message = "" } = $$props;
		{
			function children($$renderer) {
				$$renderer.push(`<p class="msg svelte-193t4hn">${escape_html(message)}</p> <div class="actions svelte-193t4hn"><button class="btn-cancel svelte-193t4hn">${escape_html(t("cancel"))}</button> <button class="btn-ok svelte-193t4hn">${escape_html(t("ok"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/AlertDialog.svelte
function AlertDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { message = "" } = $$props;
		{
			function children($$renderer) {
				$$renderer.push(`<p class="msg svelte-aqqeq9">${escape_html(message)}</p> <div class="actions svelte-aqqeq9"><button class="btn-ok svelte-aqqeq9">${escape_html(t("ok"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/PasswordDialog.svelte
function PasswordDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { title = "" } = $$props;
		let password = "";
		{
			function children($$renderer) {
				$$renderer.push(`<h3 class="title svelte-17f7r6">${escape_html(title)}</h3> <input type="password"${attr("value", password)}${attr("placeholder", t("password"))} class="input svelte-17f7r6" autofocus=""/> <div class="actions svelte-17f7r6"><button class="btn-cancel svelte-17f7r6">${escape_html(t("cancel"))}</button> <button class="btn-ok svelte-17f7r6">${escape_html(t("ok"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/SetPasswordDialog.svelte
function SetPasswordDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { label = "Set community password" } = $$props;
		let pass = "";
		let confirm = "";
		{
			function children($$renderer) {
				$$renderer.push(`<h3 class="title svelte-va9wok">${escape_html(label)}</h3> <p class="desc svelte-va9wok">Anyone joining this community via the relay will need this password.</p> <input type="password"${attr("value", pass)} placeholder="Password" class="input svelte-va9wok" autocomplete="new-password" autofocus=""/> <input id="sp-confirm" type="password"${attr("value", confirm)} placeholder="Confirm password" class="input svelte-va9wok"/> <div class="actions svelte-va9wok"><button class="btn-cancel svelte-va9wok">Cancel</button> <button class="btn-ok svelte-va9wok">Set</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/QRDialog.svelte
function QRDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { title = "", answer = "", qrSvg = "" } = $$props;
		{
			function children($$renderer) {
				$$renderer.push(`<h3 class="title svelte-1xh87a0">${escape_html(title)}</h3> `);
				if (qrSvg) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<div class="qr-box svelte-1xh87a0">${html(qrSvg)}</div>`);
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<p class="qr-fail svelte-1xh87a0">QR too large — use the code below</p>`);
				}
				$$renderer.push(`<!--]--> <textarea readonly="" class="textarea svelte-1xh87a0" rows="3">`);
				const $$body = escape_html(answer);
				if ($$body) $$renderer.push(`${$$body}`);
				$$renderer.push(`</textarea> <div class="actions svelte-1xh87a0"><button class="btn-copy svelte-1xh87a0">${escape_html(t("copyAnswer"))}</button> <button class="btn-close svelte-1xh87a0">${escape_html(t("close"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/IceServerDialog.svelte
function IceServerDialog($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { title = "ICE / TURN Servers", onSave = () => {} } = $$props;
		let servers = [];
		let pmtilesUrl = localStorage.getItem("pins-pmtiles-url") || "";
		let routingUrl = localStorage.getItem("pins-osrm-url") || "https://routing.openstreetmap.de/routed-car";
		let routingProfile = localStorage.getItem("pins-routing-profile") || "car";
		{
			function children($$renderer) {
				$$renderer.push(`<h3 style="margin:0 0 4px;">${escape_html(title)}</h3> <p style="font-size:11px;color:var(--text-dim);margin:0 0 4px;">${escape_html(t("iceDescription") || "STUN/TURN servers help peers connect behind NAT")}</p> <!--[-->`);
				const each_array = ensure_array_like(servers);
				for (let i = 0, $$length = each_array.length; i < $$length; i++) {
					let row = each_array[i];
					$$renderer.push(`<div class="row svelte-1b809t3"><input${attr("value", row.urls.join(","))} placeholder="stun:host:port" class="svelte-1b809t3"/> <input${attr("value", row.username || "")} placeholder="username" class="svelte-1b809t3"/> <input${attr("value", row.credential || "")} placeholder="credential" class="svelte-1b809t3"/> <button class="btn-remove svelte-1b809t3">×</button></div>`);
				}
				$$renderer.push(`<!--]--> <button class="btn-add svelte-1b809t3">${escape_html(t("addServer") || "+ Add server")}</button> <div class="section svelte-1b809t3"><label class="section-label svelte-1b809t3">Signal relay servers</label> <div></div> <button class="btn-add svelte-1b809t3">+ Add relay</button></div> <div class="section svelte-1b809t3"><label class="section-label svelte-1b809t3">PMTiles URL (vector basemap)</label> <input${attr("value", pmtilesUrl)} placeholder="https://example.com/map.pmtiles" class="full-input svelte-1b809t3"/></div> <div class="section svelte-1b809t3"><label class="section-label svelte-1b809t3">Routing Server (OSRM)</label> <input${attr("value", routingUrl)} placeholder="https://routing.openstreetmap.de/routed-car" class="full-input svelte-1b809t3"/> `);
				$$renderer.select({
					value: routingProfile,
					class: "full-input"
				}, ($$renderer) => {
					$$renderer.option({ value: "car" }, ($$renderer) => {
						$$renderer.push(`Car`);
					});
					$$renderer.option({ value: "foot" }, ($$renderer) => {
						$$renderer.push(`Walking`);
					});
					$$renderer.option({ value: "bike" }, ($$renderer) => {
						$$renderer.push(`Cycling`);
					});
				}, "svelte-1b809t3");
				$$renderer.push(`</div> <div class="actions svelte-1b809t3"><button class="btn-reset svelte-1b809t3">${escape_html(t("reset"))}</button> <button class="btn-cancel svelte-1b809t3">${escape_html(t("cancel"))}</button> <button class="btn-save svelte-1b809t3">${escape_html(t("save"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/ColorPicker.svelte
function ColorPicker($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { currentColor = "#7c3aed" } = $$props;
		const PRESETS = [
			"#7c3aed",
			"#2563eb",
			"#16a34a",
			"#f97316",
			"#eab308",
			"#ec4899",
			"#ef4444",
			"#0891b2",
			"#000000",
			"#ffffff"
		];
		let selected = currentColor;
		$$renderer.push(`<div class="picker-backdrop svelte-7hs29g"><div class="picker-card svelte-7hs29g"><div class="grid svelte-7hs29g"><!--[-->`);
		const each_array = ensure_array_like(PRESETS);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let c = each_array[$$index];
			$$renderer.push(`<button${attr_class("swatch svelte-7hs29g", void 0, { "active": selected === c })}${attr_style(`background:${stringify(c)}; ${c === "#ffffff" ? "border:1px solid var(--border);" : ""}`)}></button>`);
		}
		$$renderer.push(`<!--]--></div> <div class="custom-row svelte-7hs29g"><input type="color"${attr("value", selected)} class="color-input svelte-7hs29g"/> <span class="hex svelte-7hs29g">${escape_html(selected)}</span></div> <div class="actions svelte-7hs29g"><button class="btn-cancel svelte-7hs29g">Cancel</button> <button class="btn-ok svelte-7hs29g">OK</button></div></div></div>`);
	});
}
//#endregion
//#region src/lib/components/ui/ProgressOverlay.svelte
function ProgressOverlay($$renderer, $$props) {
	let { title = "", percent = 0, label = "Preparing..." } = $$props;
	$$renderer.push(`<div class="progress-backdrop svelte-8taes8"><div class="progress-card svelte-8taes8"><h3 class="title svelte-8taes8">${escape_html(title)}</h3> <div class="bar-track svelte-8taes8"><div class="bar-fill svelte-8taes8"${attr_style(`width:${stringify(percent)}%`)}></div></div> <p class="desc svelte-8taes8">${escape_html(label)}</p></div></div>`);
}
//#endregion
//#region src/lib/components/map/DrawingForm.svelte
function DrawingForm($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { geometry = {} } = $$props;
		let title = "";
		let note = "";
		let layerId = "";
		let anonymous = false;
		{
			function children($$renderer) {
				$$renderer.push(`<h3 class="h svelte-1h2rgct">${escape_html(t("newDrawing"))}</h3> `);
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <input class="inp svelte-1h2rgct"${attr("value", title)}${attr("placeholder", t("title"))}/> <textarea class="inp ta svelte-1h2rgct"${attr("placeholder", t("description"))} rows="3">`);
				const $$body = escape_html(note);
				if ($$body) $$renderer.push(`${$$body}`);
				$$renderer.push(`</textarea> <div class="label svelte-1h2rgct">${escape_html(t("layer") || "Layer")}</div> `);
				$$renderer.select({
					class: "inp",
					value: layerId
				}, ($$renderer) => {
					$$renderer.push(`<!--[-->`);
					const each_array = ensure_array_like(state$1.layers);
					for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
						let l = each_array[$$index];
						$$renderer.option({ value: l.layer_id }, ($$renderer) => {
							$$renderer.push(`${escape_html(l.name)}`);
						});
					}
					$$renderer.push(`<!--]-->`);
				}, "svelte-1h2rgct");
				$$renderer.push(` <label class="check svelte-1h2rgct"><input type="checkbox"${attr("checked", anonymous, true)}/> Post anonymously</label> <div class="label svelte-1h2rgct">${escape_html(t("attachment") || "Attachment")}</div> <input type="file" class="inp svelte-1h2rgct" accept="image/*,video/*,audio/*"/> <div class="actions svelte-1h2rgct"><button class="btn-cancel svelte-1h2rgct">${escape_html(t("cancel"))}</button> <button class="btn-save svelte-1h2rgct">${escape_html(t("save"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/map/PinDetailModal.svelte
function PinDetailModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { pinId = "" } = $$props;
		let marker = null;
		let mediaUrls = [];
		onDestroy(() => {
			for (const u of mediaUrls) URL.revokeObjectURL(u);
		});
		!marker?._postedAnonymously && marker?._authorPubkey && (marker?._authorPubkey, state$1.signingPublicKey);
		{
			function children($$renderer) {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region helpers.js
var COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#16a34a",
	"#2563eb",
	"#7c3aed",
	"#ec4899",
	"#6b7280"
];
//#endregion
//#region src/lib/components/map/PinForm.svelte
function PinForm($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { lat = 0, lng = 0, pinId = "", editing = false } = $$props;
		let title = "";
		let note = "";
		let geocoding = false;
		let color = "#2563eb";
		let emoji = "";
		let layerId = "";
		let schemaId = "";
		let timeFrom = "";
		let timeUntil = "";
		let recType = null;
		let recStatus = "idle";
		let recTimerText = "0:00";
		let recStream = null;
		let recRecorder = null;
		let recTimer = null;
		let schemaFieldsHtml = "";
		async function loadSchemaFields() {
			const schema = schemaId ? state$1.schemas.find((s) => s.schema_id === schemaId) : null;
			if (!schema || !schema.fields?.length) {
				schemaFieldsHtml = "";
				return;
			}
			const { escapeHtml } = await import("../../chunks/dialogs2.js");
			let h = `<div class="sf-wrap" style="border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:4px;"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">📋 ${escapeHtml(schema.name)}</div>`;
			for (const f of schema.fields) {
				const key = f.key;
				if (f.type === "choice" && f.options) h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><select name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;">${f.options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}</select></div>`;
				else if (f.type === "boolean") h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><select name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;"><option value="true">true</option><option value="false">false</option></select></div>`;
				else if (f.type === "date") h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><input type="date" name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
				else if (f.type === "time") h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><input type="time" name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
				else if (f.type === "number") h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><input type="number" name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
				else h += `<div style="margin-bottom:4px;"><span style="font-size:11px;color:var(--text-dim);">${escapeHtml(f.label)}</span><input type="text" name="sf_${key}" style="width:100%;padding:4px;margin-top:2px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text);font-size:12px;box-sizing:border-box;" /></div>`;
			}
			h += "</div>";
			schemaFieldsHtml = h;
		}
		onDestroy(() => cleanupRecorder());
		function cleanupRecorder() {
			if (recStream) {
				recStream.getTracks().forEach((t) => t.stop());
				recStream = null;
			}
			if (recRecorder && recRecorder.state === "recording") recRecorder.stop();
			recRecorder = null;
			if (recTimer) {
				clearInterval(recTimer);
				recTimer = null;
			}
			recType = null;
			recStatus = "idle";
		}
		function close() {
			cleanupRecorder();
			cancelDialog();
		}
		{
			function children($$renderer) {
				$$renderer.push(`<h3 class="h svelte-1rq8om8">${escape_html(editing ? t("editPin") : t("newPin"))}</h3> <input class="inp svelte-1rq8om8"${attr("value", title)}${attr("placeholder", t("title"))} autofocus=""/> <div class="ta-wrap svelte-1rq8om8"><textarea class="inp ta svelte-1rq8om8"${attr("placeholder", t("description"))} rows="3">`);
				const $$body = escape_html(note);
				if ($$body) $$renderer.push(`${$$body}`);
				$$renderer.push(`</textarea> <button class="geo-btn svelte-1rq8om8"${attr("disabled", geocoding, true)}${attr("title", t("reverseGeocode") || "Fill address")}>${escape_html("📍")}</button></div> <div class="label svelte-1rq8om8">${escape_html(t("color"))}</div> <!---->`);
				{
					$$renderer.push(`<div class="colors svelte-1rq8om8"><!--[-->`);
					const each_array = ensure_array_like(COLORS);
					for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
						let c = each_array[$$index];
						$$renderer.push(`<span class="swatch svelte-1rq8om8"${attr_style(`background:${stringify(c)}; border:2px solid ${color === c ? "var(--text)" : "transparent"};`)}></span>`);
					}
					$$renderer.push(`<!--]--> <span class="swatch hue svelte-1rq8om8"${attr_style(`border:2px solid ${COLORS.includes(color) ? "transparent" : "var(--text)"};`)}></span> <input type="text" class="hex-inp svelte-1rq8om8"${attr("value", color)} placeholder="#hex"/></div>`);
				}
				$$renderer.push(`<!----> <div class="label svelte-1rq8om8">${escape_html(t("emoji") || "Emoji")}</div> <div class="emoji-row svelte-1rq8om8"><input class="emoji-inp svelte-1rq8om8"${attr("value", emoji)} placeholder="😊" maxlength="2"/></div> <div class="label svelte-1rq8om8">${escape_html(t("layer") || "Layer")}</div> <!---->`);
				$$renderer.select({
					class: "inp",
					value: layerId,
					oninput: (e) => {
						layerId = e.target.value;
						const l = state$1.layers.find((l) => l.layer_id === layerId);
						if (l?.default_schema_id) {
							schemaId = l.default_schema_id;
							loadSchemaFields();
						}
					}
				}, ($$renderer) => {
					$$renderer.push(`<!--[-->`);
					const each_array_1 = ensure_array_like(state$1.layers);
					for (let $$index_1 = 0, $$length = each_array_1.length; $$index_1 < $$length; $$index_1++) {
						let l = each_array_1[$$index_1];
						$$renderer.option({ value: l.layer_id }, ($$renderer) => {
							$$renderer.push(`${escape_html(l.name)}`);
						});
					}
					$$renderer.push(`<!--]-->`);
				}, "svelte-1rq8om8");
				$$renderer.push(` <div class="label svelte-1rq8om8">${escape_html(t("schemas") || "Schema")}</div> `);
				$$renderer.select({
					class: "inp",
					value: schemaId,
					oninput: (e) => {
						schemaId = e.target.value;
						loadSchemaFields();
					}
				}, ($$renderer) => {
					$$renderer.option({ value: "" }, ($$renderer) => {
						$$renderer.push(`none`);
					});
					$$renderer.push(`<!--[-->`);
					const each_array_2 = ensure_array_like(state$1.schemas);
					for (let $$index_2 = 0, $$length = each_array_2.length; $$index_2 < $$length; $$index_2++) {
						let s = each_array_2[$$index_2];
						$$renderer.option({ value: s.schema_id }, ($$renderer) => {
							$$renderer.push(`${escape_html(s.name)}`);
						});
					}
					$$renderer.push(`<!--]-->`);
				}, "svelte-1rq8om8");
				$$renderer.push(`<!----> <div id="schema-fields">${html(schemaFieldsHtml)}</div> `);
				if (!editing && typeof MediaRecorder !== "undefined") {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<div class="label svelte-1rq8om8">${escape_html(t("photoVideo"))}</div> <video class="rec-preview svelte-1rq8om8" muted="" autoplay="" playsinline=""></video> <div class="rec-bar svelte-1rq8om8">`);
					if (recStatus === "idle" || recStatus === "captured") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<button class="rec-btn v svelte-1rq8om8">📹 Record Video</button> <button class="rec-btn a svelte-1rq8om8">🎤 Record Audio</button> <button class="rec-btn s svelte-1rq8om8">📷 Snap Photo</button>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (recStatus === "recording") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<span class="rec-status svelte-1rq8om8">⏺ Recording... ${escape_html(recTimerText)} `);
						if (recType === "video") {
							$$renderer.push("<!--[0-->");
							$$renderer.push(`<button class="rec-small svelte-1rq8om8">🔄</button>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></span> <button class="rec-stop svelte-1rq8om8">⏹ Stop</button>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (recStatus === "snapping") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<button class="rec-btn s svelte-1rq8om8">📸 Capture</button> <button class="rec-small svelte-1rq8om8">🔄</button> <button class="rec-cancel svelte-1rq8om8">Cancel</button>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--> `);
					if (recStatus === "captured") {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<span class="rec-done svelte-1rq8om8">✅ Recorded</span> <button class="rec-cancel svelte-1rq8om8">Discard</button>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></div>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				if (editing || typeof MediaRecorder === "undefined") {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<div class="label svelte-1rq8om8">${escape_html(t("photoVideo"))}</div> <input type="file" class="inp svelte-1rq8om8" accept="image/*,video/*,audio/*"/>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <div class="label svelte-1rq8om8">${escape_html(t("timeFrom"))}</div> <input class="inp svelte-1rq8om8"${attr("value", timeFrom)} placeholder="YYYY"/> <div class="label svelte-1rq8om8">${escape_html(t("timeTo"))}</div> <input class="inp svelte-1rq8om8"${attr("value", timeUntil)} placeholder="YYYY"/> `);
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> `);
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--> <div class="actions svelte-1rq8om8"><button class="btn-cancel svelte-1rq8om8">${escape_html(t("cancel"))}</button> <button class="btn-save svelte-1rq8om8">${escape_html(t("save"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: close,
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/HostModal.svelte
function HostModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let compact = "";
		{
			function children($$renderer) {
				$$renderer.push(`<h3 class="h svelte-h8oh0y">${escape_html(t("hostGroup"))}</h3> `);
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<p class="hint svelte-h8oh0y">QR too large — use code below</p>`);
				$$renderer.push(`<!--]--> <textarea readonly="" class="code svelte-h8oh0y" rows="3">`);
				const $$body = escape_html(compact);
				if ($$body) $$renderer.push(`${$$body}`);
				$$renderer.push(`</textarea> <div class="row svelte-h8oh0y"><button class="btn-copy svelte-h8oh0y">${escape_html(t("copyLink"))}</button> <button class="btn-copy svelte-h8oh0y">${escape_html(t("copyCode"))}</button></div> <div class="actions svelte-h8oh0y"><button class="btn-paste svelte-h8oh0y">${escape_html(t("pasteAnswer"))}</button> <button class="btn-close svelte-h8oh0y">${escape_html(t("close"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/JoinModal.svelte
function JoinModal($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { onConnect = () => {} } = $$props;
		{
			function children($$renderer) {
				$$renderer.push(`<h3 class="h svelte-q11t90">${escape_html(t("joinPeer"))}</h3> <p class="desc svelte-q11t90">${escape_html(t("joinPeerDescription"))}</p> <div class="actions svelte-q11t90"><button class="btn-scan svelte-q11t90">${escape_html(t("scanHostQRBtn"))}</button> <button class="btn-paste svelte-q11t90">${escape_html(t("pasteCodeBtn"))}</button> <button class="btn-cancel svelte-q11t90">${escape_html(t("cancel"))}</button></div>`);
			}
			Modal($$renderer, {
				onClose: () => cancelDialog(),
				children,
				$$slots: { default: true }
			});
		}
	});
}
//#endregion
//#region src/lib/components/ui/DialogRenderer.svelte
function DialogRenderer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		const COMPONENTS = {
			confirm: ConfirmDialog,
			alert: AlertDialog,
			password: PasswordDialog,
			setPassword: SetPasswordDialog,
			qrAnswer: QRDialog,
			qrHost: QRDialog,
			iceServer: IceServerDialog,
			colorPicker: ColorPicker,
			progress: ProgressOverlay,
			drawingForm: DrawingForm,
			pinDetail: PinDetailModal,
			pinForm: PinForm,
			hostModal: HostModal,
			joinModal: JoinModal
		};
		let stack = dialogs.stack;
		dialogs.subscribe((v) => stack = v);
		if (stack.length > 0) {
			$$renderer.push("<!--[0-->");
			const top = stack[stack.length - 1];
			if (COMPONENTS[top.component]) {
				$$renderer.push("<!--[0-->");
				if (COMPONENTS[top.component]) {
					$$renderer.push("<!--[-->");
					COMPONENTS[top.component]($$renderer, spread_props([top.props]));
					$$renderer.push("<!--]-->");
				} else {
					$$renderer.push("<!--[!-->");
					$$renderer.push("<!--]-->");
				}
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/routes/+layout.svelte
function _layout($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let installPrompt = null;
		if (!(() => {
			try {
				return new URLSearchParams(window.location.search).get("embed") === "1" || window.self !== window.top;
			} catch (_) {
				return false;
			}
		})()) {
			window.addEventListener("beforeinstallprompt", (e) => {
				e.preventDefault();
				installPrompt = e;
				showInstallBanner();
			});
			window.addEventListener("appinstalled", () => {
				installPrompt = null;
				const b = document.getElementById("install-banner");
				if (b) b.remove();
			});
		}
		function showInstallBanner() {
			if (window._isEmbed) return;
			if (localStorage.getItem("pins-install-dismissed")) return;
			if (document.getElementById("install-banner")) return;
			const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
			const banner = document.createElement("div");
			banner.id = "install-banner";
			if (isIOS) banner.innerHTML = `<span class="install-banner-icon">📌</span><span><b>Add to Home Screen:</b> tap Share → Add to Home Screen</span><button class="install-banner-close">✕</button>`;
			else if (installPrompt) banner.innerHTML = `<span class="install-banner-icon">📌</span><span>Add to Home Screen</span><button class="install-banner-btn" id="install-banner-do">Install</button><button class="install-banner-close">✕</button>`;
			else return;
			document.body.appendChild(banner);
			const doBtn = banner.querySelector("#install-banner-do");
			if (doBtn) doBtn.onclick = async () => {
				if (installPrompt) {
					await installPrompt.prompt();
					installPrompt = null;
				}
				banner.remove();
			};
			banner.querySelector(".install-banner-close").onclick = () => {
				banner.remove();
				localStorage.setItem("pins-install-dismissed", Date.now());
			};
		}
		$$renderer.push("<!--[0-->");
		$$renderer.push(`<div class="app-loader"><div><div class="spinner"></div> <div class="label">Loading map…</div></div></div>`);
		$$renderer.push(`<!--]--> <div id="offline-bar" style="display:none">You are offline — local features available</div> <!--[-->`);
		slot($$renderer, $$props, "default", {}, null);
		$$renderer.push(`<!--]--> `);
		DialogRenderer($$renderer, {});
		$$renderer.push(`<!---->`);
	});
}
//#endregion
export { _layout as default };
