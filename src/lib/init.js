// App initialization — replaces main.js bootstrap (lines 283-520)
// Called once from +layout.svelte onMount

import initWasm, {
	generate_user_keypair,
	generate_signing_keypair,
	generate_uuid
} from '../../core/pkg/e2e_core.js';
import initSpatial, { SpatialIndex } from '../../zig-core/pkg/spatial.js';
import * as DB from '../../db.js';
import * as Sync from '../../sync.js';
import * as Relay from '../../relay.js';
import * as Peer from '../../peer.js';
import { state } from '../../state.js';
import { setLang, getLang } from './i18n/i18n.js';

let _initPromise = null;

export function initApp() {
	if (_initPromise) return _initPromise;
	_initPromise = _doInit();
	return _initPromise;
}

async function _doInit() {
	// Embed mode detection
	const isEmbed = (() => {
		try {
			const hasParam = new URLSearchParams(window.location.search).get('embed') === '1';
			return hasParam || window.self !== window.top;
		} catch (_) { return false; }
	})();
	const isPicker = new URLSearchParams(location.search).get('picker') === '1';
	window._isEmbed = isEmbed;
	if (isEmbed) document.body.classList.add('embed');

	// Theme
	const saved = localStorage.getItem('pins-theme');
	if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
		document.body.classList.add('dark');
	}

	// Service worker
	if ('serviceWorker' in navigator && !isEmbed) {
		navigator.serviceWorker.register('/sw.js').catch(err => {
			console.warn('[pwa] SW unavailable — expected on dev HTTP:', err.message);
		});
	}

	// Offline bar
	window.addEventListener('online', updateOfflineBar);
	window.addEventListener('offline', updateOfflineBar);
	updateOfflineBar();

	// Initialize WASM (Rust crypto + Zig spatial)
	await initWasm();

	try {
		await initSpatial();
		window._spatialIdx = new SpatialIndex(4096);
	} catch (e) {
		console.warn('[spatial] spatial index init failed:', e.message);
	}

	// Signing keypair
	let sigKp = await DB.getSigningKey();
	if (!sigKp) {
		const legacy = localStorage.getItem('pins-signing-key');
		if (legacy) {
			try { sigKp = JSON.parse(legacy); } catch (e) { console.warn('[init]', e.message); }
			localStorage.removeItem('pins-signing-key');
		}
		if (!sigKp) {
			sigKp = generate_signing_keypair();
		}
		await DB.saveSigningKey(sigKp);
	}
	state.signingPublicKey = sigKp.public;
	state.signingSecretKey = sigKp.secret;
	DB.setMigrationSigningPubkey(sigKp.public);

	// Profile
	const p = await DB.getProfile();
	if (p) {
		state.user = { id: p.user_id };
		state.displayName = p.display_name || 'Me';
	} else {
		await DB.saveProfile({ user_id: state.user.id, display_name: state.displayName });
	}

	// WebRTC
	Sync.setupPeer();
	const savedIce = localStorage.getItem('pins-ice-servers');
	if (savedIce) Peer.setIceServers(JSON.parse(savedIce));

	// Known peers
	const knownList = await DB.getKnownPeers();
	for (const kp of knownList) {
		state.peers.set('known_' + kp.user_id, {
			name: kp.display_name, setId: null, userId: kp.user_id, offline: true
		});
	}

	// Relay
	await Relay.connectAll();

	// Map list (needed for drawer)
	await loadMaps();

	// Embed postMessage handshake
	if (isEmbed) {
		window.addEventListener('message', (e) => {
			if (e.data?.type === 'komun:identity' && e.data.displayName) {
				state.displayName = e.data.displayName;
				DB.saveProfile({ user_id: state.user.id, display_name: e.data.displayName });
				if (e.data.communityPassword) {
					window._komunPassword = e.data.communityPassword;
				}
			}
		});
		if (window.location.hash.startsWith('#community=')) {
			window._komunPassword = null;
		}
		try {
			window.parent.postMessage({ type: 'piggpin:ready' }, '*');
		} catch (_) {}
		if (isPicker) {
			window._pickMode = true;
			document.body.classList.add('picking');
			const enable = () => {
				if (state.currentSet && state.map) {
					const center = state.map.getCenter();
					import('../../map.js').then(m => m.addPickMarker(center.lat, center.lng));
				} else {
					setTimeout(enable, 500);
				}
			};
			setTimeout(enable, 1000);
		}
	}

	console.log('[init] App initialized');
}

