import { generate_qr_svg } from "./core/pkg/e2e_core.js";
import * as Peer from "./peer.js";
import * as QR from "./qr.js";
import { state } from "./state.js";
import { t } from "./i18n.js";

function safeInsertSvg(container, svgString) {
  if (!container || !svgString) return;
  container.textContent = "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const svgEl = doc.documentElement;
  if (!svgEl || svgEl.tagName !== "svg") return;
  svgEl.querySelectorAll("script, [onload], [onerror], [onclick], [onmouseover], foreignObject").forEach(el => el.remove());
  container.appendChild(svgEl);
}

export function escapeHtml(str) {
  if (str == null) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

export function toast(msg, color = "#dc2626", duration = 2000, undoAction = null) {
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

export function promptRoomPassword(title) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
    ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">${escapeHtml(title)}</h3><input id="rm-pwd-input" type="password" placeholder="${t("password")}" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="rm-pwd-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="rm-pwd-ok" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("ok")}</button></div></div>`;
    document.body.appendChild(ov);
    const clean = (v) => { ov.remove(); resolve(v); };
    const input = ov.querySelector("#rm-pwd-input");
    input.focus();
    input.addEventListener("keydown", e => { if (e.key === "Enter") clean(input.value); });
    ov.querySelector("#rm-pwd-cancel").onclick = () => clean("");
    ov.querySelector("#rm-pwd-ok").onclick = () => clean(input.value);
    ov.onclick = (e) => { if (e.target === ov) clean(""); };
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(""); });
  });
}

export function showPasswordDialog(title, cb, checkboxLabel) {
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  const extra = checkboxLabel
    ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);margin-bottom:12px;"><input type="checkbox" id="pwd-check" checked /> ${escapeHtml(checkboxLabel)}</label>`
    : "";
  ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">${escapeHtml(title)}</h3><input id="pwd-input" type="password" placeholder="${t("password")}" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;" />${extra}<div style="display:flex;gap:8px;justify-content:flex-end;"><button id="pwd-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="pwd-go" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("ok")}</button></div></div>`;
  document.body.appendChild(ov);
  document.getElementById("pwd-input").focus();
  const clean = (v, c) => { ov.remove(); cb(v, c); };
  document.getElementById("pwd-cancel").onclick = () => {
    if (checkboxLabel) clean("", false);
    else clean("");
  };
  document.getElementById("pwd-go").onclick = () => {
    const p = document.getElementById("pwd-input").value;
    if (checkboxLabel) {
      const checked = document.getElementById("pwd-check").checked;
      clean(p, checked);
    } else {
      clean(p);
    }
  };
  ov.onclick = (e) => {
    if (e.target === ov) {
      if (checkboxLabel) clean("", false);
      else clean("");
    }
  };
  ov.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (checkboxLabel) clean("", false);
      else clean("");
    }
    if (e.key === "Enter") document.getElementById("pwd-go").click();
  });
}

export async function hashCommunityPassword(password, communityId) {
  const enc = new TextEncoder();
  const data = enc.encode(password + communityId);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function promptSetPassword(currentLabel) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2100;display:flex;align-items:center;justify-content:center;";
    const label = currentLabel || "Set community password";
    ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 4px;">${escapeHtml(label)}</h3>
      <p style="font-size:11px;color:var(--text-dim);margin:0 0 8px;">Anyone joining this community via the relay will need this password.</p>
      <input id="ps-pass" type="password" placeholder="Password" style="width:100%;padding:6px;margin-bottom:6px;box-sizing:border-box;" autocomplete="new-password" />
      <input id="ps-confirm" type="password" placeholder="Confirm password" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="ps-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">Cancel</button>
        <button id="ps-ok" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Set</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const clean = (v) => { ov.remove(); resolve(v); };
    document.getElementById("ps-pass").focus();
    const go = () => {
      const pass = document.getElementById("ps-pass").value;
      const confirm = document.getElementById("ps-confirm").value;
      if (!pass) { toast("Password cannot be empty", "#dc2626"); return; }
      if (pass !== confirm) { toast("Passwords do not match", "#dc2626"); return; }
      if (pass.length < 8) { toast("Password must be at least 8 characters", "#dc2626"); return; }
      clean(pass);
    };
    document.getElementById("ps-pass").addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("ps-confirm").focus(); });
    document.getElementById("ps-confirm").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    document.getElementById("ps-cancel").onclick = () => clean(null);
    document.getElementById("ps-ok").onclick = go;
    ov.onclick = (e) => { if (e.target === ov) clean(null); };
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(null); });
  });
}

