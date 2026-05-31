import init, {
  generate_user_keypair,
  wrap_dek, unwrap_dek, encode_hex,
  generate_qr_svg, generate_uuid,
  generate_signing_keypair, sign, verify,
  encrypt_annotation,
} from "./core/pkg/e2e_core.js";
import * as DB from "./db.js";
import * as Peer from "./peer.js";
import { state } from "./state.js";
import { escapeHtml, toast, showQRAnswerDialog, showIceServerDialog, confirmDialog, alertDialog, promptRoomPassword } from "./dialogs.js";
import { t, setLang, getLang, getSupported } from "./i18n.js";
import { isSoundEnabled, toggleSound, playPeerJoin } from "./sounds.js";
import * as Map from "./map.js";
import { init as initDrawer, initSliders as initDrawerSliders } from "./drawer.js";
import * as Sync from "./sync.js";
import * as Relay from "./relay.js";
import { initPushNotifications, togglePush, isPushEnabled, handlePushInfo } from "./push-sub.js";
import { clearDiscoveryCache } from "./gossip.js";
let Mesh = null;
const votedPins = {};

function clearVotedPins(cid) {
  if (cid && votedPins[cid]) delete votedPins[cid];
}

function bytesToUuid(bytes) {
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}

function saveRelayToList(url) {
  if (!url) return;
  try {
    const parsed = new URL(url.trim());
    if (!["https:", "wss:", "ws:"].includes(parsed.protocol)) return;
  } catch (_) { return; }
  const normalized = url.trim().replace(/\/$/, "");
  const list = Relay.getSavedRelayUrls();
  if (!list.includes(normalized)) {
    list.push(normalized);
    Relay.saveRelayUrls(list);
  }
}

const isEmbed = (() => {
  try {
    const hasParam = new URLSearchParams(window.location.search).get("embed") === "1";
    return hasParam || window.self !== window.top;
  } catch (_) { return false; }
})();
window._isEmbed = isEmbed;

if ("serviceWorker" in navigator) {
  let swRefreshing = false;
  navigator.serviceWorker.register("/sw.js").then(reg => {
    window._swReg = reg;
    console.log("[pwa] SW registered, scope:", reg.scope);
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          const el = document.createElement("div");
          el.textContent = t("updateAvailable") || "Update available — tap to refresh";
          el.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#2563eb;color:white;padding:10px 20px;border-radius:6px;z-index:3001;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,0.3);cursor:pointer;";
          el.onclick = () => {
            if (reg.waiting) { reg.waiting.postMessage({ type: "SKIP_WAITING" }); }
            window.location.reload();
          };
          document.body.appendChild(el);
          setTimeout(() => {
            el.style.opacity = "0";
            el.style.transition = "opacity 0.3s";
            setTimeout(() => el.remove(), 300);
          }, 15000);
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (swRefreshing) return;
      swRefreshing = true;
      window.location.reload();
    });
  }).catch(err => {
    console.warn("[pwa] SW unavailable — expected on dev HTTP:", err.message);
  });

  window._checkForUpdates = async () => {
    if (!navigator.onLine) { toast(t("updateNoConnection") || "No connection", "#f97316"); return; }
    if (!window._swReg) { toast(t("updateNotInstalled") || "Not installed as PWA", "#9ca3af"); return; }
    toast(t("updateChecking") || "Checking for updates…", "#2563eb");
    try {
      await window._swReg.update();
    } catch (_) {
      toast(t("updateFailed") || "Update check failed", "#dc2626");
    }
  };
}

function updateOfflineBar() {
  const bar = document.getElementById("offline-bar");
  if (!bar) return;
  if (navigator.onLine) {
    bar.style.display = "none";
    bar.classList.remove("offline-bar-visible");
    document.body.classList.remove("is-offline");
    return;
  }
  bar.style.display = "flex";
  bar.classList.add("offline-bar-visible");
  document.body.classList.add("is-offline");
}
window.addEventListener("online", updateOfflineBar);
window.addEventListener("offline", updateOfflineBar);
updateOfflineBar();

const MAX_HISTORY = 50;

function clearHistory() {
  state.history.length = 0;
  renderHistory();
}

function addHistory(action, detail) {
  state.history.unshift({ action, detail, time: Date.now() });
  if (state.history.length > MAX_HISTORY) state.history.pop();
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById("history-panel");
  if (!el) return;
  if (state.history.length === 0) { el.innerHTML = ""; return; }
  el.innerHTML = `<h4>${t("history")}</h4>${state.history.map(h => {
    const t = new Date(h.time).toLocaleTimeString();
    return `<div class="hist-item">${escapeHtml(h.action)}: ${escapeHtml(h.detail)}<br><span class="hist-time">${t}</span></div>`;
  }).join("")}`;
  el.scrollTop = 0;
}

const tabId = crypto.randomUUID();

const roomChannel = new BroadcastChannel("piggpin-room");
roomChannel.onmessage = async (e) => {
  if (e.data.tabId === tabId) return;
  if (e.data.type === "answer" && e.data.connId === state.pendingConnId) {
    await Peer.finalizeConnection(state.pendingConnId, e.data.answer);
    hostPeerHandshake(e.data.name || "Peer", state.pendingConnId);
    state.pendingConnId = null;
    renderUI();
    if (await confirmDialog(t("peerConnected"))) {
      Sync.hostGroup();
    }
  }
};

function hostPeerHandshake(name, connId) {
  state.peers.set(connId, { name: name || "Peer", setId: state.currentSet, userId: null });
  renderPeerList();
  Peer.send({ type: "peer_info", data: { display_name: state.displayName, set_id: state.currentSet, user_id: state.user.id } }, connId);
  setTimeout(() => Sync.sendAll(state.currentSet), 500);
}

const topBar = document.getElementById("top-bar");
const tabsEl = document.getElementById("tabs-row");
const menuBtn = document.getElementById("menu-toggle");
let installPrompt = null;
let relayUrl = "";
let _installBannerTimer = null;

function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function showInstallBanner() {
  console.log("[pwa] showInstallBanner called, installPrompt=", !!installPrompt);
  if (window.matchMedia("(display-mode: standalone)").matches) { console.log("[pwa] already standalone, skipping"); return; }
  if (localStorage.getItem("pins-install-dismissed")) { console.log("[pwa] dismissed in localStorage, skipping"); return; }
  if (!isMobile() && !isIOS()) { console.log("[pwa] not mobile, skipping"); return; }

  const existing = document.getElementById("install-banner");
  if (existing) {
    if (installPrompt && !existing.querySelector("#install-banner-do")) {
      console.log("[pwa] upgrading existing banner with install button");
      existing.innerHTML = `<span class="install-banner-icon">📌</span><span>${t("addToHomeScreen")}</span><button class="install-banner-btn" id="install-banner-do">${t("install")}</button><button class="install-banner-close" id="install-banner-dismiss" title="${t("close")}">✕</button>`;
      wireBannerButtons(existing);
    }
    return;
  }

  const banner = document.createElement("div");
  banner.id = "install-banner";
  if (isIOS()) {
    banner.innerHTML = `<span class="install-banner-icon">📌</span><span>${t("addToHomeScreenIOS")}</span><button class="install-banner-close" id="install-banner-dismiss" title="${t("close")}">✕</button>`;
  } else if (installPrompt) {
    console.log("[pwa] showing install button banner");
    banner.innerHTML = `<span class="install-banner-icon">📌</span><span>${t("addToHomeScreen")}</span><button class="install-banner-btn" id="install-banner-do">${t("install")}</button><button class="install-banner-close" id="install-banner-dismiss" title="${t("close")}">✕</button>`;
  } else {
    console.log("[pwa] showing manual instructions banner");
    banner.innerHTML = `<span class="install-banner-icon">📌</span><span>${t("addToHomeScreenManual")}</span><button class="install-banner-close" id="install-banner-dismiss" title="${t("close")}">✕</button>`;
    if (_installBannerTimer) clearTimeout(_installBannerTimer);
    _installBannerTimer = setTimeout(showInstallBanner, 60000);
  }
  document.body.appendChild(banner);
  wireBannerButtons(banner);
}

function wireBannerButtons(banner) {
  const doBtn = banner.querySelector("#install-banner-do");
  if (doBtn) {
    doBtn.onclick = async () => {
      console.log("[pwa] install button clicked, prompt=", !!installPrompt);
      if (installPrompt) {
        try {
          await installPrompt.prompt();
          const result = await installPrompt.userChoice;
          console.log("[pwa] userChoice:", result.outcome);
        } catch(e) { console.error("[pwa] prompt error:", e); }
        installPrompt = null;
        renderUI();
      }
      banner.remove();
    };
  }
  const dismissBtn = banner.querySelector("#install-banner-dismiss");
  if (dismissBtn) {
    dismissBtn.onclick = () => {
      console.log("[pwa] banner dismissed");
      banner.remove();
      localStorage.setItem("pins-install-dismissed", Date.now());
    };
  }
}