async function loadMaps() {
	const { state } = await import('../../state.js');
	const { loadSetList, switchSet, createTutorial } = await import('../../map.js');

	await loadSetList();

	const hash = window.location.hash || '';
	const pendingB64 = localStorage.getItem('pending-community');
	// Clear stale pending-community if it's from a P2P #join= URL
	if (hash.startsWith('#join=')) localStorage.removeItem('pending-community');
	const hasPendingJoin = hash.startsWith('#community=') || hash.startsWith('#map=')
		|| hash.startsWith('#share=') || hash.startsWith('#relay=')
		|| !!pendingB64;
	if (hasPendingJoin) {
		const joined = await processHashJoin(hash, pendingB64);
		if (joined) return;
	}

	const last = localStorage.getItem('activeSet');
	const ids = Object.keys(window._names || {});
	if (last && ids.includes(last)) await switchSet(last);
	else if (ids.length > 0) await switchSet(ids[0]);
	else await createTutorial();
}

async function processHashJoin(hash, pendingB64) {
	// Handle #map= raw hash import (offline, full map data embedded)
	if (hash.startsWith('#map=')) {
		try {
			const raw = hash.slice('#map='.length);
			const { decompress_gzip, base64url_decode, decrypt_with_password, encode_hex, deserialize_container } = await import('../../core/pkg/e2e_core.js');
			const { doImport, unpackHexFields } = await import('../../sync.js');
			const decoded = base64url_decode(raw);

			let data;
			if (decoded.length >= 2 && decoded[0] === 0x1f && decoded[1] === 0x8b) {
				data = decompress_gzip(decoded);
			} else {
				// Try plain text (not gzip compressed)
				const text = new TextDecoder().decode(decoded);
				if (text.startsWith('{')) {
					await doImport(unpackHexFields(JSON.parse(text)));
					return true;
				}
				return false;
			}

			if (data[0] === 1) {
				if (data.length < 30) return false;
				const salt = data.slice(1, 17);
				const nonce = data.slice(17, 29);
				const ct = data.slice(29);
				const pass = await new Promise(resolve => {
					const ov = document.createElement('div');
					ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;';
					ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">Import — enter password</h3><input id="hi-pwd" type="password" placeholder="Password" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="hi-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;color:var(--text);">Cancel</button><button id="hi-ok" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Import</button></div></div>`;
					document.body.appendChild(ov);
					ov.querySelector('#hi-cancel').onclick = () => { ov.remove(); resolve(null); };
					ov.querySelector('#hi-ok').onclick = () => { ov.remove(); resolve(document.getElementById('hi-pwd').value); };
					ov.querySelector('#hi-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') ov.querySelector('#hi-ok').click(); });
					ov.onclick = e => { if (e.target === ov) { ov.remove(); resolve(null); } };
					ov.querySelector('#hi-pwd').focus();
				});
				if (!pass) return false;
				const dec = decrypt_with_password(encode_hex(ct), encode_hex(nonce), encode_hex(salt), pass);
				const json = deserialize_container(dec);
				await doImport(unpackHexFields(JSON.parse(json)));
			} else {
				const json = deserialize_container(data);
				await doImport(unpackHexFields(JSON.parse(json)));
			}
			return true;
		} catch (e) {
			console.error('[init] hash import failed:', e.message);
			return false;
		}
	}

	// Try each hash type and pending-community localStorage
	const sources = [];
	if (pendingB64) sources.push({ raw: pendingB64, isLocalStorage: true });
	if (hash) {
		for (const prefix of ['#community=', '#map=', '#share=', '#relay=']) {
			if (hash.startsWith(prefix)) {
				sources.push({ raw: hash.slice(prefix.length), isLocalStorage: false });
				break;
			}
		}
	}

	for (const src of sources) {
		try {
			// Decode base64
			let b64 = src.raw.replace(/-/g, '+').replace(/_/g, '/');
			while (b64.length % 4) b64 += '=';
			const raw = atob(b64);
			let buf;
			try { buf = new Uint8Array(raw.split('').map(c => c.charCodeAt(0))); }
			catch (_) { continue; }

			let cidUuid, name, pw, relayUrl = '', embeddedCommunitySk = null;
			let focusLat = null, focusLng = null, focusZoom = 15;

			if (raw.startsWith('{')) {
				// JSON format
				try {
					const payload = JSON.parse(raw);
					cidUuid = payload.cid; name = payload.n; pw = payload.pw === 'true' || payload.pw === true;
					relayUrl = payload.r || '';
					embeddedCommunitySk = payload.sk || null;
					if (payload.lat) focusLat = parseFloat(payload.lat);
					if (payload.lon) focusLng = parseFloat(payload.lon);
					if (payload.zoom) focusZoom = parseInt(payload.zoom, 10) || 15;
				} catch (_) { continue; }
			} else if (buf && buf.length >= 19) {
				// Binary format
				let pos = 0;
				const nlen = buf[pos++];
				name = new TextDecoder().decode(buf.slice(pos, pos + nlen));
				pos += nlen;
				cidUuid = bytesToUuid(buf.slice(pos, pos + 16));
				pos += 16;
				const relayLen = buf[pos++];
				relayUrl = relayLen > 0 ? new TextDecoder().decode(buf.slice(pos, pos + relayLen)) : '';
				pos += relayLen;
				pw = !!(buf[pos] & 1);
				const hasSK = !!(buf[pos] & 0x04);
				pos++;
				if (hasSK && buf.length > pos + 1) {
					const skLen = (buf[pos] << 8) | buf[pos + 1];
					pos += 2;
					if (skLen > 0 && buf.length >= pos + skLen) {
						embeddedCommunitySk = Array.from(buf.slice(pos, pos + skLen)).map(b => b.toString(16).padStart(2, '0')).join('');
						pos += skLen;
					}
				}
				// Skip invite restore if present
				const isInvite = !!(buf[pos - (hasSK ? 9 : 1)] & 2);
				if (isInvite) {
					if (buf.length > pos) {
						const roleLen = buf[pos++];
						pos += roleLen + 8 + 72; // role + expiry (8) + nonce (8) + sig (64)
					}
				}
				// Focus coordinates
				if (!isInvite && buf.length > pos) {
					const focusStr = new TextDecoder().decode(buf.slice(pos));
					const parts = focusStr.split(',');
					if (parts.length >= 2) {
						focusLat = parseFloat(parts[0]);
						focusLng = parseFloat(parts[1]);
						const v = parseInt(parts[2], 10);
						if (parts.length >= 3 && !isNaN(v)) focusZoom = v;
					}
				}
			}

			if (!cidUuid || !name) continue;
			// Validate relay URL — must be empty or look like a real URL
			if (relayUrl && relayUrl.length > 200) continue;

			console.log('[init] Hash join: cid=', cidUuid, 'name=', name, 'relay=', relayUrl);

			// Ensure relay connection
			if (relayUrl) {
				if (!Relay.isRelayConnected(relayUrl)) {
					try { await Relay.connect(relayUrl); } catch (e) { /* will check again below */ }
				}
			}

			// Join community
			let passHash = null;
			let plaintextPass = null;
			if (pw) {
				if (window._komunPassword) {
					const { hashCommunityPassword } = await import('../../dialogs.js');
					plaintextPass = window._komunPassword;
					passHash = await hashCommunityPassword(plaintextPass, cidUuid);
					delete window._komunPassword;
				} else {
					const pass = await new Promise(resolve => {
						const ov = document.createElement('div');
						ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;';
						ov.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><h3 style="margin:0 0 8px;">${name} requires a password</h3><input id="hj-pwd" type="password" placeholder="Password" style="width:100%;padding:6px;margin-bottom:12px;box-sizing:border-box;border:1px solid var(--border);border-radius:4px;background:var(--bg-input);color:var(--text);" /><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="hj-cancel" style="padding:6px 14px;border:1px solid var(--border);background:var(--border-light);border-radius:4px;cursor:pointer;color:var(--text);">Cancel</button><button id="hj-ok" style="padding:6px 14px;border:none;background:#2563eb;color:white;border-radius:4px;cursor:pointer;">Join</button></div></div>`;
						document.body.appendChild(ov);
						ov.querySelector('#hj-cancel').onclick = () => { ov.remove(); resolve(null); };
						ov.querySelector('#hj-ok').onclick = () => { ov.remove(); resolve(document.getElementById('hj-pwd').value); };
						ov.onclick = e => { if (e.target === ov) { ov.remove(); resolve(null); } };
						ov.querySelector('#hj-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') ov.querySelector('#hj-ok').click(); });
						ov.querySelector('#hj-pwd').focus();
					});
					if (!pass) { localStorage.removeItem('pending-community'); return false; }
					plaintextPass = pass;
					passHash = await hashCommunityPassword(pass, cidUuid);
				}
			}
			delete window._komunPassword;

			const result = await Relay.joinCommunity(cidUuid, passHash, relayUrl);
			if (!result || !result.public_key || !result.wrapped_dek) {
				localStorage.removeItem('pending-community');
				return false;
			}

			const sid = result.community_id;
			const isPasswordDerived = result.key_derivation === 'pbkdf2';

			let public_key, secret_key, myWrappedDek;
			if (isPasswordDerived && plaintextPass) {
				const { generate_user_keypair_from_password, encode_hex } = await import('../../core/pkg/e2e_core.js');
				const kp = generate_user_keypair_from_password(plaintextPass, result.community_id);
				public_key = encode_hex(kp.public);
				secret_key = encode_hex(kp.secret);
				myWrappedDek = result.wrapped_dek || '';
			} else {
				const { generate_user_keypair, wrap_dek, unwrap_dek, encode_hex } = await import('../../core/pkg/e2e_core.js');
				const kp = generate_user_keypair();
				public_key = encode_hex(kp.public);
				secret_key = encode_hex(kp.secret);
				myWrappedDek = result.individually_wrapped_dek || '';

				if (!myWrappedDek && embeddedCommunitySk) {
					try {
						const dk = unwrap_dek(result.wrapped_dek, embeddedCommunitySk);
						if (dk) {
							myWrappedDek = wrap_dek(dk, public_key);
							Relay.rewrapMemberDek(sid, public_key, myWrappedDek);
						}
					} catch (_) {}
				}
			}

			if (!myWrappedDek) {
				Relay.requestMemberDek(sid, public_key);
			}

			await DB.saveTeam({ team_id: sid, name: result.name || name, public_key, secret_key, wrapped_dek: myWrappedDek || result.wrapped_dek, key_derivation: result.key_derivation || 'random', community_secret_key: embeddedCommunitySk || '', community_wrapped_dek: result.wrapped_dek || '' });
			await DB.saveCommunity({ community_id: sid, name: result.name || name, description: result.description || '', genesis_public_key: result.genesis_public_key || '', visibility: result.visibility || 'public', members: result.members || [], governance: result.governance || { contribution: 'open', validation: 'none', schema_authority: 'any_member', key_rotation: 'founder_only', fork_policy: 'allowed', join_policy: 'open' }, bounds: result.bounds || null, relay_nodes: [], relay_url: relayUrl || null });
			await DB.saveLayers(sid, [{ layer_id: generate_uuid(), name: 'Default', color: '#2563eb', visible: true, opacity: 1.0 }]);
			window._names[sid] = (result.name || name) + ' (← joined)';

			localStorage.removeItem('pending-community');
			localStorage.setItem('activeSet', sid);

			const { switchSet, loadPins, loadDrawings, loadSetList } = await import('../../map.js');
			await loadSetList();
			await switchSet(sid);
			await Relay.syncDelta(sid);
			await loadPins();
			await loadDrawings();

			if (focusLat !== null && focusLng !== null && !isNaN(focusLat) && !isNaN(focusLng)) {
				state.map?.flyTo([focusLat, focusLng], focusZoom, { duration: 1 });
			}

			window._svelteToast?.(`Joined ${result.name || name} via link`, '#16a34a');
			return true;
		} catch (e) {
			console.error('[init] hash join failed:', e.message);
			localStorage.removeItem('pending-community');
		}
	}
	return false;
}

function bytesToUuid(bytes) {
	const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
	return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function updateOfflineBar() {
	const bar = document.getElementById('offline-bar');
	if (!bar) return;
	if (navigator.onLine) {
		bar.style.display = 'none';
		document.body.classList.remove('is-offline');
	} else {
		bar.style.display = 'flex';
		document.body.classList.add('is-offline');
	}
}
