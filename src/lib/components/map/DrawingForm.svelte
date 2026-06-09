<script>
	import Modal from '../ui/Modal.svelte';
	import { cancelDialog } from '$lib/stores/dialogs.js';
	import { t } from '$lib/i18n/i18n.js';
	import { state } from '$lib/state.js';
	import L from 'leaflet';

	let { geometry = {} } = $props();
	let title = '';
	let note = '';
	let arrow = false;
	let layerId = '';
	let file = null;
	let anonymous = false;
	let metrics = '';

	function computeMetrics() {
		let d = 0;
		if (geometry.type === 'FeatureCollection') {
			for (const f of geometry.features || []) {
				if (f.geometry?.type === 'LineString') {
					const c = f.geometry.coordinates;
					for (let i = 1; i < c.length; i++)
						d += L.latLng(c[i-1][1], c[i-1][0]).distanceTo([c[i][1], c[i][0]]);
				}
			}
			if (d > 0) metrics = `Length: ${fmtDist(d)}`;
		} else if (geometry.geometry?.type === 'LineString') {
			const c = geometry.geometry.coordinates;
			for (let i = 1; i < c.length; i++)
				d += L.latLng(c[i-1][1], c[i-1][0]).distanceTo([c[i][1], c[i][0]]);
			metrics = `Length: ${fmtDist(d)}`;
		} else if (geometry.geometry?.type === 'Point' && geometry.properties?.radius) {
			const r = geometry.properties.radius;
			metrics = `Circumference: ${fmtDist(2 * Math.PI * r)} | Diameter: ${fmtDist(r * 2)} | Area: ${fmtArea(Math.PI * r * r)}`;
		}
	}

	function fmtDist(m) {
		if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
		return Math.round(m) + ' m';
	}
	function fmtArea(m2) {
		if (m2 >= 1e6) return (m2 / 1e6).toFixed(2) + ' km²';
		return Math.round(m2) + ' m²';
	}

	import { onMount } from 'svelte';
	onMount(computeMetrics);

	async function save() {
		const g = { ...geometry };
		g.properties = g.properties || {};
		g.properties.title = title || 'Drawing';
		g.properties.note = note;
		g.properties.arrow = arrow;
		g.properties.color = '#2563eb';
		if (g.type === 'FeatureCollection') {
			for (const f of g.features) {
				f.properties = f.properties || {};
				if (!f.properties.color) f.properties.color = '#2563eb';
				if (arrow && f.geometry?.type === 'LineString') f.properties.arrow = true;
			}
		}

		let media = null;
		if (file) {
			try {
				const { showProgress } = await import('$lib/stores/dialogs.js');
				const prog = showProgress('Processing media...');
				prog.update(5, 'Compressing...');
				const { compressMedia } = await import('../../../../map.js');
				const c = await compressMedia(file, (pct) => prog.update(5 + Math.round(pct * 0.75), 'Compressing...'));
				prog.update(80, 'Encrypting...');
				const { encrypt_raw_bytes } = await import('../../../../core/pkg/e2e_core.js');
				const enc = encrypt_raw_bytes(new Uint8Array(c.buffer), state.dek);
				prog.update(90, 'Saving...');
				media = { type: c.type, name: c.name, ciphertext: enc.ciphertext, nonce: enc.nonce };
				prog.update(100, 'Done');
				prog.done();
			} catch (e) {
				window._svelteToast?.('Media processing failed: ' + e.message, '#dc2626');
				return;
			}
		}

		const { saveDrawing } = await import('../../../../map.js');
		await saveDrawing(g, media, layerId, anonymous);
		cancelDialog();
	}
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		<h3 class="h">{t('newDrawing')}</h3>
		{#if metrics}
			<div class="metrics">{metrics}</div>
		{/if}
		<input class="inp" bind:value={title} placeholder={t('title')} />
		<textarea class="inp ta" bind:value={note} placeholder={t('description')} rows="3"></textarea>

		<div class="label">{t('layer') || 'Layer'}</div>
		<select class="inp" bind:value={layerId}>
			{#each state.layers as l}
				<option value={l.layer_id}>{l.name}</option>
			{/each}
		</select>
		<label class="check">
			<input type="checkbox" bind:checked={anonymous} /> Post anonymously
		</label>
		<div class="label">{t('attachment') || 'Attachment'}</div>
		<input type="file" class="inp" accept="image/*,video/*,audio/*" onchange={(e) => file = e.target.files[0]} />
		<div class="actions">
			<button class="btn-cancel" onclick={() => cancelDialog()}>{t('cancel')}</button>
			<button class="btn-save" onclick={save}>{t('save')}</button>
		</div>
	{/snippet}
</Modal>

<style>
	.h { margin: 0 0 12px; font-size: 15px; color: var(--text); }
	.metrics { margin-bottom: 10px; padding: 6px 8px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 4px; font-size: 12px; color: #166534; }
	.inp { width: 100%; padding: 6px; margin-bottom: 8px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-input); color: var(--text); font-size: 13px; }
	.ta { resize: vertical; }
	.label { font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
	.check { display: flex; align-items: center; gap: 4px; font-size: 12px; margin-bottom: 8px; color: var(--text-dim); }
	.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
	.btn-cancel { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
	.btn-save { padding: 6px 14px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
</style>
