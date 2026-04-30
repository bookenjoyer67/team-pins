import L from "leaflet";
import "leaflet-draw";
import { createClient } from "@supabase/supabase-js";
import { isMatrixWidget, getMatrixRoomId, onMatrixReady } from "./widget.js";
import init, {
  generate_user_keypair,
  generate_dek,
  generate_uuid,
  generate_token,
  wrap_dek,
  unwrap_dek,
  encrypt_pin_data,
  decrypt_pin_data,
  encrypt_geojson,
  decrypt_geojson,
  encode_hex,
  decode_hex,
} from "./core/pkg/e2e_core.js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

const DEFAULT_TEAM = "00000000-0000-0000-0000-000000000000";

let user = null;
let userRole = null;
let displayName = "";
let isWidget = isMatrixWidget();
let widgetUser = null;
let teamRequireToken = false;
let currentTeamId = DEFAULT_TEAM;
let joinedTeams = [];
let dek = null;
let map = null;
let markers = [];
let drawingLayers = [];
let drawControl = null;
let placingPin = false;
let loading = false;

const mapContainer = document.getElementById("map-container");
const authOverlay = document.getElementById("auth-overlay");
const teamOverlay = document.getElementById("team-overlay");

// --- init ---
init()
  .then(async () => {
    initMap();
    addPinButton();
    addLoadingIndicator();
    await checkAuth();
    await loadTeam(DEFAULT_TEAM);
    subscribePins();
    subscribeDrawings();
  })
  .catch(err => {
    mapContainer.innerHTML = `<p style="color:red;padding:20px">Failed: ${err.message}</p>`;
  });