function initTheme() {
  const saved = localStorage.getItem("pins-theme");
  if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.body.classList.add("dark");
  }
}
function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("pins-theme", document.body.classList.contains("dark") ? "dark" : "light");
  renderUI();
}
initTheme();

window.addEventListener("beforeinstallprompt", e => { console.log("[pwa] beforeinstallprompt fired"); e.preventDefault(); installPrompt = e; localStorage.removeItem("pins-install-dismissed"); renderUI(); showInstallBanner(); });
console.log("[pwa] listening for beforeinstallprompt, supported:", "BeforeInstallPromptEvent" in window);
window.addEventListener("appinstalled", () => { installPrompt = null; localStorage.setItem("pins-install-dismissed", Date.now()); renderUI(); });
menuBtn.onclick = () => {
  topBar.classList.toggle("hidden");
  menuBtn.textContent = topBar.classList.contains("hidden") ? "☰" : "✕";
  if (isMobile()) {
    let backdrop = document.getElementById("menu-backdrop");
    if (!topBar.classList.contains("hidden")) {
      if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "menu-backdrop";
        backdrop.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:1999;";
        backdrop.onclick = () => {
          topBar.classList.add("hidden");
          menuBtn.textContent = "☰";
          backdrop.remove();
        };
        document.body.appendChild(backdrop);
      }
    } else if (backdrop) {
      backdrop.remove();
    }
  }
};

const wasmReady = init();

Map.initMap();
window._drawerActive = true;
if (!isEmbed) {
  Map.addPinButton();
}
if (isEmbed) Map.addWatermark();

initDrawer();
initDrawerSliders();
renderUI();
wireGlobals();
Relay.setOnCommunityPeerUpdate(() => { renderPeerList(); });

// Stale peer eviction — every 5min evict offline peers unseen > 24h
setInterval(() => {
  const cutoff = Date.now() - 86_400_000;
  for (const [cid, peer] of state.peers) {
    if (cid.startsWith("known_")) continue;
    if (peer.offline && peer.lastSeen && peer.lastSeen < cutoff) {
      state.peers.delete(cid);
    }
  }
}, 300_000);

