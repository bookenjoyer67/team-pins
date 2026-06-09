<script>
	import Modal from './Modal.svelte';
	import { resolveDialog, cancelDialog } from '$lib/stores/dialogs.js';
	import { t } from '$lib/i18n/i18n.js';

	let { message = '' } = $props();
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		<p class="msg">{message}</p>
		<div class="actions">
			<button class="btn-cancel" onclick={() => resolveDialog(false)}>{t('cancel')}</button>
			<button class="btn-ok" onclick={() => resolveDialog(true)}>{t('ok')}</button>
		</div>
	{/snippet}
</Modal>

<style>
	.msg { margin: 0 0 16px; font-size: 14px; color: var(--text); line-height: 1.4; }
	.actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-cancel { padding: 8px 16px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; font-size: 14px; color: var(--text); }
	.btn-ok { padding: 8px 16px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; font-size: 14px; }
</style>