function initMap() {
  map = L.map("map-container").setView([51.505, -0.09], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

function pinIcon(color) {
  return L.icon({
    iconUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36"><path fill="${color}" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z"/><circle fill="#fff" cx="12" cy="12" r="4"/></svg>`)}`,
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -36],
  });
}

function addLoadingIndicator() {
  const el = document.createElement("div");
  el.id = "loading-indicator";
  el.style.cssText = "position:fixed;top:10px;right:10px;z-index:2000;background:white;padding:6px 12px;border-radius:4px;box-shadow:0 1px 5px rgba(0,0,0,0.3);font-size:13px;display:none;";
  el.textContent = "Loading...";
  document.body.appendChild(el);
}

function showLoading() {
  loading = true;
  const el = document.getElementById("loading-indicator");
  if (el) el.style.display = "block";
}

function hideLoading() {
  loading = false;
  const el = document.getElementById("loading-indicator");
  if (el) el.style.display = "none";
}

// --- auth ---
async function checkAuth() {
  if (isWidget) {
    onMatrixReady(async (matrixId, roomId, supabaseToken) => {
      await supabase.auth.setSession({ access_token: supabaseToken, refresh_token: "" });

      user = { id: matrixId, email: null, isWidget: true };
      widgetUser = { id: matrixId, displayName: matrixId?.split(":")[0]?.replace("@", "") || matrixId };
      displayName = widgetUser.displayName;

      if (roomId) currentTeamId = roomId;

      await loadTeam(currentTeamId);
      enablePinCreation();

      await supabase.from("team_members").upsert({
        team_id: currentTeamId, user_id: matrixId, email: null,
        display_name: displayName, role: "administrator",
      });

      renderUI();
    });
    renderUI();
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    user = session.user;
    await loadJoinedTeams();
    await refreshRole();
    enablePinCreation();
  }
  supabase.auth.onAuthStateChange(async (_e, session) => {
    user = session?.user ?? null;
    if (user) {
      await loadTeam(currentTeamId);
      await loadJoinedTeams();
      enablePinCreation();
    } else {
      joinedTeams = [];
      userRole = null;
      removeDrawControl();
      currentTeamId = DEFAULT_TEAM;
      await loadTeam(DEFAULT_TEAM);
      disablePinCreation();
    }
    renderUI();
  });
  renderUI();
}

async function loadJoinedTeams() {
  const { data } = await supabase
    .from("team_members").select("team_id").eq("user_id", user.id);
  if (data) joinedTeams = data.map(r => r.team_id);
}

async function refreshRole() {
  if (!user || !currentTeamId) { userRole = null; return; }
  const { data } = await supabase
    .from("team_members").select("role")
    .eq("team_id", currentTeamId).eq("user_id", user.id);
  userRole = (data && data.length > 0) ? data[0].role : null;
  setupDrawControl();
}

// --- team ---
async function loadTeam(teamId) {
  showLoading();
  currentTeamId = teamId;
  dek = null;
  markers.forEach(m => m.remove());
  markers = [];
  clearDrawingLayers();
  try {
    const kp = await getOrCreateTeamKeypair(teamId);
    await ensureDEK(teamId, kp);
    await loadPins();
    await loadDrawings();

    const { data: settings } = await supabase
      .from("team_settings").select("require_token").eq("team_id", teamId);
    teamRequireToken = settings?.[0]?.require_token || false;

    if (user) {
      const { data: members } = await supabase
        .from("team_members").select("user_id,email").eq("team_id", teamId);
      const memberRow = members?.find(m => m.user_id === user.id);
      if (!memberRow) {
        const isFirst = !members || members.length === 0;
        await supabase.from("team_members").upsert({
          team_id: teamId, user_id: user.id, email: user.email,
          display_name: user.email?.split("@")[0],
          role: isFirst ? "administrator" : "member",
        });
        if (!joinedTeams.includes(teamId)) joinedTeams.push(teamId);
      } else if (!memberRow.email) {
        await supabase.from("team_members")
          .update({ email: user.email })
          .eq("team_id", teamId).eq("user_id", user.id);
      }
      if (memberRow?.display_name) displayName = memberRow.display_name;
      if (!displayName) displayName = user.email?.split("@")[0] || "";
      await refreshRole();
    }
  } catch (err) {
    console.error("loadTeam:", err);
    toast(err.message);
  }
  hideLoading();
  renderUI();
}

async function joinTeam(teamId, skipTokenCheck = false) {
  if (!user) return;

  if (!skipTokenCheck) {
    const { data: settings } = await supabase
      .from("team_settings").select("require_token").eq("team_id", teamId);
    if (settings?.[0]?.require_token) {
      showTokenPrompt(teamId);
      return;
    }
  }

  const { data: existing } = await supabase
    .from("team_members").select("user_id").eq("team_id", teamId);
  const isFirst = !existing || existing.length === 0;
  const { error } = await supabase.from("team_members").upsert({
    team_id: teamId, user_id: user.id, email: user.email,
    display_name: user.email?.split("@")[0],
    role: isFirst ? "administrator" : "member",
  });
  if (error) { toast(error.message); return; }
  if (!joinedTeams.includes(teamId)) joinedTeams.push(teamId);
  await loadTeam(teamId);
}

async function createTeam() {
  if (!user) return;
  const teamId = generate_uuid();
  const { error } = await supabase.from("team_members").upsert({
    team_id: teamId, user_id: user.id, email: user.email,
    display_name: user.email?.split("@")[0], role: "administrator",
  });
  if (error) { toast(error.message); return; }
  if (!joinedTeams.includes(teamId)) joinedTeams.push(teamId);
  await loadTeam(teamId);
}

async function joinWithToken(token) {
  if (!user) return;
  const { data, error } = await supabase
    .from("team_invites").select("*").eq("token", token);
  if (error) { toast(error.message); return; }
  if (!data || data.length === 0) { toast("Invalid token"); return; }
  const invite = data[0];
  if (invite.used) { toast("Token already used"); return; }

  await supabase.from("team_invites").update({ used: true }).eq("token", token);
  await joinTeam(invite.team_id, true);
}

function showTokenPrompt(teamId) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div style="background:white;padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 8px;">Invite Required</h3>
      <p style="font-size:13px;color:#6b7280;margin:0 0 12px;">This team requires an invite token to join.</p>
      <input id="token-prompt-input" placeholder="Enter token" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="token-prompt-cancel" style="padding:6px 14px;border:1px solid #ccc;background:#f3f3f3;border-radius:4px;cursor:pointer;">Cancel</button>
        <button id="token-prompt-go" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Join</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("token-prompt-input").focus();
  const cleanup = () => overlay.remove();
  document.getElementById("token-prompt-cancel").onclick = cleanup;
  overlay.onclick = e => { if (e.target === overlay) cleanup(); };
  document.getElementById("token-prompt-go").onclick = async () => {
    const token = document.getElementById("token-prompt-input").value.trim();
    if (!token) return;
    cleanup();
    await joinWithToken(token);
  };
}

