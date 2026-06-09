// Dialogs — thin re-export of the Svelte dialog store.
// Engine modules import from here and get store-backed Svelte dialog components.
// escapeHtml and toast are kept as utility functions.

import { generate_qr_svg } from "./core/pkg/e2e_core.js";
import * as QR from "./qr.js";
import { state } from "./state.js";
import { t } from "./i18n.js";

// --- Pure utilities (no DOM/Svelte dependency) ---

export function escapeHtml(str) {
	if (str == null) return "";
	const div = document.createElement("div");
	div.textContent = String(str);
	return div.innerHTML;
}

export function toast(msg, color = "#dc2626", duration = 2000, undoAction = null) {
	if (window._svelteToast) {
		return window._svelteToast(msg, color, duration, undoAction);
	}
	// Fallback: manual DOM toast
	const el = document.createElement("div");
	el.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:${color};color:white;padding:10px 20px;border-radius:6px;z-index:3000;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,0.3);display:flex;align-items:center;gap:10px;`;
	const text = document.createElement("span");
	text.innerHTML = msg;
	el.appendChild(text);
	if (undoAction) {
		const btn = document.createElement("button");
		btn.textContent = "Undo";
		btn.style.cssText = "padding:3px 10px;border:1px solid rgba(255,255,255,0.4);background:rgba(255,255,255,0.15);color:white;border-radius:3px;cursor:pointer;font-size:12px;white-space:nowrap;";
		btn.onclick = () => { undoAction(); el.remove(); };
		el.appendChild(btn);
	}
	document.body.appendChild(el);
	setTimeout(() => {
		el.style.opacity = "0";
		el.style.transition = "opacity 0.3s";
		setTimeout(() => el.remove(), 300);
	}, duration);
	return el;
}

export async function hashCommunityPassword(password, communityId) {
	const enc = new TextEncoder();
	const data = enc.encode(password + communityId);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// --- Async helper to load the store (lazy, avoids circular deps) ---
let _storePromise = null;
function getStore() {
	if (!_storePromise) {
		_storePromise = import('./src/lib/stores/dialogs.js');
	}
	return _storePromise;
}

// --- Dialog functions that delegate to Svelte store ---

export function confirmDialog(message) {
	if (window._confirmDialog) return window._confirmDialog(message);
	return getStore().then(m => m.confirm(message));
}

export function alertDialog(message) {
	if (window._alertDialog) return window._alertDialog(message);
	return getStore().then(m => m.alert(message));
}

export function promptRoomPassword(title) {
	return getStore().then(m => m.promptPassword(title));
}

export function showPasswordDialog(title, cb, checkboxLabel) {
	getStore().then(m => m.promptPassword(title, checkboxLabel)).then(
		result => cb(result, checkboxLabel ? result !== null : undefined)
	);
}

export function promptSetPassword(currentLabel) {
	return getStore().then(m => m.promptSetPassword(currentLabel || 'Set community password'));
}

export function showQRAnswerDialog(title, answer, qrSvg) {
	getStore().then(m => m.showQRAnswer(title, answer, qrSvg));
}

export function showIceServerDialog(onSave) {
	getStore().then(m => m.showIceServer(onSave));
}

export function showProgressDialog(title) {
	if (window._showProgressDialog) return window._showProgressDialog(title);
	// DOM fallback
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:24px;border-radius:8px;min-width:340px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
		<h3 id="prog-title" style="margin:0 0 16px;font-size:15px;">${escapeHtml(title)}</h3>
		<div style="background:var(--border-light);border-radius:4px;height:8px;overflow:hidden;margin-bottom:8px;">
			<div id="prog-bar" style="background:#2563eb;height:100%;width:0%;transition:width 0.3s ease;"></div>
		</div>
		<p id="prog-label" style="font-size:12px;color:var(--text-dim);margin:0;text-align:center;">Preparing...</p>
	</div>`;
	document.body.appendChild(ov);
	return {
		update(percent, msg) {
			const bar = document.getElementById("prog-bar");
			const label = document.getElementById("prog-label");
			if (bar) bar.style.width = Math.min(100, Math.max(0, Math.round(percent))) + "%";
			if (label && msg) label.textContent = msg;
		},
		done() { ov.remove(); },
	};
}

