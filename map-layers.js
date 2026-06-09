import L from "leaflet";
import { generate_uuid } from "./core/pkg/e2e_core.js";
import * as DB from "./db.js";
import { state } from "./state.js";
import { escapeHtml, toast, confirmDialog, promptRoomPassword, hashCommunityPassword } from "./dialogs.js";
import { t } from "./i18n.js";

function safeBounds(b) {
  if (!b || !Array.isArray(b) || b.length !== 4) return "";
  if (!b.every(v => typeof v === "number" && isFinite(v))) return "";
  return escapeHtml(JSON.stringify(b));
}
import { loadPins, loadDrawings, loadChains } from "./map.js";

// --- Layer system (intra-set) ---

export async function loadLayersForSet(teamId) {
  if (!teamId) { state.layers = []; return; }
  let layers = await DB.getLayers(teamId);
  if (!layers || !Array.isArray(layers) || layers.length === 0) {
    const defaultLayer = {
      layer_id: generate_uuid(),
      name: "Default",
      color: state.defaultLayerColor,
      visible: true,
      opacity: 1.0,
    };
    layers = [defaultLayer];
    await DB.saveLayers(teamId, layers);
  }
  state.layers = layers;
}

export async function createLayer(name) {
  if (!state.currentSet) return;
  const layerId = generate_uuid();
  const idx = state.layers.length;
  const color = state.layerPalette[idx % state.layerPalette.length];
  const layer = { layer_id: layerId, name: name || ("Layer " + (idx + 1)), color, visible: true, opacity: 1.0 };
  state.layers = [...state.layers, layer];
  await DB.saveLayers(state.currentSet, state.layers);
  await loadPins();
  await loadDrawings();
  window._renderUI?.();
}

export async function renameLayer(layerId, newName) {
  if (!state.currentSet) return;
  const layer = state.layers.find(l => l.layer_id === layerId);
  if (!layer) return;
  layer.name = newName;
  state.layers = [...state.layers];
  await DB.saveLayers(state.currentSet, state.layers);
  for (const m of state.markers) {
    if (m._layerId === layerId) m._layerName = newName;
  }
}

export async function deleteLayer(layerId) {
  if (!state.currentSet || state.layers.length <= 1) {
    toast("Cannot delete the last layer", "#f97316");
    return;
  }
  const defaultId = state.layers[0].layer_id;
  state.layers = state.layers.filter(l => l.layer_id !== layerId);
  await DB.saveLayers(state.currentSet, state.layers);
  const pins = await DB.getPinsByLayer(state.currentSet, layerId);
  for (const p of pins) await DB.updatePinLayerId(p.pin_id, defaultId);
  const drawings = await DB.getDrawings(state.currentSet);
  for (const d of drawings) {
    if (d.layer_id === layerId) await DB.updateDrawingLayerId(d.drawing_id, defaultId);
  }
  await loadPins();
  await loadDrawings();
  window._renderUI?.();
}

export async function toggleLayer(layerId) {
  if (!state.currentSet) return;
  const layer = state.layers.find(l => l.layer_id === layerId);
  if (!layer) return;
  layer.visible = !layer.visible;
  state.layers = [...state.layers];
  await DB.saveLayers(state.currentSet, state.layers);
  await loadPins();
  await loadDrawings();
  window._renderUI?.();
}

export async function setLayerOpacity(layerId, value) {
  if (!state.currentSet) return;
  const layer = state.layers.find(l => l.layer_id === layerId);
  if (!layer) return;
  layer.opacity = Math.max(0.1, Math.min(1.0, value));
  state.layers = [...state.layers];
  await DB.saveLayers(state.currentSet, state.layers);
  for (const m of state.markers) {
    if (m._layerId === layerId) m.setOpacity(layer.visible ? layer.opacity : 0);
  }
  for (const dl of state.drawingLayers) {
    if (dl._layerId === layerId) {
      const o = layer.visible ? layer.opacity : 0;
      dl.setStyle({ opacity: o, fillOpacity: o * 0.15 });
    }
  }
}