async function createInviteToken() {
  const token = generate_token();
  const { error } = await supabase.from("team_invites").insert({
    token, team_id: currentTeamId, created_by: user.id,
  });
  if (error) { toast(error.message); return null; }
  return token;
}

async function getOrCreateTeamKeypair(teamId) {
  const { data, error } = await supabase
    .from("team_secrets").select("public_key,secret_key").eq("team_id", teamId);
  if (error && error.code !== "PGRST116") throw new Error(error.message);
  if (data && data.length > 0) {
    return { public: decode_hex(data[0].public_key), secret: decode_hex(data[0].secret_key) };
  }
  if (!user) return null;
  const kp = generate_user_keypair();
  const { error: e2 } = await supabase.from("team_secrets").insert({
    team_id: teamId, public_key: encode_hex(kp.public), secret_key: encode_hex(kp.secret),
  });
  if (e2) throw new Error(e2.message);
  return kp;
}

async function ensureDEK(teamId, kp) {
  if (!kp) return;
  const { data, error } = await supabase
    .from("team_dek").select("wrapped_dek").eq("team_id", teamId);
  if (error && error.code !== "PGRST116") throw new Error(error.message);
  if (data && data.length > 0) {
    dek = unwrap_dek(data[0].wrapped_dek, encode_hex(kp.secret));
  } else {
    if (!user) return;
    dek = generate_dek();
    const wrappedHex = wrap_dek(dek, encode_hex(kp.public));
    const { error: e2 } = await supabase.from("team_dek").upsert({
      team_id: teamId, wrapped_dek: wrappedHex,
    });
    if (e2) throw new Error(e2.message);
  }
}

// --- pins ---
async function loadPins() {
  if (!dek) return;
  const { data, error } = await supabase
    .from("encrypted_pins").select("*").eq("team_id", currentTeamId);
  if (error) { console.error("loadPins:", error.message); return; }
  markers.forEach(m => m.remove());
  markers = [];
  if (data) {
    data.forEach(row => {
      try {
        const pin = decrypt_pin_data(row.ciphertext, row.nonce, dek);
        pin.pin_id = row.pin_id;
        pin.is_public = row.is_public;
        const color = pin.is_public ? "#2563eb" : "#dc2626";
        const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(color) }).addTo(map);
        const pubBadge = pin.is_public ? ' <span style="color:green;font-size:10px;">(public)</span>' : '';
        const releaseBtn = (!pin.is_public && user)
          ? `<button class="release-btn" data-pin-id="${row.pin_id}" style="margin:6px 4px 0 0;padding:4px 8px;border:1px solid #16a34a;background:white;color:#16a34a;border-radius:3px;cursor:pointer;font-size:12px;">Make Public</button>`
          : '';
        const deleteBtn = user
          ? `<button class="delete-pin-btn" data-pin-id="${row.pin_id}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:white;color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">Delete</button>`
          : '';
        marker.bindPopup(`<b>${pin.title}</b>${pubBadge}<br>${pin.note}<br>${releaseBtn}${deleteBtn}`);
        markers.push(marker);
      } catch (_) {}
    });
  }
}

async function savePin(lat, lng, title, note) {
  if (!dek || !user || !currentTeamId) return;
  const pinId = generate_uuid();
  const encrypted = encrypt_pin_data(title, note, lat, lng, dek);
  const { error } = await supabase.from("encrypted_pins").insert({
    team_id: currentTeamId, pin_id: pinId,
    ciphertext: encrypted.ciphertext, nonce: encrypted.nonce,
  });
  if (error) { toast(error.message); return; }
  bc.postMessage("reload");
  await loadPins();
}

async function releasePin(pinId) {
  const { error } = await supabase.from("encrypted_pins")
    .update({ is_public: true }).eq("pin_id", pinId);
  if (error) { toast(error.message); return; }
  bc.postMessage("reload");
  await loadPins();
}

async function deletePin(pinId) {
  const { error } = await supabase.from("encrypted_pins")
    .delete().eq("pin_id", pinId);
  if (error) { toast(error.message); return; }
  bc.postMessage("reload");
  await loadPins();
}

