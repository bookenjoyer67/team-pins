<script>
	import Modal from './Modal.svelte';
	import { resolveDialog, cancelDialog } from '$lib/stores/dialogs.js';
	import { t } from '$lib/i18n/i18n.js';

	let { title = '', answer = '', qrSvg = '' } = $props();

	function copyAnswer() {
		navigator.clipboard.writeText(answer).catch(() => {});
	}
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		<h3 class="title">{title}</h3>
		{#if qrSvg}
			<div class="qr-box">{@html qrSvg}</div>
		{:else}
			<p class="qr-fail">QR too large — use the code below</p>
		{/if}
		<textarea readonly class="textarea" rows="3" value={answer}></textarea>
		<div class="actions">
			<button class="btn-copy" onclick={copyAnswer}>{t('copyAnswer')}</button>
			<button class="btn-close" onclick={() => resolveDialog(true)}>{t('close')}</button>
		</div>
	{/snippet}
</Modal>

<style>
	.title { margin: 0 0 12px; font-size: 15px; color: var(--text); }
	.qr-box { text-align: center; margin-bottom: 12px; min-height: 32px; }
	.qr-box :global(svg) { max-width: 200px; height: auto; }
	.qr-fail { font-size: 11px; color: #ef4444; margin: 4px 0; }
	.textarea {
		width: 100%; padding: 6px; margin-bottom: 12px; box-sizing: border-box;
		font-size: 11px; resize: vertical; border: 1px solid var(--border);
		border-radius: 4px; background: var(--bg-input); color: var(--text);
	}
	.actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-copy { padding: 6px 14px; border: none; background: #7c3aed; color: white; border-radius: 4px; cursor: pointer; }
	.btn-close { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
</style>