export async function refreshAllLayers() {
  if (!state.currentSet) return;
  await loadLayersForSet(state.currentSet);
  state.markers.forEach(m => m.remove());
  state.markers.length = 0;
  state.clusterGroup?.clearLayers();
  state._markerMap = null;
  state.drawingLayers.forEach(l => state.map.removeLayer(l));
  state.drawingLayers.length = 0;
  state.chainLayers.forEach(l => state.map.removeLayer(l));
  state.chainLayers.length = 0;
  await loadPins();
  await loadDrawings();
  await loadChains();
}

export async function showDiscoverModal() {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";

  let geoFilter = true;

  async function renderLocalCommunities() {
    let html = `<div style="padding:10px;font-size:12px;color:var(--text-dim);margin-bottom:4px;">Discover communities published on relay servers. Publish one of your maps in 🗺 Maps → ℹ.</div>`;

    // Section 1: User's own communities
    try {
      const teams = await DB.getAllTeams();
      const allTeams = Array.isArray(teams) ? teams : [];
      if (allTeams.length > 0) {
        const localRows = [];
        for (const tc of allTeams) {
          const com = await DB.getCommunity(tc.team_id);
          const name = tc.name || com?.name || tc.team_id.slice(0, 8);
          // Fetch pin count
          let pinCount = 0;
          try {
            const pins = await DB.getPins(tc.team_id);
            pinCount = pins ? pins.length : 0;
          } catch (e) { console.warn("[layers]", e.message); }
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
    } catch (e) { console.warn("[layers]", e.message); }

    // Section 2: Relay connect prompt
    const exampleRelay = "wss://signal.catperson.online";
    html += `<div style="border:1px solid var(--border-light);border-radius:4px;padding:10px;">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Connect a relay server to discover published communities.</div>
      <div style="display:flex;gap:6px;margin-bottom:6px;">
        <input id="disc-relay-input" type="text" placeholder="${escapeHtml(exampleRelay)}" value="" style="flex:1;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);font-size:12px;" />
        <button id="disc-relay-connect" style="padding:6px 12px;border:1px solid #7c3aed;background:transparent;color:#7c3aed;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;">Connect</button>
      </div>
      <div style="font-size:10px;color:var(--text-muted);">Configure in ⚙ Settings. Self-host? The relay binary is in <code>signal-server/</code>.</div>
    </div>`;

    // Wire connect button — only active when input has a user-entered value
    setTimeout(() => wireDiscoverRelayInput(), 0);

    return html;
  }

  function wireDiscoverRelayInput() {
    const input = document.getElementById("disc-relay-input");
    const btn = document.getElementById("disc-relay-connect");
    if (!input || !btn) return;
    const updateBtn = () => { btn.disabled = !input.value.trim(); };
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
      const bboxArr = mapBounds ? [mapBounds.getSouth(), mapBounds.getWest(), mapBounds.getNorth(), mapBounds.getEast()] : null;
      const searchTerm = document.getElementById("disc-search")?.value?.trim()?.toLowerCase() || null;

      const relayConfigured = !!(localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url"));
      const relayConnected = window._relayIsConnected?.() || false;

      // Short-circuit: no relay configured — skip all network queries, show local state immediately
      if (!relayConfigured) {
        listEl.innerHTML = await renderLocalCommunities();
        const filterLabel = document.getElementById("disc-filter-label");
        if (filterLabel) filterLabel.textContent = "";
        return;
      }

      // Source 1: Relay directory (full community list)
      let relayResults = [];
      try { if (relayConnected) relayResults = await window._relayFetchCommunityList?.() || []; } catch (e) { console.warn("[layers]", e.message); }

      // Source 2: P2P gossip from connected peers
      let gossipResults = [];
      try { gossipResults = await import("./gossip.js").then(g => g.queryPeers(bboxArr || [0, 0, 0, 0])).then(responses => { const all = []; for (const r of responses) if (r.results) all.push(...r.results); return all; }).catch(() => []); } catch (e) { console.warn("[layers]", e.message); }

      // Source 3: Relay as gossip peer
      let relayGossipResults = [];
      try { if (bboxArr && relayConnected) relayGossipResults = await window._relayQueryCommunities?.(bboxArr, searchTerm) || []; } catch (e) { console.warn("[layers]", e.message); }

      // Merge by community_id, preferring richer relay data
      const merged = new Map();

    // Layer 1: relay directory results (richest — has descriptions, member counts)
    for (const r of relayResults) {
      merged.set(r.community_id, { ...r, source: "relay" });
    }

    // Layer 2: relay gossip results (has real pin counts)
    for (const g of relayGossipResults) {
      const existing = merged.get(g.community_id);
      if (existing) {
        merged.set(g.community_id, {
          ...existing, ...g,
          pin_count: g.pin_count ?? existing.pin_count,
          member_count: existing.member_count ?? g.member_count,
          source: "relay + P2P",
        });
      } else {
        merged.set(g.community_id, { ...g, source: "relay" });
      }
    }

    // Layer 3: P2P gossip results
    for (const g of gossipResults) {
      const existing = merged.get(g.community_id);
      if (existing) {
        merged.set(g.community_id, {
          ...g, ...existing,
          pin_count: g.pin_count ?? existing.pin_count,
          name: existing.name || g.name,
          source: existing.source.includes("P2P") ? existing.source : existing.source + " + P2P",
        });
      } else {
        merged.set(g.community_id, { ...g, source: "P2P" });
      }
    }

    const communities = [...merged.values()];

    // Text search filter (client-side, instant)
    let searchFiltered = communities;
    if (searchTerm) {
      searchFiltered = communities.filter(c =>
        (c.name || "").toLowerCase().includes(searchTerm) ||
        (c.description || "").toLowerCase().includes(searchTerm)
      );
    }

    let nearby = 0, elsewhere = 0;

    // Relay configured but no communities found
    if (searchFiltered.length === 0) {
      listEl.innerHTML = `<div style="padding:16px;color:var(--text-dim);text-align:center;">
        ${searchTerm ? "No communities match your search." : "No communities published yet."}
      </div>`;
      const filterLabel = document.getElementById("disc-filter-label");
      if (filterLabel) filterLabel.textContent = relayConnected ? "No communities found" : "Relay not connected";
      return;
    }

    // Communities found — render filtered list
    const filtered = searchFiltered.filter(c => {
          if (!geoFilter || !mapBounds) return true;
          const bnds = c.bounds;
          if (!bnds || !Array.isArray(bnds) || bnds.length !== 4) { elsewhere++; return false; }
          const [swLat, swLng, neLat, neLng] = bnds;
          try {
            const cb = L.latLngBounds([[swLat, swLng], [neLat, neLng]]);
            if (mapBounds.intersects(cb)) { nearby++; return true; }
            elsewhere++; return false;
          } catch (_) { elsewhere++; return false; }
        }).map(c => {
          const contribOpen = c.governance?.contribution === "open";
          const contribBadge = contribOpen
            ? `<span style="background:rgba(5,150,105,0.15);color:#059669;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;">open</span>`
            : "";
          const lockIcon = c.password_protected ? `<span style="margin-right:2px;font-size:12px;">🔒</span>` : "";
          const srcLabel = c.source === "relay" ? "🌐 directory"
            : c.source === "P2P" ? "🔗 peer network"
            : c.source === "relay + P2P" ? "🌐 + 🔗"
            : "🔗 P2P";
          const pinInfo = c.pin_count !== undefined && c.pin_count !== "?"
            ? `<span>${c.pin_count} pin${c.pin_count !== 1 ? "s" : ""}</span>`
            : c.pin_count === "?" ? `<span>? pins nearby</span>` : "";
          const memberInfo = c.member_count !== undefined
            ? `<span>${c.member_count} member${c.member_count !== 1 ? "s" : ""}</span>`
            : "";
          return `
          <div class="disc-community-row" data-community-id="${escapeHtml(c.community_id)}" style="padding:10px;border-bottom:1px solid var(--border-light);cursor:default;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
              <span style="font-size:13px;font-weight:600;">${lockIcon}📌 ${escapeHtml(c.name)}${contribBadge}</span>
               <button class="disc-join-btn" data-id="${escapeHtml(c.community_id)}" data-bounds="${safeBounds(c.bounds)}" data-password-protected="${c.password_protected ? '1' : '0'}" style="padding:5px 14px;border:none;background:#059669;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;flex-shrink:0;">Join</button>
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

    listEl.innerHTML = filtered;
    const filterLabel = document.getElementById("disc-filter-label");
    if (filterLabel) {
      filterLabel.textContent = geoFilter && mapBounds ? `Showing ${nearby} near map view` : `Showing ${nearby + elsewhere} total`;
    }

    listEl.querySelectorAll(".disc-join-btn").forEach(btn => {
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
              const { generate_user_keypair_from_password, encode_hex } = await import("./core/pkg/e2e_core.js");
              const kp = generate_user_keypair_from_password(plaintextPass, sid);
              public_key = encode_hex(kp.public);
              secret_key = encode_hex(kp.secret);
              myWrappedDek = result.wrapped_dek;
            } else {
              const { generate_user_keypair, encode_hex } = await import("./core/pkg/e2e_core.js");
              const kp = generate_user_keypair();
              public_key = encode_hex(kp.public);
              secret_key = encode_hex(kp.secret);
              if (!myWrappedDek) {
                // Try join_wrapped_dek first (server-side bootstrap DEK)
                if (result.join_wrapped_dek) {
                  try {
                    const parts = result.join_wrapped_dek.split(":");
                    if (parts.length === 3) {
                      const { decrypt_with_password, decode_hex, wrap_dek } = await import("./core/pkg/e2e_core.js");
                      const dekHex = decrypt_with_password(parts[0], parts[1], parts[2], sid);
                      const dkBytes = decode_hex(dekHex);
                      myWrappedDek = wrap_dek(dkBytes, public_key);
                      import("./relay.js").then(r => {
                        r.rewrapMemberDek(sid, public_key, myWrappedDek);
                      }).catch(() => {});
                    }
                  } catch (e) { console.warn("[layers]", e.message); }
                }
                if (!myWrappedDek) {
                  const { requestMemberDek } = await import("./relay.js");
                  requestMemberDek(sid, public_key);
                }
              }
            }

            const existing = await DB.getTeam(sid);
            if (!existing) {
               await DB.saveTeam({ team_id: sid, name: result.name, public_key, secret_key, wrapped_dek: myWrappedDek || result.wrapped_dek, key_derivation: result.key_derivation || "random", community_secret_key: "", community_wrapped_dek: result.wrapped_dek || "" });
              await DB.saveCommunity({
                community_id: sid, name: result.name, description: result.description || "",
                genesis_public_key: result.genesis_public_key || "",
                visibility: result.visibility || "public",
                members: result.members || [],
                governance: result.governance || { contribution: "open", validation: "none", schema_authority: "any_member", key_rotation: "founder_only", fork_policy: "allowed", join_policy: "open" },
                bounds: (result.bounds && Array.isArray(result.bounds) && result.bounds.length === 4) ? result.bounds : null,
                relay_nodes: [],
    relay_url: (localStorage.getItem("pins-relay-urls") || localStorage.getItem("pins-relay-url"))?.split(",")[0]?.trim() || null,
              });
              await DB.saveLayers(sid, [{ layer_id: generate_uuid(), name: "Default", color: state.defaultLayerColor, visible: true, opacity: 1.0 }]);
              window._names[sid] = (result.name || "Subscribed") + " (← subscribed)";
            }
            clean();
            const { switchSet, loadSetList } = await import("./map.js");
            await loadSetList();
            await switchSet(sid);
            if (result.needs_key_exchange && !isPasswordDerived && !myWrappedDek) {
              toast("Joined " + result.name + " — awaiting key exchange", "#f97316");
            } else {
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
      listEl.innerHTML = '<div style="padding:16px;color:var(--text-dim);text-align:center;">Error loading communities</div>';
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
  ov.onclick = (e) => { if (e.target === ov) clean(); };
  document.getElementById("disc-refresh").onclick = () => { listEl.innerHTML = "Loading..."; renderList(); };
  const geoFilterBtn = document.getElementById("disc-geo-filter");
  if (geoFilterBtn) {
    geoFilterBtn.onclick = () => {
      geoFilter = !geoFilter;
      geoFilterBtn.textContent = geoFilter ? "📍 Near map view" : "🌐 All communities";
      geoFilterBtn.style.borderColor = geoFilter ? "#059669" : "#6b7280";
      geoFilterBtn.style.background = geoFilter ? "rgba(5,150,105,0.1)" : "transparent";
      geoFilterBtn.style.color = geoFilter ? "#059669" : "var(--text-dim)";
      listEl.innerHTML = "Loading...";
      renderList();
    };
  }

  const searchInput = document.getElementById("disc-search");
  if (searchInput) {
    let searchTimer = null;
    searchInput.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { listEl.innerHTML = "Loading..."; renderList(); }, 300);
    };
  }

  renderList();
}

export function showLayersModal() {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.3);z-index:2000;display:flex;align-items:center;justify-content:center;";

  function renderLayerList() {
    const layers = state.layers;
    const rows = layers.length > 0
      ? layers.map(l => {
        const isVisible = l.visible;
        const isActive = l.layer_id === state.activeLayerId;
        const eyeIcon = isVisible ? "👁" : "–";
        const schemaOpts = `<option value="">none</option>` + state.schemas.map(s => `<option value="${s.schema_id}" ${s.schema_id === l.default_schema_id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
        const schemaLabel = l.default_schema_id
          ? `<span style="font-size:10px;color:#059669;">📋 ${escapeHtml((state.schemas.find(s => s.schema_id === l.default_schema_id) || {}).name || "?")}</span>`
          : `<span style="font-size:10px;color:var(--text-muted);">no schema</span>`;
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
      }).join("")
      : '<div style="padding:12px;color:var(--text-dim);text-align:center;">No layers</div>';

    listEl.innerHTML = rows;

    listEl.querySelectorAll(".ly-vis-btn").forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        await toggleLayer(btn.dataset.id);
        renderLayerList();
        window._renderUI?.();
      };
    });

    listEl.querySelectorAll(".ly-activate").forEach(span => {
      span.onclick = async (e) => {
        e.stopPropagation();
        const lid = span.dataset.id;
        state.activeLayerId = (state.activeLayerId === lid) ? null : lid;
        renderLayerList();
        window._renderUI?.();
      };
    });

    listEl.querySelectorAll(".ly-schema-sel").forEach(sel => {
      sel.onchange = async (e) => {
        e.stopPropagation();
        const layerId = sel.dataset.id;
        const layer = state.layers.find(l => l.layer_id === layerId);
        if (!layer) return;
        layer.default_schema_id = sel.value || null;
        await DB.saveLayers(state.currentSet, state.layers);
        renderLayerList();
        window._renderUI?.();
      };
    });

    listEl.querySelectorAll(".ly-rename-btn").forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const layerId = btn.dataset.id;
        const span = btn.parentElement.querySelector(".ly-name");
        const current = state.layers.find(l => l.layer_id === layerId);
        if (!current) return;
        span.innerHTML = `<input type="text" class="ly-rename-input" value="${escapeHtml(current.name)}" style="width:100%;padding:2px;border:1px solid #2563eb;border-radius:3px;font-size:13px;box-sizing:border-box;" />`;
        const input = span.querySelector(".ly-rename-input");
        input.focus(); input.select();
        const doRename = async () => {
          const newName = input.value.trim();
          if (newName) {
            await renameLayer(layerId, newName);
            renderLayerList();
          }
        };
        input.addEventListener("keydown", ev => {
          if (ev.key === "Enter") doRename();
          if (ev.key === "Escape") renderLayerList();
        });
        input.addEventListener("blur", () => {
          setTimeout(() => { if (document.body.contains(input)) renderLayerList(); }, 150);
        });
      };
    });

    listEl.querySelectorAll(".ly-del-btn").forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        if (state.layers.length <= 1) {
          toast("Cannot delete the last layer", "#f97316");
          return;
        }
        const lid = btn.dataset.id;
        const layer = state.layers.find(l => l.layer_id === lid);
        const fallback = state.layers[0].layer_id === lid ? state.layers[1] : state.layers[0];
        if (!(await confirmDialog(`Delete "${layer?.name || "layer"}"? Pins will move to "${fallback?.name || "Default"}".`))) return;
        await deleteLayer(lid);
        renderLayerList();
        window._renderUI?.();
      };
    });

    listEl.querySelectorAll(".ly-opacity").forEach(slider => {
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
  ov.onclick = (e) => { if (e.target === ov) clean(); };

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
    form.querySelector("#ly-new-cancel").onclick = () => { form.remove(); btn.style.display = ""; };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(); if (e.key === "Escape") { form.remove(); btn.style.display = ""; } });
  };

  document.getElementById("ly-import-btn").onclick = async () => {
    const { showImportFromMapModal } = await import("./map-import.js");
    showImportFromMapModal();
  };

  renderLayerList();
}
