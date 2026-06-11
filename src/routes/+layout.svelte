<script>
	import { onMount } from 'svelte';
	import { initApp } from '$lib/init.js';
	import { state } from '$lib/state.js';
	import DialogRenderer from '$lib/components/ui/DialogRenderer.svelte';
	import { t, getLang, setLang, getSupported } from '$lib/i18n/i18n.js';
	import {
		confirm, alert, promptPassword, promptSetPassword,
		showQRAnswer, showIceServer, showProgress, showColorPicker,
		showDrawingForm, showPinDetail, showPinForm, showEditPinForm,
		showHostModal, showJoinModal
	} from '$lib/stores/dialogs.js';
	import '../app.css';

	let loaded = false;

	onMount(async () => {
		// Bridge dialog functions
		window._confirmDialog = confirm;
		window._alertDialog = alert;
		window._promptRoomPassword = promptPassword;
		window._promptSetPassword = promptSetPassword;
		window._showQRAnswerDialog = showQRAnswer;
		window._showIceServerDialog = showIceServer;
		window._showProgressDialog = showProgress;
		window._showColorPicker = showColorPicker;
		window._showDrawingForm = showDrawingForm;
		window._showPinDetail = showPinDetail;
		window._showPinForm = showPinForm;
		window._showEditPinForm = showEditPinForm;
		window._showHostModal = showHostModal;
		window._showJoinModal = showJoinModal;

		// Load engine globals BEFORE initApp — needed by hash join flow
		const [mapMod, syncMod, routingMod, soundsMod, pushMod] = await Promise.all([
			import('../../map.js'),
			import('../../sync.js'),
			import('../../map-routing.js'),
			import('../../sounds.js'),
			import('../../push-sub.js')
		]);

		window._showSetsModal = mapMod.showSetsModal;
		window._showLayersModal = mapMod.showLayersModal;
		window._showSchemaManagerModal = mapMod.showSchemaManagerModal;
		window._showCollectionsModal = mapMod.showCollectionsModal;
		window._showChainsModal = mapMod.showChainsModal;
		window._showNotificationsModal = mapMod.showNotificationsModal;
		window._startCurrentMapSlideshow = mapMod.startCurrentMapSlideshow;
		window._showDiscoverModal = mapMod.showDiscoverModal;
		window._applyTimeFilter = mapMod.applyTimeFilter;
		window._loadPins = mapMod.loadPins;
		window._loadDrawings = mapMod.loadDrawings;
		window._loadChains = mapMod.loadChains;
		window._refreshAllLayers = mapMod.refreshAllLayers;
		window._loadSetList = mapMod.loadSetList;
		window._switchSet = mapMod.switchSet;

		await initApp();

		// Bridge remaining engine functions

		window._exportMap = syncMod.showExportFormatModal;
		window._importMap = syncMod.importSet;
		window._shareMap = syncMod.shareMap;
		window._rotateKeys = syncMod.rotateSetKeys;

		window._toggleRouting = routingMod.toggleRouting;

		window._toggleSound = soundsMod.toggleSound;
		window._isSoundEnabled = soundsMod.isSoundEnabled;

		window._togglePush = pushMod.togglePush;
		window._isPushEnabled = pushMod.isPushEnabled;

		// Relay globals (needed by discover modal, peer list, push-sync)
		import('../../relay.js').then(r => {
			window._relayConnect = r.connect;
			window._relaySyncDelta = r.syncDelta;
			window._relayPushDelta = r.pushDelta;
			window._relayIsConnected = r.isRelayConnected;
			window._relayDisconnect = r.disconnect;
			window._relayFetchCommunityList = r.fetchCommunityList;
			window._relayQueryCommunities = r.queryCommunities;
			window._relayJoinCommunity = r.joinCommunity;
			window._relayPublishCommunity = r.publishCommunity;
			window._relayUnpublishCommunity = r.unpublishCommunity;
			window._relayDeleteCommunity = r.deleteCommunity;
			window._relayPublishLayer = r.publishLayer;
			window._relaySubscribeLayer = r.subscribeLayer;
			window._relaySyncSubscribedLayers = r.syncSubscribedLayers;
			window._relayListPublicLayers = r.listPublicLayers;
			window._relayGetCommunityPeers = r.getCommunityPeers;
		});

		// Offline (loaded lazily)
		import('../../map-offline.js').then(m => {
			window._showOfflineDownloadModal = m.showOfflineDownloadModal;
		});

		// Mesh status (loaded lazily)
		import('../../mesh.js').then(m => {
			window._isMeshConnected = () => m.isMeshConnected?.() || false;
			window._meshPeerCount = () => m.meshPeerCount?.() || 0;
		});

		// Donate modal (simple QR-based, defined in drawer.js)
		window._showDonateModal = async () => {
			const { generate_qr_svg } = await import('../../core/pkg/e2e_core.js');
			const qrSvg = generate_qr_svg('https://cash.app/$catpeoplerock');
			ov(qrSvg);
			function ov(svg) {
				const el = document.createElement('div');
				el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;';
				el.innerHTML = `<div style="background:var(--bg-card);padding:20px;border-radius:8px;min-width:280px;box-shadow:0 4px 20px rgba(0,0,0,0.3);text-align:center;"><h3 style="margin:0 0 16px;color:var(--text);">Support piggPin</h3><div style="display:inline-block;background:white;padding:12px;border-radius:8px;margin-bottom:12px;">${svg}</div><div style="font-size:18px;font-weight:600;margin-bottom:16px;color:var(--text);">$catpeoplerock</div><button id="dcopy" style="padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:4px;cursor:pointer;">Copy Tag</button></div>`;
				document.body.appendChild(el);
				el.querySelector('#dcopy').onclick = () => { navigator.clipboard.writeText('$catpeoplerock'); window._svelteToast?.('Copied', '#16a34a'); };
				el.onclick = e => { if (e.target === el) el.remove(); };
			}
		};

		// Lang chooser
		window._showLangChooser = async () => {
			const langs = getSupported();
			const items = langs.map(l => `<button data-lang="${l}" style="display:block;width:100%;padding:6px 12px;border:none;background:${l === getLang() ? 'var(--bg-input)' : 'transparent'};color:var(--text);cursor:pointer;font-size:12px;text-align:left;">${l.toUpperCase()}</button>`).join('');
			const el = document.createElement('div');
			el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;';
			el.innerHTML = `<div style="background:var(--bg-card);padding:12px;border-radius:8px;min-width:160px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">${items}</div>`;
			el.onclick = e => { if (e.target === el) el.remove(); };
			document.body.appendChild(el);
			el.querySelectorAll('button').forEach(b => { b.onclick = () => { setLang(b.dataset.lang); el.remove(); }; });
		};

		// Host modal — use relay when connected, fallback to P2P
		window._showHostModal = async () => {
			try {
				const { isRelayConnected } = await import('../../relay.js');
				if (isRelayConnected()) {
					const relayUrl = (localStorage.getItem('pins-relay-urls') || '').split(',')[0]?.trim();
					if (relayUrl) {
						const { hostGroupViaRelay } = await import('../../sync.js');
						hostGroupViaRelay(relayUrl);
						return;
					}
				}
			} catch (_) {}
			// Fallback to P2P
			const { hostGroup } = await import('../../sync.js');
			try { hostGroup(); } catch (e) {
				window._svelteToast?.('Failed to host: ' + (e.message || 'unknown'), '#dc2626');
			}
		};

		// Join modal — use relay when connected, fallback to P2P
		window._showJoinModal = async () => {
			try {
				const { isRelayConnected } = await import('../../relay.js');
				if (isRelayConnected()) {
					const relayUrl = (localStorage.getItem('pins-relay-urls') || '').split(',')[0]?.trim();
					const roomId = new URLSearchParams(window.location.hash.slice(1)).get('room');
					if (relayUrl && roomId) {
						const { joinPeerViaRelay } = await import('../../sync.js');
						joinPeerViaRelay(relayUrl, roomId);
						return;
					}
				}
			} catch (_) {}
			// Fallback to P2P
			const { showQRJoinDialog } = await import('../../dialogs.js');
			const callbacks = {
				onSetReceived(setId) {
					return import('../../map.js').then(m => m.switchSet(setId));
				},
				onRenderUI() {}
			};
			showQRJoinDialog(callbacks);
		};

		loaded = true;

		// --- Auto-process #join= URL (P2P WebRTC invite) ---
		const hash = window.location.hash || '';
		if (hash.startsWith('#join=')) {
			const raw = hash.slice('#join='.length);
			setTimeout(async () => {
				try {
					let code = raw.replace(/-/g, '+').replace(/_/g, '/');
					while (code.length % 4) code += '=';
					code = atob(code);
					const { acceptOffer } = await import('../../peer.js');
					const { generate_qr_svg } = await import('../../core/pkg/e2e_core.js');
					const { switchSet } = await import('../../map.js');
					const { setId, compact } = await acceptOffer(code, state.user.id, state.displayName);
					window._pendingJoinSet = true;
					const aqr = generate_qr_svg(compact);
					import('../../dialogs.js').then(d => d.showQRAnswerDialog('Send Back', compact, aqr));
					if (setId) await switchSet(setId);
				} catch (e) {
					console.error('[P2P] acceptOffer from URL failed:', e.message);
					window._svelteToast?.('P2P connection failed: ' + e.message, '#dc2626');
				}
			}, 1000);
		}

		// --- Undo/redo keyboard shortcuts ---
		document.addEventListener('keydown', async (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
				e.preventDefault();
				if (e.shiftKey) {
					// Redo
					const { redo } = await import('../../map.js');
					redo();
				} else {
					// Undo
					const { undo } = await import('../../map.js');
					undo();
				}
			}
		});

		// --- Click delegation for popup buttons (replaces main.js click handler) ---
		document.addEventListener('click', async (e) => {
			const b = e.target.closest('button');
			if (!b) return;

			// Edit pin
			if (b.matches('.edit-pin-btn')) {
				e.stopPropagation();
				showEditPinForm(b.dataset.pid);
				return;
			}
			// Delete pin
			if (b.matches('.delete-pin-btn')) {
				e.stopPropagation();
				if (await confirm(t('deleteConfirm') || 'Delete?')) {
					const { deletePin } = await import('../../map.js');
					await deletePin(b.dataset.pid);
				}
				return;
			}
			// Expand pin detail
			if (b.matches('.pin-expand-btn')) {
				e.stopPropagation();
				showPinDetail(b.dataset.pid);
				return;
			}
			// Edit drawing
			if (b.matches('.edit-dwg-btn')) {
				e.stopPropagation();
				import('../../map.js').then(m => m.showEditDrawingForm(b.dataset.did));
				return;
			}
			// Delete drawing
			if (b.matches('.delete-dwg-btn')) {
				e.stopPropagation();
				if (await confirm(t('deleteConfirm') || 'Delete?')) {
					const { deleteDrawing } = await import('../../map.js');
					await deleteDrawing(b.dataset.did);
				}
				return;
			}
			// Vote up/down
			if (b.matches('.vote-up-btn') || b.matches('.vote-down-btn')) {
				e.stopPropagation();
				const pid = b.dataset.pid;
				if (!pid || !state.signingSecretKey) return;
				const direction = b.matches('.vote-up-btn') ? 'up' : 'down';
				const { getPin, savePin } = await import('../../db.js');
				const { sign, encode_hex } = await import('../../core/pkg/e2e_core.js');
				const { refreshPinMarkerPopup } = await import('../../map.js');
				const row = await getPin(pid).catch(() => null);
				if (!row) return;
				row.votes = row.votes || [];
				const ts = Date.now();
				const payload = encode_hex(new TextEncoder().encode(`${pid}|${direction}|${ts}`));
				const sig = sign(payload, state.signingSecretKey);
				row.votes.push({ direction, pubkey: state.signingPublicKey, timestamp: ts, signature: sig });
				await savePin(row);
				const marker = state.markers?.find(m => m._pinId === pid);
				if (marker) refreshPinMarkerPopup(marker);
				window._svelteToast?.(direction === 'up' ? 'Upvoted' : 'Downvoted', '#16a34a');
				return;
			}
			// Flag
			if (b.matches('.flag-btn')) {
				e.stopPropagation();
				const pid = b.dataset.pid;
				if (!pid || !state.signingSecretKey) return;
				const { getPin, savePin } = await import('../../db.js');
				const { sign, encode_hex } = await import('../../core/pkg/e2e_core.js');
				const row = await getPin(pid).catch(() => null);
				if (!row) return;
				row.flags = row.flags || [];
				const ts = Date.now();
				const payload = encode_hex(new TextEncoder().encode(`${pid}|flag|${ts}`));
				const sig = sign(payload, state.signingSecretKey);
				row.flags.push({ pubkey: state.signingPublicKey, timestamp: ts, signature: sig });
				await savePin(row);
				import('../../relay.js').then(r => r.flagPin(state.currentSet, pid, state.signingPublicKey)).catch(() => {});
				window._svelteToast?.('Flagged for review', '#f97316');
				return;
			}
		});
	});

	// --- Install banner (PWA) ---
	let installPrompt = null;
	const _embed = (() => {
		try { return new URLSearchParams(window.location.search).get('embed') === '1' || window.self !== window.top; }
		catch (_) { return false; }
	})();
	if (!_embed) {
		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			installPrompt = e;
			showInstallBanner();
		});
		window.addEventListener('appinstalled', () => {
			installPrompt = null;
			const b = document.getElementById('install-banner');
			if (b) b.remove();
		});
	}

	function showInstallBanner() {
		if (window._isEmbed) return;
		if (localStorage.getItem('pins-install-dismissed')) return;
		const existing = document.getElementById('install-banner');
		if (existing) return;
		const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
		const banner = document.createElement('div');
		banner.id = 'install-banner';
		if (isIOS) {
			banner.innerHTML = `<span class="install-banner-icon">📌</span><span><b>Add to Home Screen:</b> tap Share → Add to Home Screen</span><button class="install-banner-close">✕</button>`;
		} else if (installPrompt) {
			banner.innerHTML = `<span class="install-banner-icon">📌</span><span>Add to Home Screen</span><button class="install-banner-btn" id="install-banner-do">Install</button><button class="install-banner-close">✕</button>`;
		} else {
			return;
		}
		document.body.appendChild(banner);
		const doBtn = banner.querySelector('#install-banner-do');
		if (doBtn) doBtn.onclick = async () => {
			if (installPrompt) {
				await installPrompt.prompt();
				installPrompt = null;
			}
			banner.remove();
		};
		banner.querySelector('.install-banner-close').onclick = () => {
			banner.remove();
			localStorage.setItem('pins-install-dismissed', Date.now());
		};
	}
</script>

{#if !loaded}
	<div class="app-loader">
		<div>
			<div class="spinner"></div>
			<div class="label">Loading map…</div>
		</div>
	</div>
{/if}

<div id="offline-bar" style="display:none">You are offline — local features available</div>

<slot />

<DialogRenderer />