// --- drawings ---
function setupDrawControl() {
  if (drawControl) return;
  drawControl = new L.Control.Draw({
    position: "topright",
    draw: {
      polygon: { allowIntersection: false, showArea: true },
      polyline: true,
      rectangle: true,
      circle: true,
      marker: false,
      circlemarker: false,
    },
    edit: false,
  });
  map.addControl(drawControl);
  map.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    const geoJson = layer.toGeoJSON();
    if (layer instanceof L.Circle) {
      geoJson.properties = geoJson.properties || {};
      geoJson.properties.radius = layer.getRadius();
    }
    showDrawingForm(geoJson);
  });
}

function removeDrawControl() {
  if (drawControl) { map.removeControl(drawControl); drawControl = null; }
}

function clearDrawingLayers() {
  drawingLayers.forEach(l => map.removeLayer(l));
  drawingLayers = [];
}

function geoJsonToLayer(geoJson) {
  if (geoJson.geometry.type === "Point" && geoJson.properties?.radius) {
    const [lng, lat] = geoJson.geometry.coordinates;
    return L.circle([lat, lng], {
      radius: geoJson.properties.radius,
      color: "#2563eb", weight: 2, fillOpacity: 0.15,
    });
  }
  return L.geoJSON(geoJson, {
    style: { color: "#2563eb", weight: 2, fillOpacity: 0.15 },
  });
}

function showDrawingForm(geoJson) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div style="background:white;padding:20px;border-radius:8px;min-width:280px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 12px;">New Drawing</h3>
      <input id="drawing-title" placeholder="Title" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;" />
      <textarea id="drawing-note" placeholder="Description" rows="3" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="drawing-cancel" style="padding:6px 14px;border:1px solid #ccc;background:#f3f3f3;border-radius:4px;cursor:pointer;">Cancel</button>
        <button id="drawing-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("drawing-title").focus();
  const cleanup = () => overlay.remove();
  document.getElementById("drawing-cancel").onclick = cleanup;
  overlay.onclick = e => { if (e.target === overlay) cleanup(); };
  document.getElementById("drawing-save").onclick = async () => {
    const title = document.getElementById("drawing-title").value.trim();
    const note = document.getElementById("drawing-note").value.trim();
    if (!title) return;
    cleanup();
    geoJson.properties = geoJson.properties || {};
    geoJson.properties.title = title;
    geoJson.properties.note = note;
    await saveDrawing(geoJson);
  };
}

async function saveDrawing(geoJson) {
  if (!dek || !user || !currentTeamId) return;
  const drawingId = generate_uuid();
  geoJson.id = drawingId;
  const encrypted = encrypt_geojson(JSON.stringify(geoJson), dek);
  const { error } = await supabase.from("encrypted_drawings").insert({
    team_id: currentTeamId, drawing_id: drawingId,
    encrypted_geojson: encrypted.ciphertext, nonce: encrypted.nonce,
  });
  if (error) { toast(error.message); return; }
  bc.postMessage("reload");
  await loadDrawings();
}

async function loadDrawings() {
  if (!dek) return;
  clearDrawingLayers();
  const { data, error } = await supabase
    .from("encrypted_drawings").select("*").eq("team_id", currentTeamId);
  if (error) { console.error("loadDrawings:", error.message); return; }
  if (data) {
    data.forEach(row => {
      try {
        const geoJsonStr = decrypt_geojson(row.encrypted_geojson, row.nonce, dek);
        const geoJson = JSON.parse(geoJsonStr);
        const layer = geoJsonToLayer(geoJson).addTo(map);
        drawingLayers.push(layer);
        const title = geoJson.properties?.title || "Drawing";
        const note = geoJson.properties?.note || "";
        const isPublic = row.is_public;
        const pubBadge = isPublic ? ' <span style="color:green;font-size:10px;">(public)</span>' : '';
        const releaseBtn = (!isPublic && user)
          ? `<button class="release-dwg-btn" data-dwg-id="${row.drawing_id}" style="margin:6px 4px 0 0;padding:4px 8px;border:1px solid #16a34a;background:white;color:#16a34a;border-radius:3px;cursor:pointer;font-size:12px;">Make Public</button>`
          : '';
        const deleteBtn = user
          ? `<button class="delete-dwg-btn" data-dwg-id="${row.drawing_id}" style="margin-top:6px;padding:4px 8px;border:1px solid #dc2626;background:white;color:#dc2626;border-radius:3px;cursor:pointer;font-size:12px;">Delete</button>`
          : '';
        layer.bindPopup(`<b>${title}</b>${pubBadge}<br>${note}<br>${releaseBtn}${deleteBtn}`);
      } catch (_) {}
    });
  }
}

