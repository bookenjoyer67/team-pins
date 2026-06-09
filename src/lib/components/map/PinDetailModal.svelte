<script>
	import Modal from '../ui/Modal.svelte';
	import { cancelDialog, resolveDialog } from '$lib/stores/dialogs.js';
	import { state } from '$lib/state.js';
	import { t } from '$lib/i18n/i18n.js';

	let { pinId = '' } = $props();

	let marker = null;
	let pinData = {};
	let mediaHtml = '';
	let mediaUrls = [];
	let loaded = false;

	import { onMount, onDestroy } from 'svelte';
	onMount(() => {
		marker = state.markers.find(m => m._pinId === pinId);
		if (!marker) return;
		pinData = marker._pinData || {};
		loadMedia();
		loaded = true;
	});

	function loadMedia() {
		const r = marker?._media;
		if (!r) return;
		try {
			const mt = r.type;
			let tag = null;
			if (mt?.startsWith('image/')) tag = 'img';
			else if (mt?.startsWith('video/')) tag = 'video';
			else if (mt?.startsWith('audio/')) tag = 'audio';
			if (tag) {
				import('../../../../core/pkg/e2e_core.js').then(m => {
					const dec = m.decrypt_raw_bytes(r.ciphertext, r.nonce, state.dek);
					const blob = new Blob([dec], { type: mt });
					const url = URL.createObjectURL(blob);
					mediaUrls.push(url);
					if (tag === 'img')
						mediaHtml = `<img src="${url}" class="media-img">`;
					else if (tag === 'video')
						mediaHtml = `<video src="${url}" controls class="media-video"></video>`;
					else if (tag === 'audio')
						mediaHtml = `<audio src="${url}" controls class="media-audio"></audio>`;
					loaded = true;
				});
			}
		} catch (e) { /* error */ }
	}

	function relativeTime(ts) {
		if (!ts) return '';
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}

	onDestroy(() => {
		for (const u of mediaUrls) URL.revokeObjectURL(u);
	});

	const isAnon = marker?._postedAnonymously;
	const isOwner = !isAnon && marker?._authorPubkey && marker?._authorPubkey === state.signingPublicKey;

	async function handleDelete() {
		cancelDialog();
		try {
			// Call the engine's deletePin which handles DB, undo, broadcast, toast
			const { deletePin } = await import('../../../../map.js');
			await deletePin(pinId);
		} catch (e) { /* handled by engine */ }
	}

	async function handleEdit() {
		cancelDialog();
		// Open edit pin form via dialog store
		const { showEditPinForm } = await import('$lib/stores/dialogs.js');
		showEditPinForm(pinId);
	}

	function handleOsm() {
		const lat = pinData.lat || marker?.getLatLng()?.lat;
		const lng = pinData.lng || marker?.getLatLng()?.lng;
		if (lat != null && lng != null) {
			window.open(`https://www.openstreetmap.org/edit?editor=id#map=18/${lat}/${lng}`, '_blank');
		}
	}

	async function handleRoute() {
		const lat = pinData.lat || marker?.getLatLng()?.lat;
		const lng = pinData.lng || marker?.getLatLng()?.lng;
		if (lat != null && lng != null) {
			const { toggleRouting, addWaypoint, isRoutingActive } = await import('../../../../map-routing.js');
			if (!isRoutingActive()) toggleRouting();
			addWaypoint(lat, lng);
			cancelDialog();
		}
	}
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		{#if loaded && marker}
			<div class="header">
				<div class="title">{marker._pinEmoji ? marker._pinEmoji + ' ' : ''}{pinData.title || ''}</div>
				<button class="close-btn" onclick={() => cancelDialog()}>×</button>
			</div>
			{#if isAnon}<div class="anon">anonymous</div>{/if}
			<div class="body">
				<div class="note">{pinData.note || ''}</div>
				{#if mediaHtml}
					{@html mediaHtml}
				{/if}
				<div class="time">{relativeTime(marker._createdAt)}</div>
				{#if marker._layerName}
					<div class="layer-badge">📑 {marker._layerName}</div>
				{/if}
				<div class="actions">
					{#if !isAnon && isOwner}
						<button class="btn-edit" onclick={handleEdit}>Edit</button>
						<button class="btn-delete" onclick={handleDelete}>Delete</button>
					{/if}
					<button class="btn-osm" onclick={handleOsm}>🌐 Edit in OSM</button>
					<button class="btn-route" onclick={handleRoute}>🛣 Route</button>
				</div>
				<div class="thread" data-pin-id={pinId}>Loading annotations...</div>
			</div>
		{/if}
	{/snippet}
</Modal>

<style>
	.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
	.title { font-size: 18px; font-weight: 600; word-break: break-word; color: var(--text); }
	.close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: #9ca3af; line-height: 1; flex-shrink: 0; margin-left: 8px; }
	.anon { font-size: 10px; color: var(--text-muted); margin-bottom: 4px; }
	.body { overflow-y: auto; flex: 1; }
	.note { font-size: 14px; color: var(--text); white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; }
	.time { font-size: 11px; color: var(--text-dim); margin-top: 8px; }
	.layer-badge { font-size: 11px; color: var(--text-dim); margin-top: 4px; }
	.actions { margin-top: 8px; display: flex; gap: 4px; flex-wrap: wrap; }
	.btn-edit { padding: 4px 8px; border: 1px solid #2563eb; background: var(--bg-card); color: #2563eb; border-radius: 3px; cursor: pointer; font-size: 12px; }
	.btn-delete { padding: 4px 8px; border: 1px solid #dc2626; background: var(--bg-card); color: #dc2626; border-radius: 3px; cursor: pointer; font-size: 12px; }
	.btn-osm { padding: 4px 8px; border: 1px solid #7c3aed; background: var(--bg-card); color: #7c3aed; border-radius: 3px; cursor: pointer; font-size: 12px; }
	.btn-route { padding: 4px 8px; border: 1px solid #7c3aed; background: var(--bg-card); color: #7c3aed; border-radius: 3px; cursor: pointer; font-size: 12px; }
	.thread { margin-top: 12px; font-size: 13px; color: var(--text-dim); }
	:global(.media-img) { max-width: 100%; max-height: 50vh; margin-top: 6px; border-radius: 4px; }
	:global(.media-video) { max-width: 100%; max-height: 50vh; margin-top: 6px; border-radius: 4px; }
	:global(.media-audio) { width: 100%; }
</style>
