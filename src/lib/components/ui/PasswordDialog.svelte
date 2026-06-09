<script>
	import Modal from './Modal.svelte';
	import { resolveDialog, cancelDialog } from '$lib/stores/dialogs.js';
	import { t } from '$lib/i18n/i18n.js';

	let { title = '' } = $props();
	let password = '';
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		<h3 class="title">{title}</h3>
		<input
			type="password"
			bind:value={password}
			placeholder={t('password')}
			class="input"
			autofocus
			onkeydown={(e) => { if (e.key === 'Enter') resolveDialog(password); }}
		/>
		<div class="actions">
			<button class="btn-cancel" onclick={() => cancelDialog()}>{t('cancel')}</button>
			<button class="btn-ok" onclick={() => resolveDialog(password)}>{t('ok')}</button>
		</div>
	{/snippet}
</Modal>

<style>
	.title { margin: 0 0 8px; font-size: 15px; color: var(--text); }
	.input {
		width: 100%; padding: 6px; margin-bottom: 12px; box-sizing: border-box;
		border: 1px solid var(--border); border-radius: 4px;
		background: var(--bg-input); color: var(--text); font-size: 14px;
	}
	.actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-cancel { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
	.btn-ok { padding: 6px 14px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
</style>