async function deleteDrawing(drawingId) {
  const { error } = await supabase.from("encrypted_drawings")
    .delete().eq("drawing_id", drawingId);
  if (error) { toast(error.message); return; }
  bc.postMessage("reload");
  await loadDrawings();
}

async function releaseDrawing(drawingId) {
  const { error } = await supabase.from("encrypted_drawings")
    .update({ is_public: true }).eq("drawing_id", drawingId);
  if (error) { toast(error.message); return; }
  bc.postMessage("reload");
  await loadDrawings();
}

// --- delegate popup buttons ---
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.matches(".release-btn")) {
    e.stopPropagation();
    await releasePin(btn.dataset.pinId);
    map.closePopup();
  }
  if (btn.matches(".delete-pin-btn")) {
    e.stopPropagation();
    if (confirm("Delete this pin?")) { await deletePin(btn.dataset.pinId); map.closePopup(); }
  }
  if (btn.matches(".release-dwg-btn")) {
    e.stopPropagation();
    await releaseDrawing(btn.dataset.dwgId);
    map.closePopup();
  }
  if (btn.matches(".delete-dwg-btn")) {
    e.stopPropagation();
    if (confirm("Delete this drawing?")) { await deleteDrawing(btn.dataset.dwgId); map.closePopup(); }
  }
});