wasmReady.then(async () => {
  document.getElementById("app-loader")?.remove();


  const savedIce = localStorage.getItem("pins-ice-servers");
  if (savedIce) Peer.setIceServers(JSON.parse(savedIce));
  relayUrl = Relay.getSavedRelayUrls()[0] || localStorage.getItem("pins-relay-url") || "";

  let sigKp = await DB.getSigningKey();
  if (!sigKp) {
    const legacy = localStorage.getItem("pins-signing-key");
    if (legacy) {
      try { sigKp = JSON.parse(legacy); } catch (_) {}
      localStorage.removeItem("pins-signing-key");
    }
    if (!sigKp) {
      sigKp = generate_signing_keypair();
    }
    await DB.saveSigningKey(sigKp);
  }
  state.signingPublicKey = sigKp.public;
  state.signingSecretKey = sigKp.secret;
  DB.setMigrationSigningPubkey(sigKp.public);

  const p = await DB.getProfile();
  if (p) { state.user = { id: p.user_id }; state.displayName = p.display_name || "Me"; }
  else await DB.saveProfile({ user_id: state.user.id, display_name: state.displayName });

  Sync.setupPeer();

  const pendingB64 = localStorage.getItem("pending-community");
  if (pendingB64) {
    try {
      let b64 = pendingB64.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const raw = atob(b64);
      let buf;
      try { buf = new Uint8Array(raw.split("").map(c => c.charCodeAt(0))); } catch (_) {}
      if (buf && buf.length >= 19) {
        let pos = 0;
        const nlen = buf[pos++];
        const name = new TextDecoder().decode(buf.slice(pos, pos + nlen));
        pos += nlen;
        const cid = bytesToUuid(buf.slice(pos, pos + 16));
        pos += 16;
        const relayLen = buf[pos++];
        const relayUrl = relayLen > 0 ? new TextDecoder().decode(buf.slice(pos, pos + relayLen)) : "";
        pos += relayLen;
        const pw = !!(buf[pos] & 1);
        window._pendingCommunity = { cid, n: name, pw, r: relayUrl };
      } else {
        const payload = JSON.parse(raw);
        if (payload.cid && payload.n) window._pendingCommunity = { cid: payload.cid, n: payload.n, pw: !!payload.pw };
      }
    } catch (_) { localStorage.removeItem("pending-community"); }
  }
  if (window._pendingCommunity) {
    toast("Pending invite: " + window._pendingCommunity.n + " — configure a relay to join", "#2563eb");
    setTimeout(() => { if (!Relay.isRelayConnected?.()) Map.showSetsModal?.(); }, 800);
  }

  try {
    const allCommunities = await DB.getAllCommunities();
    for (const c of allCommunities) {
      if (!c.visibility) {
        c.visibility = c.published ? "public" : "local";
        await DB.saveCommunity(c);
      }
    }
  } catch (_) {}

  await Map.loadSetList();

  const knownList = await DB.getKnownPeers();
  for (const kp of knownList) {
    state.peers.set("known_" + kp.user_id, { name: kp.display_name, setId: null, userId: kp.user_id, offline: true });
  }

  window._handlePushInfo = handlePushInfo;

  await Relay.connectAll();
  await initPushNotifications();

  const hasPendingJoin = window.location.hash.startsWith("#community=")
    || window.location.hash.startsWith("#map=")
    || window.location.hash.startsWith("#share=")
    || window.location.hash.startsWith("#join=")
    || window.location.hash.startsWith("#relay=")
    || !!localStorage.getItem("pending-community");
  const last = localStorage.getItem("activeSet");
  const ids = Object.keys(window._names || {});
  if (last && ids.includes(last)) await Map.switchSet(last);
  else if (ids.length > 0) await Map.switchSet(ids[0]);
  else if (!hasPendingJoin) await Map.createTutorial();

  renderUI();

  setTimeout(async () => {
      if (Relay.isRelayConnected() && state.currentSet) {
        await pushAllLocalData();
        await Relay.syncDelta(state.currentSet);
        const allCommunities = await DB.getAllCommunities();
        for (const c of allCommunities) {
          if (c.community_id !== state.currentSet) await Relay.syncDelta(c.community_id);
        }
        await Map.loadPins();
        await Map.loadDrawings();
        toast("Synced with relay", "#16a34a");
      }
      const pendingB64 = localStorage.getItem("pending-community");
      if (pendingB64 && Relay.isRelayConnected()) {
        try {
          let b64 = pendingB64.replace(/-/g, "+").replace(/_/g, "/");
          while (b64.length % 4) b64 += "=";
          const raw = atob(b64);
          let buf;
          try { buf = new Uint8Array(raw.split("").map(c => c.charCodeAt(0))); } catch (_) {}
          let cidUuid, name, pw, restoredRelayUrl = "", inviteTokenRestore = null, focusLat = null, focusLng = null, focusZoom = 15, embeddedCommunitySk = null;
          if (buf && buf.length >= 19) {
            let pos = 0;
            const nlen = buf[pos++];
            name = new TextDecoder().decode(buf.slice(pos, pos + nlen));
            pos += nlen;
            cidUuid = bytesToUuid(buf.slice(pos, pos + 16));
            pos += 16;
            const relayLen = buf[pos++];
            restoredRelayUrl = relayLen > 0 ? new TextDecoder().decode(buf.slice(pos, pos + relayLen)) : "";
            pos += relayLen;
            pw = !!(buf[pos] & 1);
            const isInviteRestore = !!(buf[pos] & 2);
            const hasCommunitySkRestore = !!(buf[pos] & 0x04);
            pos++;
            if (hasCommunitySkRestore && buf.length > pos + 1) {
              const skLen = (buf[pos] << 8) | buf[pos + 1];
              pos += 2;
              if (skLen > 0 && buf.length >= pos + skLen) {
                embeddedCommunitySk = Array.from(buf.slice(pos, pos + skLen)).map(b => b.toString(16).padStart(2, "0")).join("");
                pos += skLen;
              }
            }
            if (isInviteRestore && buf.length > pos) {
              const roleLen = buf[pos++];
              pos += roleLen;
              const dv = new DataView(buf.buffer.slice(pos, pos + 8));
              const expiry = Number(dv.getBigUint64(0, false));
              pos += 8;
              const nonceHex = Array.from(buf.slice(pos, pos + 8)).map(b => b.toString(16).padStart(2, "0")).join("");
              const nonce = nonceHex.slice(0, 8) + "-0000-0000-0000-000000000000";
              pos += 8;
              const sigHex = Array.from(buf.slice(pos, pos + 64)).map(b => b.toString(16).padStart(2, "0")).join("");
              pos += 64;
              inviteTokenRestore = { nonce, role: "", expiry, capabilitySig: sigHex };
            }
            // Parse focus coordinates
            if (!isInviteRestore && buf.length > pos) {
              const focusStr = new TextDecoder().decode(buf.slice(pos));
              const parts = focusStr.split(",");
              if (parts.length >= 2) {
                focusLat = parseFloat(parts[0]);
                focusLng = parseFloat(parts[1]);
                const v = parseInt(parts[2], 10);
                if (parts.length >= 3) focusZoom = isNaN(v) ? 15 : v;
              }
            }
          } else {
            const payload = JSON.parse(raw);
            cidUuid = payload.cid; name = payload.n; pw = !!payload.pw;
          }
          if (cidUuid && name) {
            const result = await joinCommunityFromInvite({
              cidUuid, name, passwordProtected: pw, relayUrl: restoredRelayUrl,
              inviteToken: inviteTokenRestore, embeddedCommunitySk,
              focusLat, focusLng, focusZoom,
              postJoinDelay: 300,
              logTag: "[join]",
            });
            if (result) {
              saveRelayToList(restoredRelayUrl);
              await Map.loadPins();
              await Map.loadDrawings();
              if (result.focusLat !== null && result.focusLng !== null && !isNaN(result.focusLat) && !isNaN(result.focusLng)) {
                state.map?.flyTo([result.focusLat, result.focusLng], result.focusZoom, { duration: 1 });
              }
              if (result.result.needs_key_exchange && !result.isPasswordDerived && !result.myWrappedDek) {
                toast("Joined " + (result.result.name || result.name) + " — awaiting key exchange from an online member", "#f97316");
              } else {
                toast("Joined " + (result.result.name || result.name) + " via link", "#16a34a");
              }
            }
          }
        } catch (e) {
          console.error("[join] auto-join failed:", e.message);
          delete window._pendingCommunity;
          localStorage.removeItem("pending-community");
          toast("Join failed — " + (e.message || "unknown error"), "#dc2626");
        }
      }
    }, 500);

  if (isIOS()) setTimeout(showInstallBanner, 2000);

  if (isMobile() && !isIOS()) {
    setTimeout(showInstallBanner, 10000);

    const onEngage = () => {
      showInstallBanner();
      document.removeEventListener("click", onEngage);
    };
    document.addEventListener("click", onEngage);
  }

  if (window.location.hash.startsWith("#join=")) {
    try {
      let b64 = window.location.hash.slice(6);
      b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const code = atob(b64);
      const { setId, connId, code: answer, compact } = await Peer.acceptOffer(code, state.user.id, state.displayName);
      window._pendingJoinSet = true;
      roomChannel.postMessage({ type: "answer", answer, connId, name: state.displayName, tabId });
      const aqr = generate_qr_svg(compact || answer);
      showQRAnswerDialog("Connection Ready", compact || answer, aqr);
      history.replaceState(null, "", window.location.pathname);
    } catch (e) { console.error("join error:", e); toast("Failed to join: " + (e.message || "unknown"), "#dc2626"); }
  } else if (window.location.hash.startsWith("#map=")) {
    const urlCode = window.location.hash.slice(5);
    history.replaceState(null, "", window.location.pathname);
    const ok = await Sync.importFromHash(urlCode);
    if (ok) toast("Map imported from link", "#16a34a");
    else toast("Invalid or expired share link", "#dc2626");
  } else if (window.location.hash.startsWith("#share=")) {
    const raw = window.location.hash.slice(7);
    history.replaceState(null, "", window.location.pathname);
    const parts = raw.split("@");
    let shareId, relayHost;
    if (parts.length >= 2) {
      let b64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      try { relayHost = atob(b64); } catch (_) {}
      shareId = parts.slice(1).join("@");
    } else {
      shareId = raw;
    }
    if (!relayHost) {
      const stored = (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "").split(",")[0]?.trim();
      if (stored) {
        relayHost = stored.replace(/\/$/, "").replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://").replace(/^https?:\/\//, "");
      }
    }
    if (relayHost) {
      let imported = false;
      for (const scheme of ["https://", "http://"]) {
        try {
          const resp = await fetch(scheme + relayHost + "/share/" + shareId);
          if (resp.ok) {
            const compressed = new Uint8Array(await resp.arrayBuffer());
            if (await Sync.importFromCompressed(compressed)) { imported = true; break; }
          }
        } catch (e) {
          console.warn("[share] fetch failed:", scheme + relayHost + "/share/" + shareId, e.message);
        }
      }
      if (imported) toast("Map imported from share", "#16a34a");
      else toast("Cannot reach share relay", "#dc2626");
    } else {
      toast("No relay configured — cannot fetch share", "#dc2626");
    }
  } else if (window.location.hash.startsWith("#community=")) {
    try {
      let b64 = window.location.hash.slice(11);
      b64 = b64.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const raw = atob(b64);
      let buf;
      try { buf = new Uint8Array(raw.split("").map(c => c.charCodeAt(0))); } catch (_) {}
      let cidUuid, name, linkRelayUrl, passwordProtected, inviteToken = null, focusLat = null, focusLng = null, focusZoom = 15, embeddedCommunitySk = null;
      if (buf && buf.length >= 19) {
        let pos = 0;
        const nameLen = buf[pos++];
        name = new TextDecoder().decode(buf.slice(pos, pos + nameLen));
        pos += nameLen;
        cidUuid = bytesToUuid(buf.slice(pos, pos + 16));
        pos += 16;
        const relayLen = buf[pos++];
        linkRelayUrl = relayLen > 0 ? new TextDecoder().decode(buf.slice(pos, pos + relayLen)) : "";
        pos += relayLen;
        passwordProtected = !!(buf[pos] & 1);
        const isInvite = !!(buf[pos] & 2);
        const hasCommunitySk = !!(buf[pos] & 0x04);
        pos++;
        embeddedCommunitySk = null;
        if (hasCommunitySk && buf.length > pos + 1) {
          const skLen = (buf[pos] << 8) | buf[pos + 1];
          pos += 2;
          if (skLen > 0 && buf.length >= pos + skLen) {
            embeddedCommunitySk = Array.from(buf.slice(pos, pos + skLen)).map(b => b.toString(16).padStart(2, "0")).join("");
            pos += skLen;
          }
        }
        if (isInvite && buf.length > pos) {
          const roleLen = buf[pos++];
          const role = roleLen > 0 ? new TextDecoder().decode(buf.slice(pos, pos + roleLen)) : "contributor";
          pos += roleLen;
          const dv = new DataView(buf.buffer.slice(pos, pos + 8));
          const expiry = Number(dv.getBigUint64(0, false));
          pos += 8;
          const nonceHex = Array.from(buf.slice(pos, pos + 8)).map(b => b.toString(16).padStart(2, "0")).join("");
          const nonce = nonceHex.slice(0, 8) + "-0000-0000-0000-000000000000";
          pos += 8;
          const sigHex = Array.from(buf.slice(pos, pos + 64)).map(b => b.toString(16).padStart(2, "0")).join("");
          pos += 64;
          inviteToken = { nonce, role, expiry, capabilitySig: sigHex };
        }
        // Parse focus coordinates if trailing data exists (from location QR markers)
        if (!isInvite && buf.length > pos) {
          const focusStr = new TextDecoder().decode(buf.slice(pos));
          const parts = focusStr.split(",");
          if (parts.length >= 2) {
            focusLat = parseFloat(parts[0]);
            focusLng = parseFloat(parts[1]);
            if (parts.length >= 3) focusZoom = parseInt(parts[2], 10) || 15;
          }
        }
      } else {
        try {
          const payload = JSON.parse(raw);
          if (!payload.cid || !payload.n) throw new Error("invalid");
          cidUuid = payload.cid; name = payload.n; passwordProtected = !!payload.pw;
          linkRelayUrl = payload.r || (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url") || "").split(",")[0]?.trim();
        } catch (e) { toast("Invalid community link", "#dc2626"); return; }
      }

      if (!linkRelayUrl && !Relay.isRelayConnected?.()) {
        localStorage.setItem("pending-community", b64);
        window._pendingCommunity = { cid: cidUuid, n: name, pw: passwordProtected, invite: inviteToken };
        toast("Community link saved — " + name + ". Configure a relay to join.", "#2563eb");
        Map.loadSetList?.();
        history.replaceState(null, "", window.location.pathname);
        return;
      }

      localStorage.setItem("pending-community", b64);

      if (linkRelayUrl) {
        const needConnect = !Relay.isRelayConnected?.();
        if (needConnect) {
          Relay.connect(linkRelayUrl);
          saveRelayToList(linkRelayUrl);
        }
        await new Promise(r => setTimeout(r, needConnect ? 1200 : 500));
      }

      if (!Relay.isRelayConnected?.()) {
        toast("Cannot connect to relay", "#dc2626"); return;
      }

      const joinResult = await joinCommunityFromInvite({
        cidUuid, name, passwordProtected, relayUrl: linkRelayUrl,
        inviteToken, embeddedCommunitySk,
        focusLat, focusLng, focusZoom,
        postJoinDelay: 500,
        logTag: "[join-hash]",
      });
      if (joinResult) {
        history.replaceState(null, "", window.location.pathname);
        await Map.loadSetList();
        await Map.loadPins();
        await Map.loadDrawings();
        if (joinResult.focusLat !== null && joinResult.focusLng !== null && !isNaN(joinResult.focusLat) && !isNaN(joinResult.focusLng)) {
          state.map?.flyTo([joinResult.focusLat, joinResult.focusLng], joinResult.focusZoom, { duration: 1 });
        }
        if (joinResult.result.needs_key_exchange && !joinResult.isPasswordDerived && !joinResult.myWrappedDek) {
          toast("Joined " + (joinResult.result.name || joinResult.name) + " — awaiting key exchange from an online member", "#f97316");
        } else {
          toast("Joined " + (joinResult.result.name || joinResult.name) + " via link", "#16a34a");
        }
      }
    } catch (e) { console.error("community link error:", e); toast("Invalid community link: " + (e.message || e), "#dc2626"); }
  } else if (window.location.hash.startsWith("#relay=")) {
    try {
      const params = new URLSearchParams(window.location.hash.slice(1).replace("relay=", "relay="));
      const url = params.get("relay");
      const room = params.get("room");
      if (url && room) {
        history.replaceState(null, "", window.location.pathname);
        Sync.joinPeerViaRelay(decodeURIComponent(url), room);
      }
    } catch (e) { console.error("relay join error:", e); toast("Relay join failed: " + (e.message || "unknown"), "#dc2626"); }
  }

  // Handle PWA app shortcut actions
  const action = new URLSearchParams(window.location.search).get("action");
  if (action === "maps") {
    setTimeout(() => Map.showSetsModal(), 600);
  } else if (action === "new") {
    setTimeout(() => {
      const name = prompt(t("newMapPrompt") || "New map name:")?.trim();
      if (name) Map.createSet(name);
    }, 600);
  } else if (action === "join") {
    setTimeout(() => window._showJoinModal?.(), 600);
  }
}).catch(err => {
  document.getElementById("app-loader")?.remove();
  document.getElementById("map-container").innerHTML =
    `<p style="color:red;padding:20px">Failed: ${escapeHtml(err.message)}</p>`;
});

// Shared community join logic — used by both pending-community auto-join
// and the #community= hash fragment handler.
async function joinCommunityFromInvite({
  cidUuid, name, passwordProtected, relayUrl,
  inviteToken, embeddedCommunitySk,
  focusLat, focusLng, focusZoom,
  postJoinDelay = 500,
  logTag = "[join-hash]",
}) {
  let passHash = null;
  let plaintextPass = null;

  if (passwordProtected) {
    const { hashCommunityPassword } = await import("./dialogs.js");
    const pass = await promptRoomPassword("This community requires a password to join");
    if (!pass) { localStorage.removeItem("pending-community"); return; }
    plaintextPass = pass;
    passHash = await hashCommunityPassword(pass, cidUuid);
  }

  let result;
  if (inviteToken) {
    const claimResult = await Relay.claimMembership(cidUuid, state.signingPublicKey, state.displayName, inviteToken.nonce, inviteToken.capabilitySig);
    if (claimResult && claimResult.error) { toast("Invite claim failed: " + claimResult.error, "#dc2626"); return; }
    result = await Relay.joinCommunity(cidUuid, passHash, relayUrl);
  } else {
    result = await Relay.joinCommunity(cidUuid, passHash, relayUrl);
  }

  if (!plaintextPass && result && (result.error === "wrong_password" || result.key_derivation === "pbkdf2")) {
    const pass = await promptRoomPassword("This community requires a password to join");
    if (!pass) { localStorage.removeItem("pending-community"); return; }
    plaintextPass = pass;
    const { hashCommunityPassword } = await import("./dialogs.js");
    passHash = await hashCommunityPassword(pass, cidUuid);
    result = await Relay.joinCommunity(cidUuid, passHash, relayUrl);
  }

  if (result && result.error === "wrong_password") { toast("Wrong password", "#dc2626"); return; }

  const isPasswordDerived = result && result.key_derivation === "pbkdf2";
  if (!result) {
    toast(relayUrl ? "Cannot reach community on relay — check relay URL" : "No relay connection — configure in ⚙ ICE settings", "#dc2626"); return;
  }
  if (!result.public_key || !result.wrapped_dek) {
    toast("Community not found on relay", "#dc2626"); return;
  }

  const sid = result.community_id;
  let public_key = result.public_key;
  let secret_key = "";
  let myWrappedDek = result.individually_wrapped_dek || "";

  if (isPasswordDerived && plaintextPass) {
    const { generate_user_keypair_from_password, encode_hex } = await import("./core/pkg/e2e_core.js");
    const kp = generate_user_keypair_from_password(plaintextPass, sid);
    public_key = encode_hex(kp.public);
    secret_key = encode_hex(kp.secret);
    myWrappedDek = result.wrapped_dek;
  } else {
    const { generate_user_keypair, wrap_dek, unwrap_dek, encode_hex, decrypt_with_password, decode_hex } = await import("./core/pkg/e2e_core.js");
    const kp = generate_user_keypair();
    public_key = encode_hex(kp.public);
    secret_key = encode_hex(kp.secret);

    if (embeddedCommunitySk && !myWrappedDek) {
      try {
        const dk = unwrap_dek(result.wrapped_dek, embeddedCommunitySk);
        if (dk) {
          myWrappedDek = wrap_dek(dk, public_key);
          import("./relay.js").then(r => {
            r.rewrapMemberDek(sid, public_key, myWrappedDek);
          }).catch(e => { console.warn("DEK rewrap failed:", e); });
        }
      } catch (e) {
        console.warn(logTag, "SK unwrap fallback failed:", e.message);
      }
    }

    if (!myWrappedDek && result.join_wrapped_dek) {
      try {
        const parts = result.join_wrapped_dek.split(":");
        if (parts.length === 3) {
          const dekHex = decrypt_with_password(parts[0], parts[1], parts[2], sid);
          const dkBytes = decode_hex(dekHex);
          myWrappedDek = wrap_dek(dkBytes, public_key);
          import("./relay.js").then(r => {
            r.rewrapMemberDek(sid, public_key, myWrappedDek);
      }).catch(() => { toast(t("searchUnavailableOffline") || "Search unavailable", "#dc2626"); });
        }
      } catch (e) {
        console.warn(logTag, "bootstrap DEK unwrap failed:", e.message);
      }
    }

    if (!myWrappedDek) {
      Relay.requestMemberDek(sid, public_key);
    }
  }

  const existing = await DB.getTeam(sid);
  if (!existing) {
    await DB.saveTeam({ team_id: sid, name: result.name || name, public_key, secret_key, wrapped_dek: myWrappedDek || result.wrapped_dek, key_derivation: result.key_derivation || "random", community_secret_key: embeddedCommunitySk || "", community_wrapped_dek: result.wrapped_dek || "" });
    await DB.saveCommunity({ community_id: sid, name: result.name || name, description: result.description || "", genesis_public_key: result.genesis_public_key || "", visibility: "private", members: result.members || [], governance: result.governance || { contribution: "open", validation: "none", schema_authority: "any_member", key_rotation: "founder_only", fork_policy: "allowed", join_policy: "open" }, bounds: result.bounds || null, relay_nodes: [], relay_url: relayUrl || null });
    await DB.saveLayers(sid, [{ layer_id: generate_uuid(), name: "Default", color: "#2563eb", visible: true, opacity: 1.0 }]);
    window._names[sid] = (result.name || name) + " (← joined)";
  }

  delete window._pendingCommunity;
  localStorage.removeItem("pending-community");

  // Caller-provided post-join hook (Block A: saveRelayToList; Block B: history.replaceState + loadSetList)
  await Map.switchSet(sid);
  await Relay.syncDelta(sid);
  await new Promise(r => setTimeout(r, postJoinDelay));

  // let caller do additional setup before loading pins
  return { sid, result, isPasswordDerived, myWrappedDek, name, focusLat, focusLng, focusZoom };
}

// Keyboard shortcuts
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
  if (document.querySelector("[style*='z-index:2'][style*='position:fixed']") && !window._slideshowActive) return;
  const key = e.key;

  // Slideshow shortcuts
  if (window._slideshowActive) {
    if (key === " " || key === "Spacebar") { e.preventDefault(); window._slideshowTogglePlay?.(); return; }
    if (key === "ArrowLeft") { e.preventDefault(); window._slideshowGoTo?.((window._slideshowCurrent ?? 0) - 1); return; }
    if (key === "ArrowRight") { e.preventDefault(); window._slideshowGoTo?.((window._slideshowCurrent ?? 0) + 1); return; }
    if (key === "Escape") { e.preventDefault(); window._slideshowExit?.(); return; }
    if (key === "f" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); window._slideshowToggleFullscreen?.(); return; }
  }

  if (key === "n" || key === "N") { if (!isEmbed) { Map.placePin(); e.preventDefault(); } }
  if (key === "Escape") { state.map?.closePopup(); Map.clearSelection?.(); e.preventDefault(); }
  if (key === "Delete" || key === "Backspace") { if (!isEmbed) { Map.deleteSelected?.(); e.preventDefault(); } }
  if (key === "d" && !e.ctrlKey && !e.metaKey) { toggleTheme(); e.preventDefault(); }
  if (e.ctrlKey && key === "z") { if (!isEmbed) { Map.undo?.(); e.preventDefault(); } }
  if (e.ctrlKey && (e.code === "KeyY" || (key === "z" && e.shiftKey))) { if (!isEmbed) { Map.redo?.(); e.preventDefault(); } }
});