export function showPeerPaste(title, cb) {
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:360px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">${escapeHtml(title)}</h3><textarea id="paste-area" rows="4" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;font-size:11px;resize:vertical;"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="paste-go" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("submit")}</button><button id="paste-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button></div></div>`;
  document.body.appendChild(ov);
  const clean = () => ov.remove();
  document.getElementById("paste-cancel").onclick = clean;
  ov.onclick = (e) => {
    if (e.target === ov) clean();
  };
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(); });
  document.getElementById("paste-go").onclick = () => {
    const data = document.getElementById("paste-area").value.trim();
    clean();
    cb(data);
  };
}

export function showQRScanDialog(title, onDetected, onCancel) {
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:2000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;";
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
  ov.onclick = (e) => {
    if (e.target === ov) clean(true);
  };
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(true); });
  try {
    scanner = QR.createScanner(
      (data) => {
        clean();
        onDetected(data);
      },
      (err) => {
        msgEl.textContent =
          err.name === "NotAllowedError"
            ? "Camera access denied"
            : "Camera unavailable";
        msgEl.style.color = "#EF4444";
      },
    );
    box.appendChild(scanner.video);
  } catch (_) {
    msgEl.textContent = t("scannerNotSupported");
    msgEl.style.color = "#EF4444";
  }
}

export function showQRAnswerDialog(title, answer, qrSvg) {
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:360px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${escapeHtml(title)}</h3><div id="qr-ans-box" style="text-align:center;margin-bottom:12px;min-height:32px;"></div><textarea id="qr-ans-ta" readonly rows="3" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;font-size:11px;resize:vertical;"></textarea><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="qr-ans-copy" style="padding:6px 14px;border:none;background:#7c3aed;color:white;border-radius:4px;cursor:pointer;">${t("copyAnswer")}</button><button id="qr-ans-close" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("close")}</button></div></div>`;
  document.body.appendChild(ov);
  document.getElementById("qr-ans-ta").value = answer;
  const ansBox = document.getElementById("qr-ans-box");
  if (qrSvg && qrSvg.startsWith("<svg")) {
    safeInsertSvg(ansBox, qrSvg);
    const svg = ansBox.querySelector("svg");
    if (svg) {
      svg.style.maxWidth = "200px";
      svg.style.height = "auto";
    }
  } else {
    ansBox.innerHTML = `<p style="font-size:11px;color:#EF4444;margin:4px 0;">QR too large — use the code below</p>`;
  }
  const clean = () => ov.remove();
  document.getElementById("qr-ans-copy").onclick = () =>
    navigator.clipboard.writeText(answer).catch(() => {});
  document.getElementById("qr-ans-close").onclick = clean;
  ov.onclick = (e) => {
    if (e.target === ov) clean();
  };
}

export function showQRHostDialog(connId, code, compact, link, callbacks) {
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:360px;max-width:420px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("hostGroup")}</h3><div id="qr-host-box" style="text-align:center;margin-bottom:12px;min-height:32px;"></div><textarea id="qr-host-ct" readonly rows="3" style="width:100%;padding:6px;margin-bottom:4px;box-sizing:border-box;font-size:11px;resize:vertical;"></textarea><div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;"><button id="qr-host-link" style="padding:4px 10px;border:1px solid #059669;background:var(--bg-card);color:#059669;border-radius:4px;cursor:pointer;font-size:12px;">${t("copyLink")}</button><button id="qr-host-code" style="padding:4px 10px;border:1px solid #9ca3af;background:var(--bg-card);color:var(--text-dim);border-radius:4px;cursor:pointer;font-size:12px;">${t("copyCode")}</button><button id="qr-host-scan" style="padding:4px 10px;border:1px solid #7c3aed;background:var(--bg-card);color:#7c3aed;border-radius:4px;cursor:pointer;font-size:12px;">${t("scanResponseQR")}</button></div><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="qr-host-paste" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("pasteAnswer")}</button><button id="qr-host-close" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("close")}</button></div></div>`;
  document.body.appendChild(ov);
  document.getElementById("qr-host-ct").value = compact;
  const qrBox = document.getElementById("qr-host-box");
  const qrSvg = generate_qr_svg(link);
  if (qrSvg) {
    safeInsertSvg(qrBox, qrSvg);
    const svg = qrBox.querySelector("svg");
    if (svg) {
      svg.style.maxWidth = "200px";
      svg.style.height = "auto";
    }
  } else {
    qrBox.innerHTML = `<p style="font-size:11px;color:#EF4444;margin:4px 0;">QR too large — use the code below</p>`;
  }

  const clean = () => {
    ov.remove();
  };
  const finalizeAnswer = async (answer) => {
    try {
      let name = "Peer";
      if (!answer.startsWith("a|") && !answer.startsWith("o|")) {
        try {
          name = JSON.parse(answer).display_name || "Peer";
        } catch (_) {}
      }
      await Peer.finalizeConnection(state.pendingConnId || connId, answer);
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
  document.getElementById("qr-host-link").onclick = () =>
    navigator.clipboard.writeText(link).catch(() => {});
  document.getElementById("qr-host-code").onclick = () =>
    navigator.clipboard.writeText(compact).catch(() => {});
  document.getElementById("qr-host-scan").onclick = async () => {
    clean();
    showQRScanDialog(t("scanPeerQR"), finalizeAnswer, () =>
      showQRHostDialog(connId, code, compact, link, callbacks),
    );
  };
  document.getElementById("qr-host-paste").onclick = () => {
    clean();
    showPeerPaste(t("pastePeerAnswer"), finalizeAnswer);
  };
  document.getElementById("qr-host-close").onclick = clean;
  ov.onclick = (e) => {
    if (e.target === ov) clean();
  };
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(); });
}

