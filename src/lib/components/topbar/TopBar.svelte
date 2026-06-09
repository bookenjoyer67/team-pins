<script>
	import { currentSet, _notifications } from '$stores/app.js';
	import { peers } from '$stores/peers.js';
	import { map } from '$stores/map.js';
	import { t, lang } from '$lib/i18n/i18n.js';
	import { state } from '$lib/state.js';
	import { drawerExpanded } from '$lib/stores/drawer.js';
	import { onMount } from 'svelte';

	let searchText = '';
	let unreadCount = 0;
	let mapName = '';
	let peerCount = 0;
	let meshCount = 0;
	let meshOn = false;
	let activeLayerLabel = '';
	let communityDot = '';
	let popout = false;

	function refresh() {
		// Map name
		mapName = (window._names?.[$currentSet] || t('noMap') || 'No map');

		// Active layer indicator
		const activeLayer = state.layers.find(l => l.layer_id === state.activeLayerId);
		activeLayerLabel = activeLayer
			? `<span style="font-size:10px;color:${activeLayer.color};margin-left:4px;">→ ${activeLayer.name.slice(0, 12)}</span>`
			: '';

		// Peer count
		peerCount = [...peers.get().values()].filter(p => p.setId === $currentSet && !p.offline).length;

		// Mesh
		meshOn = window._isMeshConnected?.() || false;
		meshCount = window._meshPeerCount?.() || 0;

		// Community dot
		const comm = state.currentCommunity;
		communityDot = comm?.visibility && comm.visibility !== 'local'
			? '<span style="color:#2563eb;font-size:9px;">●</span>' : '';

		// Notifications
		unreadCount = _notifications.filter(n => !n.read).length;
	}

	function geocode() {
		const q = searchText.trim();
		const m = $map;
		if (q.length < 2 || !navigator.onLine || !m) return;
		const now = Date.now();
		if (now - (window._nominatimLastCall || 0) < 2000) return;
		window._nominatimLastCall = now;
		const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en`;
		fetch(url).then(r => r.json()).then(data => {
			if (!data.features?.length || m !== $map) return;
			const f = data.features[0];
			const extent = f.properties.extent;
			if (extent?.length === 4) m.fitBounds([[extent[1], extent[0]], [extent[3], extent[2]]]);
			else { const [lng, lat] = f.geometry.coordinates; m.setView([lat, lng], 15); }
		}).catch(() => {});
	}

	let filterTimer = null;
	function filterPins() {
		clearTimeout(filterTimer);
		filterTimer = setTimeout(() => {
			const q = searchText.toLowerCase().trim();
			const markers = state.markers;
			for (let i = 0; i < markers.length; i++) {
				const match = !q || (state.pinSearchText[i] && state.pinSearchText[i].includes(q));
				markers[i].setOpacity(match ? (markers[i]._layerOpacity ?? 1) : 0.15);
			}
		}, 200);
	}

	onMount(() => {
		const int = setInterval(refresh, 500);
		refresh();
		lang.subscribe(refresh);
		return () => clearInterval(int);
	});
</script>

<div id="tabs-row">
	<div class="topbar-inner">
		<div class="topbar-left">
			<span class="topbar-mapname">
				{mapName}
				{@html communityDot}
				{@html activeLayerLabel}
			</span>
			<div class="topbar-search-wrap">
				<input
					id="topbar-search"
					type="text"
					bind:value={searchText}
					placeholder={t('searchPlaces') || 'Search places...'}
					oninput={filterPins}
					onkeydown={(e) => {
						if (e.key === 'Enter') { e.preventDefault(); geocode(); }
						else if (e.key === 'Escape') { searchText = ''; filterPins(); }
					}}
				/>
				<button id="topbar-search-btn" onclick={geocode}>🔍</button>
			</div>
		</div>
		<div class="topbar-right">
			{#if peerCount > 0}
				<span class="badge peer" onclick={() => {
					const pl = document.getElementById('peer-list');
					if (pl) pl.classList.toggle('mobile-visible');
					const hp = document.getElementById('history-panel');
					if (hp) hp.classList.toggle('mobile-visible');
				}}>● {peerCount}</span>
			{/if}
			{#if meshOn}
				<span class="badge mesh">📡 {meshCount || ''}</span>
			{/if}
			<button id="topbar-notif-btn" title="Notifications" onclick={() => window._showNotificationsModal?.()}>
				🔔
				{#if unreadCount > 0}
					<span class="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
				{/if}
			</button>
			<button id="topbar-slideshow-btn" title="Slideshow" onclick={() => window._startCurrentMapSlideshow?.()}>▶</button>
			<button id="drawer-toggle-btn" title="Menu" onclick={() => popout = !popout}>≡</button>
		</div>
	</div>
</div>

{#if popout}
	<div class="popout-backdrop" onclick={() => popout = false}></div>
	<div class="popout-menu">
		<button class="popout-item" onclick={() => { window._showSetsModal?.(); popout = false; }}>🗺 Maps</button>
		<button class="popout-item" onclick={() => { window._showLayersModal?.(); popout = false; }}>📑 Layers</button>
		<button class="popout-item" onclick={() => { window._showSchemaManagerModal?.(); popout = false; }}>📋 Schemas</button>
	</div>
{/if}

<style>
	.topbar-inner {
		display: flex; align-items: center; justify-content: space-between;
		width: 100%; gap: 8px;
	}
	.topbar-left {
		display: flex; align-items: center; gap: 8px;
		flex: 1; min-width: 0; overflow: hidden;
	}
	.topbar-right {
		display: flex; align-items: center; gap: 8px; flex-shrink: 0;
	}
	.topbar-mapname {
		font-size: 14px; font-weight: 500; color: var(--text);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;
	}
	.badge { font-size: 11px; flex-shrink: 0; }
	.badge.peer { color: #16a34a; }
	.badge.mesh { color: #16a34a; margin-left: 4px; }
	.topbar-search-wrap {
		display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0;
	}
	#topbar-search {
		flex: 1; padding: 3px 6px; border: 1px solid var(--border);
		border-radius: 4px; background: var(--bg-input); color: var(--text);
		font-size: 12px; min-width: 0;
	}
	#topbar-search-btn {
		width: 24px; height: 24px; border: none; background: transparent;
		color: var(--text-dim); cursor: pointer; font-size: 13px;
		padding: 0; border-radius: 3px; flex-shrink: 0;
	}
	#topbar-notif-btn {
		width: 26px; height: 26px; border: none; background: transparent;
		color: var(--text-dim); cursor: pointer; font-size: 14px;
		padding: 0; border-radius: 4px; position: relative;
	}
	.notif-badge {
		position: absolute; top: -2px; right: -2px; background: #dc2626;
		color: white; border-radius: 50%; min-width: 14px; height: 14px;
		font-size: 9px; font-weight: 600; display: flex; align-items: center;
		justify-content: center; padding: 0 2px;
	}
	#topbar-slideshow-btn, #drawer-toggle-btn {
		width: 28px; height: 28px; border: none; background: transparent;
		color: var(--text-dim); cursor: pointer; font-size: 16px;
		padding: 0; border-radius: 4px;
	}
	#tabs-row {
		position: fixed; top: 0; left: 0; right: 0; z-index: 999;
		background: var(--bg-glass); padding: 6px 12px; backdrop-filter: blur(4px);
	}
	.popout-backdrop {
		position: fixed; inset: 0; z-index: 1998;
	}
	.popout-menu {
		position: fixed; top: 46px; right: 12px; z-index: 1999;
		background: var(--bg-card); border: 1px solid var(--border);
		border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.2);
		min-width: 160px; padding: 4px; display: flex; flex-direction: column;
	}
	.popout-item {
		display: flex; align-items: center; gap: 8px;
		width: 100%; padding: 8px 12px; border: none;
		background: transparent; color: var(--text);
		cursor: pointer; font-size: 13px; text-align: left;
		border-radius: 4px;
	}
	.popout-item:hover { background: var(--bg-input); }
</style>