function wireGlobals() {
  window._names = window._names || {};
  window._broadcast = Sync.broadcast;
  window._addHistory = addHistory;
  window._clearHistory = clearHistory;
  window._clearDiscoveryCache = clearDiscoveryCache;
  window._renderUI = renderUI;
  window._renderPeerList = renderPeerList;
  window._showHostModal = showHostModal;
  window._showJoinModal = showJoinModal;
  window._showIceDialog = () => showIceServerDialog(servers => { Peer.setIceServers(servers); relayUrl = Relay.getSavedRelayUrls()[0] || localStorage.getItem("pins-relay-url") || ""; });
  window._toggleSound = toggleSound;
  window._isSoundEnabled = () => { try { return isSoundEnabled(); } catch (_) { return false; } };
  window._toggleTheme = toggleTheme;
  window._togglePush = togglePush;
  window._isPushEnabled = isPushEnabled;
  window._loadPins = Map.loadPins;
  window._loadDrawings = Map.loadDrawings;
  window._loadSetList = Map.loadSetList;
  window._switchSet = Map.switchSet;
  window._createSet = Map.createSet;
  window._showLayersModal = Map.showLayersModal;
  window._showSchemaManagerModal = Map.showSchemaManagerModal;
  window._refreshAllLayers = Map.refreshAllLayers;
  window._createTutorial = Map.createTutorial;
  window._startSlideshow = Map.startSlideshow;
  window._startCurrentMapSlideshow = Map.startCurrentMapSlideshow;
  window._refreshPinPopup = Map.refreshPinPopup;
  window._refreshPinMarkerPopup = Map.refreshPinMarkerPopup;
  window._renderAnnotationThread = Map.renderAnnotationThread;
  window._broadcastAnnotation = Sync.broadcastAnnotation;
  window._broadcastAnnotationVote = Sync.broadcastAnnotationVote;
  window._broadcastTombstone = Sync.broadcastTombstone;
  window._relayConnect = Relay.connect;
  window._relaySyncDelta = Relay.syncDelta;
  window._relayPushDelta = Relay.pushDelta;
  window._clearVotedPins = clearVotedPins;
  window._relayIsConnected = Relay.isRelayConnected;
  window._relayDisconnect = Relay.disconnect;
  window._relayPublishCommunity = Relay.publishCommunity;
  window._relayUnpublishCommunity = Relay.unpublishCommunity;
  window._relayFetchCommunityList = Relay.fetchCommunityList;
  window._relayQueryCommunities = Relay.queryCommunities;
  window._relayJoinCommunity = Relay.joinCommunity;
  window._relayPublishLayer = Relay.publishLayer;
  window._relaySubscribeLayer = Relay.subscribeLayer;
  window._relaySyncSubscribedLayers = Relay.syncSubscribedLayers;
  window._relayListPublicLayers = Relay.listPublicLayers;
  window._loadSubscribedPins = Map.loadSubscribedPins;
  window._loadLayersForSet = Map.loadLayersForSet;
  window._loadSchemasForSet = Map.loadSchemasForSet;
  window._relayDeleteCommunity = Relay.deleteCommunity;
  window._disconnectCommunity = (setId) => {
    for (const [connId, peer] of state.peers) {
      if (peer.setId === setId) {
        Peer.closeConnection(connId);
        state.peers.delete(connId);
      }
    }
    window._renderUI?.();
  };
  window._relayGetCommunityPeers = Relay.getCommunityPeers;
  window._getSavedRelays = Relay.getSavedRelayUrls;
  window._broadcastPinVote = Sync.broadcastPinVote;
  window._showDiscoverModal = Map.showDiscoverModal;
  window._pushAllLocalData = pushAllLocalData;
  window._generateLocationMarker = Map.generateLocationMarker;
  window._toast = toast;
}