export function showQRJoinDialog(callbacks) {
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:360px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 12px;">${t("joinPeer")}</h3><p style="font-size:13px;color:var(--text-dim);margin:0 0 16px;">${t("joinPeerDescription")}</p><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="qr-join-scan" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("scanHostQRBtn")}</button><button id="qr-join-paste" style="padding:6px 14px;border:1px solid #2563eb;background:var(--bg-card);color:#2563eb;border-radius:4px;cursor:pointer;">${t("pasteCodeBtn")}</button><button id="qr-join-close" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button></div></div>`;
  document.body.appendChild(ov);
  const clean = () => ov.remove();
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
    ov.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
    ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">${t("joinPeer")}</h3><p style="color:var(--text-dim);font-size:13px;">${t("connecting")}</p></div>`;
    document.body.appendChild(ov);
    try {
      const { setId, compact } = await Peer.acceptOffer(
        code,
        state.user.id,
        state.displayName,
      );
      window._pendingJoinSet = true;
      ov.remove();
      const aqr = generate_qr_svg(compact);
      showQRAnswerDialog("Send Back", compact, aqr);
      if (setId) await callbacks.onSetReceived(setId);
      callbacks.onRenderUI();
    } catch (_) {
      ov.remove();
      await alertDialog("Failed to connect");
    }
  };
  document.getElementById("qr-join-scan").onclick = () => {
    clean();
    showQRScanDialog(t("scanHostQR"), handleCode, () =>
      showQRJoinDialog(callbacks),
    );
  };
  document.getElementById("qr-join-paste").onclick = () => {
    clean();
    showPeerPaste(t("pasteHostOffer"), handleCode);
  };
  document.getElementById("qr-join-close").onclick = clean;
  ov.onclick = (e) => {
    if (e.target === ov) clean();
  };
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(); });
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
    ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:280px;width:min(88vw,400px);box-shadow:0 4px 20px rgba(0,0,0,0.3);"><p style="margin:0 0 16px;font-size:14px;color:var(--text);line-height:1.4;">${escapeHtml(message)}</p><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="cfm-cancel" style="padding:8px 16px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;font-size:14px;">${t("cancel")}</button><button id="cfm-ok" style="padding:8px 16px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:14px;">${t("ok")}</button></div></div>`;
    document.body.appendChild(ov);
    const clean = (v) => { ov.remove(); resolve(v); };
    document.getElementById("cfm-ok").focus();
    document.getElementById("cfm-ok").onclick = () => clean(true);
    document.getElementById("cfm-cancel").onclick = () => clean(false);
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape") clean(false); if (e.key === "Enter") clean(true); });
    ov.onclick = (e) => { if (e.target === ov) clean(false); };
  });
}

export function alertDialog(message) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;";
    ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:280px;width:min(88vw,400px);box-shadow:0 4px 20px rgba(0,0,0,0.3);"><p style="margin:0 0 16px;font-size:14px;color:var(--text);line-height:1.4;">${escapeHtml(message)}</p><div style="display:flex;justify-content:flex-end;"><button id="alt-ok" style="padding:8px 24px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;font-size:14px;">${t("ok")}</button></div></div>`;
    document.body.appendChild(ov);
    const clean = () => { ov.remove(); resolve(); };
    document.getElementById("alt-ok").focus();
    document.getElementById("alt-ok").onclick = clean;
    ov.addEventListener("keydown", (e) => { if (e.key === "Escape" || e.key === "Enter") clean(); });
    ov.onclick = (e) => { if (e.target === ov) clean(); };
  });
}