// --- toast ---
function toast(msg, color = "#dc2626") {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:${color};color:white;padding:10px 20px;border-radius:6px;z-index:3000;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,0.3);transition:opacity 0.3s;`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3000);
}

// --- UI ---
function renderUI() {
  // Matrix widget mode — auto-identified, no sign-in
  if (isWidget) {
    if (widgetUser) {
      authOverlay.innerHTML = `<span>${widgetUser.displayName}</span> <span style="color:#7c3aed;font-size:11px;">(matrix)</span>`;
    } else {
      authOverlay.innerHTML = `<span style="color:#888;font-size:13px;">Connecting to Matrix...</span>`;
    }
    teamOverlay.innerHTML = `
      <span style="font-size:12px;color:#888;">Team: ${currentTeamId}</span>
      <button id="copy-team-btn" title="Copy team ID" style="padding:2px 6px;border:1px solid #ccc;background:white;border-radius:3px;cursor:pointer;font-size:13px;">&#x2398;</button>
    `;
    document.getElementById("copy-team-btn").onclick = () => {
      navigator.clipboard.writeText(currentTeamId);
      toast("Copied", "#059669");
    };
    return;
  }

  if (user) {
    const roleLabel = userRole === "administrator" ? "admin" : userRole === "moderator" ? "mod" : "member";
    authOverlay.innerHTML = `<span id="display-name-span" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;" title="Click to edit display name">${displayName || user.email?.split("@")[0]}</span> <span style="color:#6b7280;font-size:11px;">(${roleLabel})</span> <button id="signout">Sign Out</button>`;
    document.getElementById("signout").onclick = () => supabase.auth.signOut();
    document.getElementById("display-name-span").onclick = showSettingsPanel;

    let options = joinedTeams.map(id =>
      `<option value="${id}" ${id === currentTeamId ? "selected" : ""}>${id}</option>`
    ).join("");
    teamOverlay.innerHTML = `
      <select id="team-select" style="padding:4px;border:1px solid #ccc;border-radius:3px;font-size:13px;">
        <option value="">-- select team --</option>
        ${options}
      </select>
      <button id="copy-team-btn" title="Copy team ID" style="padding:2px 5px;border:1px solid #ccc;background:white;border-radius:3px;cursor:pointer;font-size:13px;">&#x2398;</button>
      <input id="join-team-input" placeholder="Team ID to join" size="16" style="padding:4px;border:1px solid #ccc;border-radius:3px;font-size:13px;" />
      <button id="join-team-btn" style="padding:4px 8px;border:none;border-radius:3px;background:#2563eb;color:white;cursor:pointer;font-size:13px;">Join</button>
      <button id="create-team-btn" style="padding:4px 8px;border:none;border-radius:3px;background:#059669;color:white;cursor:pointer;font-size:13px;">New Team</button>
      ${userRole === "administrator" ? `<button id="manage-team-btn" style="padding:4px 8px;border:none;border-radius:3px;background:#7c3aed;color:white;cursor:pointer;font-size:13px;">Manage</button>` : ""}
    `;
    document.getElementById("team-select").onchange = (e) => {
      if (e.target.value) loadTeam(e.target.value);
    };
    document.getElementById("join-team-btn").onclick = () => {
      const tid = document.getElementById("join-team-input").value.trim();
      if (tid) joinTeam(tid);
    };
    document.getElementById("copy-team-btn").onclick = () => {
      navigator.clipboard.writeText(currentTeamId);
      toast("Copied", "#059669");
    };
    document.getElementById("create-team-btn").onclick = createTeam;
    const manageBtn = document.getElementById("manage-team-btn");
    if (manageBtn) manageBtn.onclick = showAdminPanel;
  } else {
    authOverlay.innerHTML = `
      <div id="auth-error" style="color:red;font-size:12px;"></div>
      <input id="email" placeholder="Email" size="14" />
      <input id="password" type="password" placeholder="Password" size="14" />
      <button id="signin">Sign In</button>
      <button id="signup">Sign Up</button>
    `;
    const showErr = m => { const e = document.getElementById("auth-error"); if(e) e.textContent = m; };
    document.getElementById("signin").onclick = async () => {
      const { error } = await supabase.auth.signInWithPassword({
        email: document.getElementById("email").value,
        password: document.getElementById("password").value,
      });
      if (error) showErr(error.message);
    };
    document.getElementById("signup").onclick = async () => {
      const { error } = await supabase.auth.signUp({
        email: document.getElementById("email").value,
        password: document.getElementById("password").value,
      });
      if (error) showErr(error.message);
    };
    teamOverlay.innerHTML = `
      <input id="guest-team-input" placeholder="Team ID" size="30" value="${currentTeamId}" style="padding:4px;border:1px solid #ccc;border-radius:3px;font-size:13px;" />
      <button id="guest-team-go" style="padding:4px 8px;border:none;border-radius:3px;background:#2563eb;color:white;cursor:pointer;font-size:13px;">Go</button>
    `;
    document.getElementById("guest-team-go").onclick = () => {
      const tid = document.getElementById("guest-team-input").value.trim();
      if (tid && tid !== currentTeamId) loadTeam(tid);
    };
    document.getElementById("guest-team-input").onkeydown = (e) => {
      if (e.key === "Enter") {
        const tid = e.target.value.trim();
        if (tid && tid !== currentTeamId) loadTeam(tid);
      }
    };
  }
}

// --- settings panel ---
function showSettingsPanel() {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div style="background:white;padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 12px;">Settings</h3>
      <label style="font-size:13px;color:#6b7280;">Display Name</label>
      <input id="settings-display-name" value="${displayName || ""}" placeholder="Enter display name" style="width:100%;padding:6px;margin:4px 0 12px;box-sizing:border-box;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="settings-cancel" style="padding:6px 14px;border:1px solid #ccc;background:#f3f3f3;border-radius:4px;cursor:pointer;">Cancel</button>
        <button id="settings-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("settings-display-name").focus();
  const cleanup = () => overlay.remove();
  document.getElementById("settings-cancel").onclick = cleanup;
  overlay.onclick = e => { if (e.target === overlay) cleanup(); };
  document.getElementById("settings-save").onclick = async () => {
    const name = document.getElementById("settings-display-name").value.trim();
    if (!name) return;
    displayName = name;
    // update all team_members rows for this user
    const { error } = await supabase.from("team_members")
      .update({ display_name: name })
      .eq("user_id", user.id);
    if (error) { toast(error.message); return; }
    cleanup();
    renderUI();
  };
}