// --- Click handler sub-routines (extracted for readability) ---

async function handleAttest(b) {
  const pid = b.dataset.pid;
  if (!pid || !state.signingSecretKey) return;
  const row = await DB.getPin(pid).catch(() => null);
  if (!row) { toast("Pin no longer exists", "#f97316"); return; }
  if (row.author_pubkey && row.author_pubkey === state.signingPublicKey && !row.posted_anonymously) {
    toast("Cannot attest your own pin", "#f97316"); return;
  }
  try {
    const attType = b.matches(".attest-confirm-btn") ? "confirmed" : b.matches(".attest-dispute-btn") ? "disputed" : "flagged";
    row.attestations = row.attestations || [];
    const existingIdx = row.attestations.findIndex(a => a.pubkey === state.signingPublicKey);
    const ts = Date.now();
    const sig = sign(pid + "|" + attType + "|" + ts, state.signingSecretKey);
    const att = { pubkey: state.signingPublicKey, type: attType, timestamp: ts, signature: sig };
    if (existingIdx >= 0) {
      if (row.attestations[existingIdx].type === attType) { toast("Already attested", "#f97316"); return; }
      row.attestations[existingIdx] = att;
    } else {
      row.attestations.push(att);
    }
    const gov = state.currentCommunity?.governance || {};
    if (gov.ttl_enabled) {
      if (!row.ttl_base_at) row.ttl_base_at = row.created_at || ts;
      const atts = row.attestations;
      const up = atts.filter(a => a.type === "confirmed").length;
      const down = atts.filter(a => a.type === "disputed").length + atts.filter(a => a.type === "flagged").length;
      let mins = (gov.ttl_base_mins || 10080) + ((up - down) * (gov.ttl_vote_mins || 360));
      mins = Math.max(gov.ttl_min_mins || 60, Math.min(gov.ttl_max_mins || 43200, mins));
      row.ttl_expires_at = row.ttl_base_at + (mins * 60000);
      const dir = attType === "confirmed" ? 1 : -1;
      window._broadcastPinVote?.(pid, dir);
      if (down >= 7 && down > up) {
        await DB.deletePin(pid);
        window._broadcast?.("delete_pin", { pin_id: pid });
        Map.refreshPinMarkerPopup(state.markers?.find(m => m._pinId === pid));
        toast("Pin auto-removed by community attestation consensus", "#f97316");
        return;
      }
    }
    await DB.savePin(row);
    window._broadcast?.("new_pin", { ...row, team_id: state.currentSet });
    Map.refreshPinMarkerPopup(state.markers?.find(m => m._pinId === pid));
    const labels = { confirmed: "Confirmed", disputed: "Disputed", flagged: "Flagged" };
    toast(labels[attType] || "Attested", "#16a34a");
  } catch (e) { console.warn("Attest failed:", e); toast("Failed to attest", "#dc2626"); }
}