export function showProgressDialog(title) {
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

export function showIceServerDialog(onSave) {
  const saved = localStorage.getItem("pins-ice-servers");
  let servers = saved ? JSON.parse(saved) : [];
  const savedRelays = (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "").split(",").map(u => u.trim().replace(/\/$/, "")).filter(Boolean);
  let relayUrls = savedRelays.length > 0 ? [...savedRelays] : [];
  const ov = document.createElement("div");
  ov.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  function renderContent() {
    const rows = servers
      .map((s, i) => {
        const urls = Array.isArray(s.urls) ? s.urls.join(",") : s.url || "";
        const uname = s.username || "";
        const cred = s.credential || "";
        return `<div style="display:flex;gap:4px;margin-bottom:6px;align-items:center;">
        <input class="ice-url" data-i="${i}" placeholder="stun:host:port" value="${escapeHtml(urls)}" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;" />
        <input class="ice-user" data-i="${i}" placeholder="username" value="${escapeHtml(uname)}" style="width:80px;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;" />
        <input class="ice-cred" data-i="${i}" placeholder="credential" value="${escapeHtml(cred)}" style="width:80px;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;" />
        <button class="ice-remove" data-i="${i}" style="padding:2px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">×</button>
      </div>`;
      })
      .join("");
    const relayRows = relayUrls.length > 0
      ? relayUrls.map((u, i) => `<div style="display:flex;gap:4px;margin-bottom:4px;align-items:center;">
          <input class="relay-url" data-i="${i}" value="${escapeHtml(u)}" placeholder="wss://signal.catperson.online" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;" />
          <button class="relay-remove" data-i="${i}" style="padding:2px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">×</button>
        </div>`).join("")
      : `<div style="display:flex;gap:4px;margin-bottom:4px;align-items:center;">
          <input class="relay-url" data-i="0" placeholder="wss://signal.catperson.online" style="flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;" />
          <button class="relay-remove" data-i="0" style="padding:2px 6px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">×</button>
        </div>`;
    ov.innerHTML = `<div class="modal-responsive" style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:420px;max-width:480px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 4px;">${t("iceTurnServers")}</h3><p style="font-size:11px;color:var(--text-dim);margin:0 0 4px;">${t("iceDescription")} <a href="https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols" target="_blank" rel="noopener" style="color:#2563eb;">${t("whatIsRTC")}</a></p><div id="ice-rows">${rows}</div><button id="ice-add" style="padding:4px 10px;border:1px dashed #9ca3af;background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:12px;margin-bottom:12px;">${t("addServer")}</button><div style="margin-bottom:12px;border-top:1px solid #e5e7eb;padding-top:8px;"><label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px;">Signal relay servers &middot; <a href="https://github.com/bookenjoyer67/team-pins/blob/main/SELF_HOST.md" target="_blank" rel="noopener" style="color:#2563eb;">self-host guide</a></label><div id="relay-rows">${relayRows}</div><button id="relay-add" style="padding:4px 10px;border:1px dashed #9ca3af;background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:12px;margin-top:4px;">+ Add relay</button></div><div style="margin-bottom:12px;border-top:1px solid var(--border);padding-top:8px;"><label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px;">PMTiles URL (vector basemap)</label>    <input id="pmtiles-url" value="${escapeHtml(localStorage.getItem("pins-pmtiles-url") || "")}" placeholder="https://example.com/map.pmtiles" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;box-sizing:border-box;background:var(--bg-input);color:var(--text);" /></div><div style="margin-bottom:12px;border-top:1px solid var(--border);padding-top:8px;"><label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px;">OSM API Proxy URL</label>    <input id="osm-proxy-url" value="${escapeHtml(localStorage.getItem("pins-osm-proxy") || "")}" placeholder="https://your-relay.example.com/api/proxy/osm" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;box-sizing:border-box;background:var(--bg-input);color:var(--text);" /></div><div style="margin-bottom:12px;border-top:1px solid var(--border);padding-top:8px;"><label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:4px;">Routing Server (OSRM)</label><input id="routing-server-url" value="${escapeHtml(localStorage.getItem("pins-osrm-url") || "https://routing.openstreetmap.de/routed-car")}" placeholder="https://routing.openstreetmap.de/routed-car" style="width:100%;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;box-sizing:border-box;background:var(--bg-input);color:var(--text);" /><select id="routing-profile" style="width:100%;margin-top:4px;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;background:var(--bg-input);color:var(--text);"><option value="car" ${(localStorage.getItem("pins-routing-profile") || "car") === "car" ? "selected" : ""}>Car</option><option value="foot" ${localStorage.getItem("pins-routing-profile") === "foot" ? "selected" : ""}>Walking</option><option value="bike" ${localStorage.getItem("pins-routing-profile") === "bike" ? "selected" : ""}>Cycling</option></select></div><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="ice-reset" style="padding:6px 14px;border:1px solid #dc2626;background:var(--bg-card);color:#dc2626;border-radius:4px;cursor:pointer;">${t("reset")}</button><button id="ice-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;">${t("cancel")}</button><button id="ice-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">${t("save")}</button></div></div>`;
  }
  renderContent();
  document.body.appendChild(ov);
  const clean = () => ov.remove();
  function collectServers() {
    const result = [];
    const urlEls = ov.querySelectorAll(".ice-url");
    const userEls = ov.querySelectorAll(".ice-user");
    const credEls = ov.querySelectorAll(".ice-cred");
    for (let i = 0; i < urlEls.length; i++) {
      const urlVal = urlEls[i].value.trim();
      if (!urlVal) continue;
      const urls = urlVal
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean);
      const entry = { urls: urls };
      const u = userEls[i]?.value.trim();
      const c = credEls[i]?.value.trim();
      if (u) entry.username = u;
      if (c) entry.credential = c;
      result.push(entry);
    }
    return result;
  }
  function syncRelayInputs() {
    const inputs = ov.querySelectorAll(".relay-url");
    relayUrls = [];
    inputs.forEach(inp => {
      const val = inp.value.trim().replace(/\/$/, "");
      if (val) relayUrls.push(val);
    });
  }
  ov.addEventListener("click", (e) => {
    if (e.target.id === "ice-add") {
      servers.push({ urls: ["stun:"] });
      renderContent();
      Array.from(ov.querySelectorAll(".ice-url").values()).pop()?.focus();
      return;
    }
    if (e.target.classList.contains("ice-remove")) {
      servers.splice(parseInt(e.target.dataset.i, 10), 1);
      renderContent();
      return;
    }
    if (e.target.id === "relay-add") {
      syncRelayInputs();
      relayUrls.push("");
      renderContent();
      const inputs = ov.querySelectorAll(".relay-url");
      if (inputs.length > 0) inputs[inputs.length - 1].focus();
      return;
    }
    if (e.target.classList.contains("relay-remove")) {
      relayUrls.splice(parseInt(e.target.dataset.i, 10), 1);
      renderContent();
      return;
    }
    if (e.target.id === "ice-save") {
      servers = collectServers();
      if (servers.length > 0) {
        localStorage.setItem("pins-ice-servers", JSON.stringify(servers));
      } else {
        localStorage.removeItem("pins-ice-servers");
        servers = [];
      }
      const relayInputs = ov.querySelectorAll(".relay-url");
      const urls = [];
      relayInputs.forEach(inp => {
        const val = inp.value.trim().replace(/\/$/, "");
        if (val) urls.push(val);
      });
      import("./relay.js").then(r => r.saveRelayUrls(urls));
      const pmtilesVal = ov.querySelector("#pmtiles-url")?.value.trim() || "";
      if (pmtilesVal) localStorage.setItem("pins-pmtiles-url", pmtilesVal);
      else localStorage.removeItem("pins-pmtiles-url");
      const osmProxyVal = ov.querySelector("#osm-proxy-url")?.value.trim() || "";
      if (osmProxyVal) localStorage.setItem("pins-osm-proxy", osmProxyVal);
      else localStorage.removeItem("pins-osm-proxy");
      const routingUrlVal = ov.querySelector("#routing-server-url")?.value.trim() || "";
      if (routingUrlVal) localStorage.setItem("pins-osrm-url", routingUrlVal);
      else localStorage.removeItem("pins-osrm-url");
      const routingProfileVal = ov.querySelector("#routing-profile")?.value || "car";
      localStorage.setItem("pins-routing-profile", routingProfileVal);
      onSave(servers.length > 0 ? servers : null);
      clean();
      toast(
        servers.length > 0
          ? "Custom ICE servers saved"
          : "Using default servers",
        "#16a34a",
      );
      return;
    }
    if (e.target.id === "ice-reset") {
      servers = [];
      localStorage.removeItem("pins-ice-servers");
      renderContent();
      return;
    }
    if (e.target.id === "ice-cancel" || e.target === ov) clean();
  });
}