// --- admin panel ---
async function showAdminPanel() {
  showLoading();
  const [membersRes, invitesRes] = await Promise.all([
    supabase.from("team_members").select("*").eq("team_id", currentTeamId),
    supabase.from("team_invites").select("*").eq("team_id", currentTeamId).eq("used", false),
  ]);
  hideLoading();
  if (membersRes.error) { toast(membersRes.error.message); return; }
  const members = membersRes.data || [];
  const invites = invitesRes.data || [];

  const rows = members.map(m => `
    <tr>
      <td style="padding:4px 8px;">${m.display_name || m.email || m.user_id}</td>
      <td style="padding:4px 8px;">
        <select class="role-select" data-user-id="${m.user_id}" style="padding:2px 4px;border:1px solid #ccc;border-radius:3px;font-size:12px;">
          <option value="administrator" ${m.role === "administrator" ? "selected" : ""}>Admin</option>
          <option value="moderator" ${m.role === "moderator" ? "selected" : ""}>Moderator</option>
          <option value="member" ${m.role === "member" ? "selected" : ""}>Member</option>
        </select>
      </td>
      <td style="padding:4px 8px;">
        ${m.user_id !== user.id ? `<button class="remove-member-btn" data-user-id="${m.user_id}" style="padding:2px 6px;border:1px solid #dc2626;background:white;color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">Remove</button>` : ""}
      </td>
    </tr>`).join("");

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div style="background:white;padding:20px;border-radius:8px;min-width:380px;max-height:70vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 12px;">Manage Team</h3>
      <p style="margin:0 0 8px;font-size:12px;color:#888;">ID: ${currentTeamId}</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;">User</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;">Role</th><th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e5e7eb;"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
        <button id="admin-close" style="padding:6px 14px;border:1px solid #ccc;background:#f3f3f3;border-radius:4px;cursor:pointer;">Close</button>
        <button id="admin-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Save Roles</button>
      </div>
      <hr style="margin:16px 0;border-color:#e5e7eb;">
      <h4 style="margin:0 0 8px;">Settings</h4>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;">
        <input type="checkbox" id="require-token-toggle" ${teamRequireToken ? "checked" : ""} />
        Require invite token to join
      </label>
      <h4 style="margin:0 0 8px;">Invite Tokens</h4>
      <button id="generate-token-btn" style="padding:4px 10px;border:none;border-radius:3px;background:#059669;color:white;cursor:pointer;font-size:12px;">+ Generate Token</button>
      <div id="token-list" style="margin-top:8px;font-size:12px;">
        ${invites.length === 0 ? '<span style="color:#888;">No active tokens</span>' : invites.map(i => `
          <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #f3f4f6;">
            <code style="background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:11px;">${i.token}</code>
            <button class="delete-token-btn" data-token="${i.token}" style="padding:2px 6px;border:1px solid #dc2626;background:white;color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">Delete</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const cleanup = () => overlay.remove();
  document.getElementById("admin-close").onclick = cleanup;
  overlay.onclick = e => { if (e.target === overlay) cleanup(); };

  // remove member buttons
  overlay.querySelectorAll(".remove-member-btn").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Remove this member?")) return;
      await supabase.from("team_members")
        .delete()
        .eq("team_id", currentTeamId)
        .eq("user_id", b.dataset.userId);
      cleanup();
      showAdminPanel();
    };
  });

  document.getElementById("admin-save").onclick = async () => {
    const selects = overlay.querySelectorAll(".role-select");
    for (const s of selects) {
      await supabase.from("team_members")
        .update({ role: s.value })
        .eq("team_id", currentTeamId)
        .eq("user_id", s.dataset.userId);
    }
    cleanup();
    await refreshRole();
    renderUI();
  };

  // Settings toggle
  document.getElementById("require-token-toggle").onchange = async (e) => {
    await supabase.from("team_settings").upsert({
      team_id: currentTeamId, require_token: e.target.checked,
    });
    teamRequireToken = e.target.checked;
  };

  // Token management
  document.getElementById("generate-token-btn").onclick = async () => {
    const token = await createInviteToken();
    if (token) {
      const list = document.getElementById("token-list");
      const div = document.createElement("div");
      div.innerHTML = `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #f3f4f6;"><code style="background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:11px;">${token}</code><button class="delete-token-btn" data-token="${token}" style="padding:2px 6px;border:1px solid #dc2626;background:white;color:#dc2626;border-radius:3px;cursor:pointer;font-size:11px;">Delete</button></div>`;
      list.querySelector("span")?.remove();
      list.appendChild(div.firstElementChild);
      div.querySelector(".delete-token-btn").onclick = async (e) => {
        await supabase.from("team_invites").delete().eq("token", e.target.dataset.token);
        e.target.parentElement.remove();
      };
    }
  };

  overlay.querySelectorAll(".delete-token-btn").forEach(b => {
    b.onclick = async (e) => {
      await supabase.from("team_invites").delete().eq("token", e.target.dataset.token);
      e.target.parentElement.remove();
    };
  });
}