async function handleAnnotationSubmit(b) {
  if (b.disabled) return;
  const thread = b.closest(".annotation-thread");
  if (!thread) return;
  const pinId = thread.dataset.pinId;
  const input = thread.querySelector(".ann-input");
  const text = input?.value?.trim();
  if (!text || !state.currentSet || !state.dek) return;
  b.disabled = true;
  b.textContent = "...";
  const annId = generate_uuid();
  try {
    const enc = encrypt_annotation(text, state.displayName, "comment", null, state.dek);
    const annotation = {
      annotation_id: annId, pin_id: pinId, community_id: state.currentSet,
      ciphertext: enc.ciphertext, nonce: enc.nonce,
      author_pubkey: state.signingPublicKey, created_at: Date.now(), votes: [],
    };
    await DB.saveAnnotation(annotation);
    Sync.broadcastAnnotation(annotation);
    if (input) input.value = "";
    Map.renderAnnotationThread(pinId);
    addHistory("Comment added", text.slice(0, 30));
  } catch (e) { console.warn("Comment post failed:", e); toast("Failed to post comment", "#dc2626"); }
  b.disabled = false;
  b.textContent = "Post";
}

async function handleAnnotationVote(b) {
  const annId = b.dataset.annId;
  const direction = b.classList.contains("ann-up") ? "up" : "down";
  if (!state.signingPublicKey || !state.signingSecretKey) { toast("Signing key not ready", "#f97316"); return; }
  try {
    const ann = await DB.getAnnotation(annId);
    if (!ann) return;
    ann.votes = ann.votes || [];
    const existingIdx = ann.votes.findIndex(v => v.pubkey === state.signingPublicKey);
    const ts = Date.now();
    const payload = encode_hex(new TextEncoder().encode(annId + "|" + direction + "|" + ts));
    const sig = sign(payload, state.signingSecretKey);
    const vote = { pubkey: state.signingPublicKey, direction, timestamp: ts, signature: sig };
    if (existingIdx >= 0) ann.votes[existingIdx] = vote;
    else ann.votes.push(vote);
    await DB.saveAnnotation(ann);
    Sync.broadcastAnnotationVote(annId, vote);
    Map.renderAnnotationThread(ann.pin_id);
  } catch (_) { toast("Failed to vote", "#dc2626"); }
}

async function handleAnnotationDelete(b) {
  const annId = b.dataset.annId;
  const ann = await DB.getAnnotation(annId);
  if (!ann) return;
  if (ann.author_pubkey && ann.author_pubkey !== state.signingPublicKey) {
    toast("Not authorized to delete this comment", "#dc2626"); return;
  }
  if (!(await confirmDialog("Remove this comment?"))) return;
  const tombId = generate_uuid();
  const ts = Date.now();
  const payload = encode_hex(new TextEncoder().encode(annId + "|" + tombId + "|" + ts));
  try {
    const sig = sign(payload, state.signingSecretKey);
    const tombstone = { tombstone_id: tombId, target_id: annId, by_pubkey: state.signingPublicKey, reason: "author_removed", timestamp: ts, signature: sig };
    await DB.saveTombstone(tombstone);
    Sync.broadcastTombstone(tombstone);
    Map.renderAnnotationThread(ann.pin_id);
    addHistory("Comment removed", annId.slice(0, 8));
  } catch (_) { toast("Failed to remove comment", "#dc2626"); }
}

document.addEventListener("click", async e => { try {
  if (e.target.closest(".metric-toggle")) {
    e.preventDefault();
    e.stopPropagation();
    Map.toggleMetricMode();
    const box = e.target.closest(".metrics-box");
    if (box && box.dataset.json) {
      try {
        const g = JSON.parse(decodeURIComponent(box.dataset.json));
        box.outerHTML = Map.geomMetrics(g);
      } catch (_) {}
    }
    return;
  }
  const b = e.target.closest("button");
  if (!b) {
    const a = e.target.closest(".dwg-attachment");
    if (a) { e.preventDefault(); Map.downloadDrawingAttachment(a.dataset.did); }
    const dlBtn = e.target.closest(".download-media-btn");
    if (dlBtn) { e.preventDefault(); Map.downloadPinMedia(dlBtn.dataset.pid); }
    return;
  }
  if (b.matches(".edit-pin-btn")) { e.stopPropagation(); Map.showEditPinForm(b.dataset.pid); return; }
  if (b.matches(".delete-pin-btn")) { e.stopPropagation(); if (await confirmDialog(t("deleteConfirm"))) { await Map.deletePin(b.dataset.pid); state.map.closePopup(); } return; }
  if (b.matches(".edit-dwg-btn")) { e.stopPropagation(); Map.showEditDrawingForm(b.dataset.did); return; }
  if (b.matches(".delete-dwg-btn")) { e.stopPropagation(); if (await confirmDialog(t("deleteConfirm"))) { await Map.deleteDrawing(b.dataset.did); state.map.closePopup(); } return; }
  if (b.matches(".pin-expand-btn")) { e.stopPropagation(); Map.showPinDetailModal(b.dataset.pid); return; }

  if (b.matches(".attest-confirm-btn") || b.matches(".attest-dispute-btn") || b.matches(".attest-flag-btn")) {
    e.stopPropagation();
    await handleAttest(b);
    return;
  }
  if (b.matches(".ann-submit-btn")) {
    e.stopPropagation();
    await handleAnnotationSubmit(b);
    return;
  }
  if (b.matches(".ann-vote-btn")) {
    e.stopPropagation();
    handleAnnotationVote(b);
    return;
  }
  if (b.matches(".ann-delete-btn")) {
    e.stopPropagation();
    await handleAnnotationDelete(b);
    return;
  }
} catch(err) { console.error("[click handler]", err); } });