export function showColorPickerDialog(currentColor, onChange) {
	getStore().then(m => m.showColorPicker(currentColor, onChange));
}

// --- QR scanning and peer paste — keep for now (camera-based, complex) ---

export function showPeerPaste(title, cb) {
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:360px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">${escapeHtml(title)}</h3><textarea id="paste-area" rows="4" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;font-size:11px;resize:vertical;"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="paste-go" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("submit")}</button><button id="paste-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button></div></div>`;
	document.body.appendChild(ov);
	const clean = () => ov.remove();
	document.getElementById("paste-cancel").onclick = clean;
	ov.onclick = (e) => { if (e.target === ov) clean(); };
	ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(); });
	document.getElementById("paste-go").onclick = () => {
		const data = document.getElementById("paste-area").value.trim();
		clean();
		cb(data);
	};
}

export function showQRScanDialog(title, onDetected, onCancel) {
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:2000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;";
	ov.innerHTML = `<h3 style="color:white;margin:0;">${escapeHtml(title)}</h3><div id="qr-scan-box" style="width:300px;height:300px;display:flex;align-items:center;justify-content:center;background:#000;border-radius:8px;overflow:hidden;"></div><p id="qr-scan-msg" style="color:#9ca3af;font-size:13px;margin:0;">${t("qrScanPrompt")}</p><button id="qr-scan-cancel" style="padding:8px 20px;border:1px solid #9ca3af;background:transparent;color:#9ca3af;border-radius:4px;cursor:pointer;font-size:14px;">${t("cancel")}</button>`;
	document.body.appendChild(ov);
	const box = document.getElementById("qr-scan-box");
	const msgEl = document.getElementById("qr-scan-msg");
	let scanner = null;
	const clean = (cancelled = false) => {
		if (scanner) scanner.stop();
		ov.remove();
		if (cancelled) onCancel?.();
	};
	document.getElementById("qr-scan-cancel").onclick = () => clean(true);
	ov.onclick = (e) => { if (e.target === ov) clean(true); };
	ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(true); });
	try {
		scanner = QR.createScanner(
			(data) => { clean(); onDetected(data); },
			(err) => {
				msgEl.textContent = err.name === "NotAllowedError" ? "Camera access denied" : "Camera unavailable";
				msgEl.style.color = "#EF4444";
			}
		);
		box.appendChild(scanner.video);
	} catch (_) {
		msgEl.textContent = t("scannerNotSupported");
		msgEl.style.color = "#EF4444";
	}
}