// --- create-pin button ---
let pinBtn = null;

function addPinButton() {
  const ctrl = L.control({ position: "topright" });
  ctrl.onAdd = function () {
    const div = L.DomUtil.create("div");
    div.style.cssText = "background:white;padding:4px;border-radius:4px;box-shadow:0 1px 5px rgba(0,0,0,0.3);";
    pinBtn = L.DomUtil.create("button");
    updatePinBtn();
    pinBtn.onclick = (e) => {
      L.DomEvent.stopPropagation(e);
      if (!user || !currentTeamId) return;
      placingPin = !placingPin;
      if (placingPin) {
        pinBtn.textContent = "\u{1F4CD} Click map to place pin...";
        pinBtn.style.background = "#dc2626";
        map.getContainer().style.cursor = "crosshair";
      } else {
        updatePinBtn();
        map.getContainer().style.cursor = "";
      }
    };
    div.appendChild(pinBtn);
    return div;
  };
  ctrl.addTo(map);

  map.on("click", (e) => {
    if (!placingPin) return;
    placingPin = false;
    map.getContainer().style.cursor = "";
    updatePinBtn();
    showPinForm(e.latlng.lat, e.latlng.lng);
  });
}

function showPinForm(lat, lng) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div style="background:white;padding:20px;border-radius:8px;min-width:280px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">
      <h3 style="margin:0 0 12px;">New Pin</h3>
      <input id="pin-title" placeholder="Title" style="width:100%;padding:6px;margin-bottom:8px;box-sizing:border-box;" />
      <textarea id="pin-note" placeholder="Description" rows="3" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;resize:vertical;"></textarea>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="pin-cancel" style="padding:6px 14px;border:1px solid #ccc;background:#f3f3f3;border-radius:4px;cursor:pointer;">Cancel</button>
        <button id="pin-save" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("pin-title").focus();
  const cleanup = () => overlay.remove();
  document.getElementById("pin-cancel").onclick = cleanup;
  overlay.onclick = e => { if (e.target === overlay) cleanup(); };
  document.getElementById("pin-save").onclick = async () => {
    const t = document.getElementById("pin-title").value.trim();
    const n = document.getElementById("pin-note").value.trim();
    if (!t) return;
    cleanup();
    await savePin(lat, lng, t, n);
  };
}

function updatePinBtn() {
  if (!pinBtn) return;
  if (user && currentTeamId) {
    pinBtn.textContent = "+ Create Pin";
    pinBtn.style.cssText = "padding:6px 12px;border:none;background:#2563eb;color:white;border-radius:3px;cursor:pointer;font-size:13px;";
    pinBtn.disabled = false;
  } else {
    pinBtn.textContent = "Sign in to create pins";
    pinBtn.style.cssText = "padding:6px 12px;border:none;background:#9ca3af;color:white;border-radius:3px;cursor:not-allowed;font-size:13px;";
    pinBtn.disabled = true;
  }
}

function enablePinCreation() { updatePinBtn(); }
function disablePinCreation() { if (placingPin) { placingPin = false; map.getContainer().style.cursor = ""; } updatePinBtn(); }

// --- realtime ---
const bc = new BroadcastChannel("pins");
bc.onmessage = () => { if (dek) { loadPins(); loadDrawings(); } };

function subscribePins() {
  supabase
    .channel("pins-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "encrypted_pins" },
      () => { if (dek) loadPins(); })
    .subscribe();
}

function subscribeDrawings() {
  supabase
    .channel("drawings-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "encrypted_drawings" },
      () => { if (dek) loadDrawings(); })
    .subscribe();
}