export function renderUI() {
  try {
  const nm = window._names?.[state.currentSet] || t("noMap");
  const activeLayer = state.layers.find(l => l.layer_id === state.activeLayerId);
  const activeLabel = activeLayer ? `<span style="font-size:10px;color:${activeLayer.color};margin-left:4px;">→ ${escapeHtml(activeLayer.name.slice(0, 12))}</span>` : "";
  const hasPeers = [...state.peers.values()].some(p => p.setId === state.currentSet && !p.offline);
  const isCommunity = state.currentCommunity?.visibility && state.currentCommunity.visibility !== "local";
  const dot = (hasPeers ? ' <span style="color:#16a34a;font-size:9px;">●</span>' : "") + (isCommunity ? ' <span style="color:#2563eb;font-size:9px;">●</span>' : "");
  const count = Peer.connectionCount();

  const meshOn = Mesh?.isMeshConnected?.() || false;
  const meshCount = Mesh?.meshPeerCount?.() || 0;

  // Thin top bar
  const peerLabel = count > 0 ? `<span style="font-size:11px;color:#16a34a;">● ${count}</span>` : `<span style="font-size:11px;color:#9ca3af;">0</span>`;
  const meshLabel = meshOn ? `<span style="font-size:11px;color:#16a34a;margin-left:4px;">📡 ${meshCount || ""}</span>` : "";
  tabsEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;font-size:13px;background:var(--bg-glass);backdrop-filter:blur(4px);border-bottom:1px solid var(--border);">
    <div style="display:flex;align-items:center;gap:8px;overflow:hidden;flex:1;min-width:0;">
      <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;">${escapeHtml(nm.slice(0, 30))}${dot}${activeLabel}</span>
      <div style="display:flex;align-items:center;gap:4px;flex:1;max-width:240px;">
        <input id="topbar-search" type="text" placeholder="${t("searchPlaces") || "Search places..."}" style="flex:1;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:12px;min-width:0;">
        <button id="topbar-search-btn" style="width:24px;height:24px;border:none;background:transparent;color:var(--text-dim);cursor:pointer;font-size:13px;padding:0;border-radius:3px;flex-shrink:0;">🔍</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
      ${peerLabel}${meshLabel}
      <button id="topbar-slideshow-btn" style="width:26px;height:26px;border:none;background:transparent;color:var(--text-dim);cursor:pointer;font-size:14px;padding:0;border-radius:4px;" title="${t("slideshow") || "Slideshow"}">▶</button>
      <button id="drawer-toggle-btn" style="width:28px;height:28px;border:none;background:transparent;color:var(--text-dim);cursor:pointer;font-size:18px;padding:0;border-radius:4px;">≡</button>
    </div>
  </div>`;

  // Wire combined search: pin filter on type, OSM geocode on Enter / button click
  const topbarSearch = document.getElementById("topbar-search");
  if (topbarSearch) {
    let _searchTimer = null;
    topbarSearch.oninput = () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        const q = topbarSearch.value.toLowerCase().trim();
        const markers = state.markers;
        for (let i = 0; i < markers.length; i++) {
          const match = !q || (state.pinSearchText[i] && state.pinSearchText[i].includes(q));
          markers[i].setOpacity(match ? markers[i]._layerOpacity ?? 1 : 0.15);
        }
      }, 200);
    };
    const doGeocode = () => {
      const q = topbarSearch.value.trim();
      if (q.length < 2) return;
      if (!navigator.onLine) { toast(t("searchUnavailableOffline") || "Search unavailable offline"); return; }
      const now = Date.now();
      if (now - (state._nominatimLastCall || 0) < 2000) return;
      state._nominatimLastCall = now;
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`;
      fetch(url, { headers: { "User-Agent": "piggPin/0.0.1" } }).then(r => r.json()).then(results => {
        if (!results.length) return;
        const bbox = results[0].boundingbox;
        if (bbox) state.map.fitBounds([[bbox[0], bbox[2]], [bbox[1], bbox[3]]]);
        else state.map.setView([results[0].lat, results[0].lon], 15);
      }).catch(() => {});
    };
    topbarSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doGeocode(); }
      else if (e.key === "Escape") { topbarSearch.value = ""; topbarSearch.oninput?.(); }
    });
    const topbarSearchBtn = document.getElementById("topbar-search-btn");
    if (topbarSearchBtn) topbarSearchBtn.onclick = () => doGeocode();
  }

  document.getElementById("drawer-toggle-btn").onclick = (e) => {
    e.stopPropagation();
    const existing = document.getElementById("data-popout");
    if (existing) { existing.remove(); return; }
    const btn = document.getElementById("drawer-toggle-btn");
    const rect = btn.getBoundingClientRect();
    const popout = document.createElement("div");
    popout.id = "data-popout";
    popout.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right - 50}px;z-index:3000;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.2);min-width:160px;padding:4px;`;
    popout.innerHTML = `
      <button class="data-popout-item" data-action="maps" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:4px;">🗺 Maps</button>
      <button class="data-popout-item" data-action="layers" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:4px;">📑 Layers</button>
      <button class="data-popout-item" data-action="schemas" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:4px;">📋 Schemas</button>
    `;
    document.body.appendChild(popout);
    popout.querySelectorAll(".data-popout-item").forEach(item => {
      item.onclick = (ev) => {
        ev.stopPropagation();
        popout.remove();
        const action = item.dataset.action;
        if (action === "maps") Map.showSetsModal();
        if (action === "layers") Map.showLayersModal();
        if (action === "schemas") Map.showSchemaManagerModal();
      };
      item.onmouseenter = () => { item.style.background = "var(--bg-input)"; };
      item.onmouseleave = () => { item.style.background = "transparent"; };
    });
    setTimeout(() => {
      const close = (ev) => {
        if (!document.body.contains(popout)) { document.removeEventListener("click", close); return; }
        if (!popout.contains(ev.target)) { popout.remove(); document.removeEventListener("click", close); }
      };
      document.addEventListener("click", close);
    }, 0);
  };

  topBar.innerHTML = "";
  topBar.classList.add("hidden");

  const slideshowBtn = document.getElementById("topbar-slideshow-btn");
  if (slideshowBtn) slideshowBtn.onclick = () => Map.startCurrentMapSlideshow();

  renderPeerList();
  } catch(e) { console.error("renderUI failed:", e); }
}

function showMeshInbox() {
  const items = Mesh?.getInbox?.() || [];
  if (items.length === 0) return;

  const existing = document.getElementById("mesh-inbox-overlay");
  if (existing) { existing.remove(); return; }

  const ov = document.createElement("div");
  ov.id = "mesh-inbox-overlay";
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.onclick = e => { if (e.target === ov) ov.remove(); };

  const rows = items.map(item => {
    const peer = Mesh?.getMeshPeers?.().find(p => p.id === item.from);
    const name = peer?.name || `Node ${item.from}`;
    const time = new Date(item.ts).toLocaleTimeString();
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);${item.accepted ? "opacity:0.5" : ""}">
      <div style="flex:1">
        <span style="font-weight:600;">${escapeHtml(name)}</span>
        <span style="color:var(--text-dim);font-size:11px;margin-left:8px;">${escapeHtml(item.type)}</span>
        <br><span style="font-size:10px;color:var(--text-dim);">${time}</span>
      </div>
      <div style="display:flex;gap:4px;">
        ${!item.accepted ? `<button class="inbox-accept" data-id="${item.id}" style="padding:3px 8px;border:none;background:#16a34a;color:#fff;border-radius:3px;cursor:pointer;font-size:11px;">✓</button>` : ""}
        <button class="inbox-dismiss" data-id="${item.id}" style="padding:3px 8px;border:1px solid var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;font-size:11px;">✕</button>
      </div>
    </div>`;
  }).join("");

  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:340px;max-width:440px;max-height:70vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">📥 Mesh Inbox</h3>
      <div style="display:flex;gap:4px;">
        <button id="inbox-accept-all" style="padding:4px 10px;border:none;background:#16a34a;color:#fff;border-radius:3px;cursor:pointer;font-size:11px;">Accept All</button>
        <button id="inbox-close" style="padding:4px 8px;border:1px solid var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;">✕</button>
      </div>
    </div>
    <div id="inbox-list">${rows || '<div style="color:var(--text-dim);text-align:center;padding:20px;">Empty</div>'}</div>
  </div>`;
  document.body.appendChild(ov);

  ov.querySelector("#inbox-close").onclick = () => ov.remove();
  ov.querySelector("#inbox-accept-all").onclick = () => {
    Mesh?.acceptAllInbox();
    ov.remove();
  };
  ov.querySelectorAll(".inbox-accept").forEach(btn => {
    btn.onclick = () => {
      Mesh?.acceptInboxItem(btn.dataset.id);
      ov.remove();
    };
  });
  ov.querySelectorAll(".inbox-dismiss").forEach(btn => {
    btn.onclick = () => {
      Mesh?.dismissInboxItem(btn.dataset.id);
      ov.remove();
      if (Mesh?.getInboxUnread() > 0 || Mesh?.getInbox().length > 0) showMeshInbox();
    };
  });
}

function showMeshTransportModal() {
  const current = Mesh?.getMeshTransport?.() || "meshtastic";
  const opts = [
    { id: "meshtastic", icon: "🔌", label: "Meshtastic Serial", desc: "USB cable — protobuf" },
    { id: "bluetooth", icon: "🦷", label: "Meshtastic BLE", desc: "Wireless — protobuf" },
    { id: "rnode", icon: "📻", label: "RNode Serial", desc: "USB cable — KISS/LoRa" },
  ];

  const rows = opts.map(o => `
    <div class="mesh-transport-opt" data-mode="${o.id}" style="display:flex;align-items:center;gap:10px;padding:10px;margin:4px 0;border-radius:6px;cursor:pointer;background:${current === o.id ? "var(--bg-input)" : "transparent"};border:1px solid ${current === o.id ? "#2563eb" : "var(--border)"};">
      <span style="font-size:22px;">${o.icon}</span>
      <div style="flex:1">
        <div style="font-weight:600;">${o.label}</div>
        <div style="font-size:11px;color:var(--text-dim);">${o.desc}</div>
      </div>
    </div>
  `).join("");

  const ov = document.createElement("div");
  ov.id = "mesh-transport-modal";
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">📡 LoRa Transport</h3>
      <button id="mesh-modal-close" style="padding:4px 8px;border:1px solid var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;">✕</button>
    </div>
    ${rows}
    <button id="mesh-modal-connect" style="margin-top:10px;width:100%;padding:10px;border:none;background:#2563eb;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Connect</button>
  </div>`;
  document.body.appendChild(ov);

  ov.querySelector("#mesh-modal-close").onclick = () => ov.remove();
  ov.querySelectorAll(".mesh-transport-opt").forEach(el => {
    el.onclick = async () => {
      if (!Mesh) Mesh = await import("./mesh.js");
      Mesh.setMeshTransport(el.dataset.mode);
      ov.remove();
      showMeshTransportModal();
    };
  });
  ov.querySelector("#mesh-modal-connect").onclick = async () => {
    ov.remove();
    if (!Mesh) Mesh = await import("./mesh.js");
    await Mesh.connectMesh();
    renderUI();
  };
}

