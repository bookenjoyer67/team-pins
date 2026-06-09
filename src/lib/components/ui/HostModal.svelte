<script>
	import Modal from './Modal.svelte';
	import { cancelDialog } from '$lib/stores/dialogs.js';
	import { t } from '$lib/i18n/i18n.js';
	import { state } from '$lib/state.js';

	let code = '';
	let compact = '';
	let link = '';
	let qrSvg = '';
	let loaded = false;

	import { onMount } from 'svelte';
	onMount(async () => {
		try {
			const { generate_qr_svg } = await import('../../../../core/pkg/e2e_core.js');
			const { hostGroup } = await import('../../../../sync.js');
			const img = generate_qr_svg(window.location.origin);
			qrSvg = img || '';
			code = 'Hosting...';
			compact = window.location.origin + '?host=' + state.currentSet;
			link = window.location.href;
			loaded = true;
			hostGroup();
		} catch (e) {
			code = 'Error: ' + (e.message || 'unknown');
			loaded = true;
		}
	});

	function copy(s) {
		navigator.clipboard.writeText(s).catch(() => {});
		window._svelteToast?.('Copied', '#16a34a');
	}

	function paste() {
		navigator.clipboard.readText().then(text => {
			if (text) {
				cancelDialog();
				import('../../../../peer.js').then(p => p.acceptOffer(text, state.user.id, state.displayName))
					.then(() => { window._svelteToast?.('Connected', '#16a34a'); });
			}
		}).catch(() => {});
	}
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		<h3 class="h">{t('hostGroup')}</h3>
		{#if qrSvg}
			<div class="qr">{@html qrSvg}</div>
		{:else}
			<p class="hint">QR too large — use code below</p>
		{/if}
		<textarea readonly class="code" rows="3" value={compact}></textarea>
		<div class="row">
			<button class="btn-copy" onclick={() => copy(link)}>{t('copyLink')}</button>
			<button class="btn-copy" onclick={() => copy(compact)}>{t('copyCode')}</button>
		</div>
		<div class="actions">
			<button class="btn-paste" onclick={paste}>{t('pasteAnswer')}</button>
			<button class="btn-close" onclick={() => cancelDialog()}>{t('close')}</button>
		</div>
	{/snippet}
</Modal>

<style>
	.h { margin: 0 0 12px; font-size: 15px; color: var(--text); }
	.qr { text-align: center; margin-bottom: 12px; }
	.qr :global(svg) { max-width: 200px; height: auto; }
	.hint { font-size: 11px; color: #ef4444; margin: 4px 0; }
	.code { width: 100%; padding: 6px; margin-bottom: 8px; box-sizing: border-box; font-size: 11px; resize: vertical; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-input); color: var(--text); }
	.row { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
	.btn-copy { padding: 4px 10px; border: 1px solid #059669; background: var(--bg-card); color: #059669; border-radius: 4px; cursor: pointer; font-size: 12px; }
	.actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-paste { padding: 6px 14px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
	.btn-close { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
</style>