// Keep QR host/join dialogs as DOM for now (complex callback flow)
export function showQRHostDialog(connId, code, compact, link, callbacks) {
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:360px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("hostGroup")}</h3><div id="qr-host-box" style="text-align:center;margin-bottom:12px;min-height:32px;"></div><textarea id="qr-host-ct" readonly rows="3" style="width:100%;padding:6px;margin-bottom:4px;box-sizing:border-box;font-size:11px;resize:vertical;">${escapeHtml(compact)}</textarea><div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;"><button id="qr-host-link" style="padding:4px 10px;border:1px solid #059669;background:var(--bg-card);color:#059669;border-radius:4px;cursor:pointer;font-size:12px;">${t("copyLink")}</button><button id="qr-host-code" style="padding:4px 10px;border:1px solid #9ca3af;background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;">${t("copyCode")}</button><button id="qr-host-scan" style="padding:4px 10px;border:1px solid #7c3aed;background:var(--bg-card);color:#7c3aed;border-radius:4px;cursor:pointer;font-size:12px;">${t("scanResponseQR")}</button></div><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="qr-host-paste" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("pasteAnswer")}</button><button id="qr-host-close" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("close")}</button></div></div>`;
	document.body.appendChild(ov);
	const qrSvg = generate_qr_svg(link);
	const qrBox = document.getElementById("qr-host-box");
	if (qrSvg) {
		const parser = new DOMParser();
		const doc = parser.parseFromString(qrSvg, "image/svg+xml");
		const svgEl = doc.documentElement;
		if (svgEl) {
			svgEl.querySelectorAll("script, [onload], [onerror], foreignObject").forEach(el => el.remove());
			svgEl.style.maxWidth = "200px";
			svgEl.style.height = "auto";
			qrBox.appendChild(svgEl);
		}
	} else {
		qrBox.innerHTML = `<p style="font-size:11px;color:#EF4444;margin:4px 0;">QR too large — use the code below</p>`;
	}
	const clean = () => ov.remove();
	import("./peer.js").then(m => {
		const finalizeAnswer = async (answer) => {
			try {
				let name = "Peer";
				if (!answer.startsWith("a|") && !answer.startsWith("o|")) {
					try { name = JSON.parse(answer).display_name || "Peer"; } catch (_) {}
				}
				await m.finalizeConnection(state.pendingConnId || connId, answer);
				callbacks.onPeerHandshake(name, state.pendingConnId || connId);
				state.pendingConnId = null;
				callbacks.onRenderUI();
				clean();
				if (callbacks.onAddAnother && await confirmDialog(name + " connected! Add another peer?")) {
					callbacks.onAddAnother();
				}
			} catch (_) {
				await alertDialog("Invalid answer data");
			}
		};
		document.getElementById("qr-host-link").onclick = () => navigator.clipboard.writeText(link).catch(() => {});
		document.getElementById("qr-host-code").onclick = () => navigator.clipboard.writeText(compact).catch(() => {});
		document.getElementById("qr-host-scan").onclick = async () => { clean(); showQRScanDialog(t("scanPeerQR"), finalizeAnswer, () => showQRHostDialog(connId, code, compact, link, callbacks)); };
		document.getElementById("qr-host-paste").onclick = () => { clean(); showPeerPaste(t("pastePeerAnswer"), finalizeAnswer); };
	});
	document.getElementById("qr-host-close").onclick = clean;
	ov.onclick = (e) => { if (e.target === ov) clean(); };
	ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(); });
}

export function showQRJoinDialog(callbacks) {
	const ov = document.createElement("div");
	ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
	ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:360px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("joinPeer")}</h3><p style="font-size:13px;color:var(--text-dim);margin:0 0 16px;">${t("joinPeerDescription")}</p><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="qr-join-scan" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("scanHostQRBtn")}</button><button id="qr-join-paste" style="padding:6px 14px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:4px;cursor:pointer;">${t("pasteCodeBtn")}</button><button id="qr-join-close" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button></div></div>`;
	document.body.appendChild(ov);
	const clean = () => ov.remove();
	import("./peer.js").then(async (m) => {
		const handleCode = async (raw) => {
			let code = raw;
			if (raw.includes("#join=")) {
				try {
					let b64 = raw.split("#join=")[1].split("&")[0];
					b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
					while (b64.length % 4) b64 += "=";
					code = atob(b64);
				} catch (_) {}
			}
			clean();
			try {
				const { setId, compact } = await m.acceptOffer(code, state.user.id, state.displayName);
				window._pendingJoinSet = true;
				const aqr = generate_qr_svg(compact);
				showQRAnswerDialog("Send Back", compact, aqr);
				if (setId) await callbacks.onSetReceived(setId);
				callbacks.onRenderUI();
			} catch (_) {
				await alertDialog("Failed to connect");
			}
		};
		document.getElementById("qr-join-scan").onclick = () => { clean(); showQRScanDialog(t("scanHostQR"), handleCode, () => showQRJoinDialog(callbacks)); };
		document.getElementById("qr-join-paste").onclick = () => { clean(); showPeerPaste(t("pasteHostOffer"), handleCode); };
	});
	document.getElementById("qr-join-close").onclick = clean;
	ov.onclick = (e) => { if (e.target === ov) clean(); };
	ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(); });
}