function showHostModal() {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;">Host Group</h3>
      <button id="host-modal-close" style="padding:4px 8px;border:1px solid var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;">✕</button>
    </div>
    <div id="host-webrtc" style="display:flex;align-items:center;gap:10px;padding:10px;margin:4px 0;border-radius:6px;cursor:pointer;border:1px solid var(--border);">
      <span style="font-size:22px;">🔗</span>
      <div style="flex:1">
        <div style="font-weight:600;">WebRTC</div>
        <div style="font-size:11px;color:var(--text-dim);">Direct browser-to-browser — relay optional</div>
      </div>
    </div>
    <div id="host-reticulum" style="display:flex;align-items:center;gap:10px;padding:10px;margin:4px 0;border-radius:6px;cursor:pointer;border:1px solid var(--border);">
      <span style="font-size:22px;">🌐</span>
      <div style="flex:1">
        <div style="font-weight:600;">Reticulum</div>
        <div style="font-size:11px;color:var(--text-dim);">Self-sovereign mesh — work in progress</div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector("#host-modal-close").onclick = () => ov.remove();
  ov.querySelector("#host-webrtc").onclick = () => {
    ov.remove();
    if (relayUrl) Sync.hostGroupViaRelay(relayUrl);
    else Sync.hostGroup();
  };
  ov.querySelector("#host-reticulum").onclick = async () => {
    ov.remove();
    if (!Mesh) Mesh = await import("./mesh.js");
    // Reticulum: pure internet — no radio needed
    Mesh.startReticulumHost();
    const addr = Mesh.getMeshAddress?.() || "unknown";
    toast(`🌐 Reticulum host: your address is ${addr.slice(0, 10)}...`, "#7c3aed");
    renderUI();
  };
}

function showJoinModal() {
  // Remove any existing overlay to prevent stacking
  const existing = document.querySelector("#join-modal-overlay");
  if (existing) existing.remove();

  const peers = Mesh?.getReticulumPeers?.() || [];
  const peerRows = peers.length > 0
    ? peers.map(p => `<div class="join-peer-opt" data-addr="${p.id}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;margin:2px 0;border-radius:4px;cursor:pointer;border:1px solid var(--border);">
        <span style="font-size:16px;">📻</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;">${escapeHtml(p.name)}</div>
          <div style="font-size:10px;color:var(--text-dim);">${typeof p.id === "number" ? "#" + p.id : p.id.slice(0, 14)}</div>
        </div>
      </div>`).join("")
    : '<div style="color:var(--text-dim);font-size:12px;text-align:center;padding:8px;">No peers yet — Host via Reticulum first</div>';

  const ov = document.createElement("div");
  ov.id = "join-modal-overlay";
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:var(--bg-card);padding:16px;border-radius:8px;min-width:320px;max-height:70vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <h3 style="margin:0;">Join Group</h3>
      <button id="join-modal-close" style="padding:4px 8px;border:1px solid var(--border);background:transparent;color:var(--text-dim);border-radius:3px;cursor:pointer;">✕</button>
    </div>
    <div style="margin-bottom:6px;font-size:12px;font-weight:600;color:var(--text-dim);">Reticulum Peers</div>
    <div id="join-peer-list">${peerRows}</div>
    <div style="margin:10px 0;border-top:1px solid var(--border);padding-top:10px;font-size:12px;font-weight:600;color:var(--text-dim);">WebRTC</div>
    <div id="join-webrtc" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:4px;cursor:pointer;border:1px solid var(--border);">
      <span style="font-size:16px;">🔗</span>
      <div style="font-size:13px;">Join via QR / link</div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelector("#join-modal-close").onclick = () => ov.remove();
  ov.querySelector("#join-webrtc").onclick = () => { ov.remove(); Sync.joinPeer(); };
  ov.querySelectorAll(".join-peer-opt").forEach(el => {
    el.onclick = async () => {
      ov.remove();
      if (!Mesh) Mesh = await import("./mesh.js");
      Mesh.setMeshTarget(el.dataset.addr);
      const name = el.querySelector("div > div:first-child").textContent;
      toast(`🌐 Selected ${name} — send them a pin to connect`, "#7c3aed");
      renderUI();
    };
  });
}

export function renderPeerList() {
  const el = document.getElementById("peer-list");
  const online = [...state.peers.values()].filter(p => !p.offline);
  const offline = [...state.peers.values()].filter(p => p.offline);
  const prev = renderPeerList._prev ?? 0;
  if (online.length > prev) playPeerJoin();
  renderPeerList._prev = online.length;

  const webrtcPubkeys = new Set([...online, ...offline].map(p => p.userId));
  const commPeers = (Relay?.getCommunityPeers && state.currentSet) ? Relay.getCommunityPeers(state.currentSet) : [];
  const communityPeers = commPeers.filter(p => !webrtcPubkeys.has(p.pubkey) && p.pubkey !== state.signingPublicKey);

  const hasAny = online.length > 0 || offline.length > 0 || communityPeers.length > 0;
  if (!hasAny) { el.className = ""; el.innerHTML = ""; return; }
  el.className = "visible";

  let html = "";
  if (Peer.connectionCount() > 0) {
    const on = state.followMap;
    html += `<button class="peer-follow-toggle${on ? " on" : ""}" id="peer-follow-btn">${on ? "● " + (t("following") || "Following") : "○ " + (t("follow") || "Follow")}</button>`;
  }
  if (online.length > 0) {
    html += `<h4>${t("peers")} (${online.length})</h4>`;
    html += online.map(p => `<div class="peer-row"><span class="peer-dot online"></span>${escapeHtml(p.name)} — ${escapeHtml(window._names?.[p.setId] || p.setId?.slice(0, 8) || "?")}</div>`).join("");
  }
  if (communityPeers.length > 0) {
    html += `<h4 style="margin-top:6px;">Community (${communityPeers.length})</h4>`;
    html += communityPeers.map(p => `<div class="peer-row"><span class="peer-dot community"></span>${escapeHtml(p.name)}<span style="color:var(--text-dim);font-size:10px;margin-left:4px;">just joined</span></div>`).join("");
  }
  if (offline.length > 0) {
    html += `<h4 style="margin-top:8px;">${t("known")} (${offline.length})</h4>`;
    html += offline.map(p => `<div class="peer-row"><span class="peer-dot offline"></span>${escapeHtml(p.name)} <span style="color:#888;font-size:10px;">(${t("offline")})</span> <button class="forget-peer" data-uid="${escapeHtml(p.userId)}" style="margin-left:4px;padding:0 4px;border:none;background:none;color:#dc2626;cursor:pointer;font-size:10px;">×</button></div>`).join("");
  }
  el.innerHTML = html;
  const followBtn = document.getElementById("peer-follow-btn");
  if (followBtn) {
    followBtn.onclick = () => {
      state.followMap = !state.followMap;
      renderPeerList();
    };
  }
  el.querySelectorAll(".forget-peer").forEach(b => {
    b.onclick = async () => { await DB.deleteKnownPeer(b.dataset.uid); state.peers.delete("known_" + b.dataset.uid); renderPeerList(); };
  });
}

async function pushAllLocalData() {
  const communities = await DB.getAllCommunities();
  for (const c of communities) {
    if (c.visibility === "local") continue;
    const pins = await DB.getAllPins(c.community_id);
    const drawings = await DB.getAllDrawings(c.community_id);
    const annotations = await DB.getAnnotationsByCommunity(c.community_id);
    const pinData = pins.map(p => {
      const obj = { pin_id: p.pin_id, ciphertext: p.ciphertext, nonce: p.nonce };
      if (p.author_pubkey) obj.author_pubkey = p.author_pubkey;
      if (p.media) obj.media = p.media;
      if (p.ttl_expires_at) obj.ttl_expires_at = p.ttl_expires_at;
      if (p.ttl_base_at) obj.ttl_base_at = p.ttl_base_at;
      if (p.vote_count_up) obj.vote_count_up = p.vote_count_up;
      if (p.vote_count_down) obj.vote_count_down = p.vote_count_down;
      if (p.posted_anonymously) obj.posted_anonymously = p.posted_anonymously;
      if (p.emoji) obj.emoji = p.emoji;
      if (p.layer_id) obj.layer_id = p.layer_id;
      if (p.created_at) obj.created_at = p.created_at;
      if (p.map_zoom) obj.map_zoom = p.map_zoom;
      return obj;
    });
    const annData = annotations.map(a => ({ annotation_id: a.annotation_id, pin_id: a.pin_id, ciphertext: a.ciphertext, nonce: a.nonce, author_pubkey: a.author_pubkey, created_at: a.created_at, votes: a.votes || [] }));
    const drawingData = drawings.map(d => ({
      drawing_id: d.drawing_id,
      ciphertext: d.encrypted_geojson || d.ciphertext,
      nonce: d.nonce,
      author_pubkey: d.author_pubkey || "",
      created_at: d.created_at,
    }));
    if (pinData.length || annData.length || drawingData.length) {
      await Relay.pushDelta(c.community_id, pinData, annData, drawingData, [], [], []);
    }
  }
}
