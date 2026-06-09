<script>
	import Modal from './Modal.svelte';
	import { resolveDialog, cancelDialog } from '$lib/stores/dialogs.js';
	import { t } from '$lib/i18n/i18n.js';
	import { state } from '$lib/state.js';

	let { label = 'Set community password' } = $props();
	let pass = '';
	let confirm = '';

	function submit() {
		if (!pass) { toast('Password cannot be empty', '#dc2626'); return; }
		if (pass !== confirm) { toast('Passwords do not match', '#dc2626'); return; }
		if (pass.length < 8) { toast('Password must be at least 8 characters', '#dc2626'); return; }
		resolveDialog(pass);
	}

	function toast(msg, color) {
		window._svelteToast?.(msg, color, 2000);
	}
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		<h3 class="title">{label}</h3>
		<p class="desc">Anyone joining this community via the relay will need this password.</p>
		<input type="password" bind:value={pass} placeholder="Password" class="input" autocomplete="new-password" autofocus
			onkeydown={(e) => { if (e.key === 'Enter') document.getElementById('sp-confirm')?.focus(); }} />
		<input id="sp-confirm" type="password" bind:value={confirm} placeholder="Confirm password" class="input"
			onkeydown={(e) => { if (e.key === 'Enter') submit(); }} />
		<div class="actions">
			<button class="btn-cancel" onclick={() => cancelDialog()}>Cancel</button>
			<button class="btn-ok" onclick={submit}>Set</button>
		</div>
	{/snippet}
</Modal>

<style>
	.title { margin: 0 0 4px; font-size: 15px; color: var(--text); }
	.desc { font-size: 11px; color: var(--text-dim); margin: 0 0 8px; }
	.input {
		width: 100%; padding: 6px; margin-bottom: 6px; box-sizing: border-box;
		border: 1px solid var(--border); border-radius: 4px;
		background: var(--bg-input); color: var(--text); font-size: 14px;
	}
	.actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-cancel { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
	.btn-ok { padding: 6px 14px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
</style>
