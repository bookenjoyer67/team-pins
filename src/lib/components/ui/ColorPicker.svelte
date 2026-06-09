<script>
	import { resolveDialog, cancelDialog } from '$lib/stores/dialogs.js';
	import L from 'leaflet';

	let { currentColor = '#7c3aed' } = $props();
	const PRESETS = ['#7c3aed', '#2563eb', '#16a34a', '#f97316', '#eab308', '#ec4899', '#ef4444', '#0891b2', '#000000', '#ffffff'];
	let selected = currentColor;

	function confirm() {
		resolveDialog(selected);
	}
</script>

<div class="picker-backdrop" onclick={(e) => { if (e.target === e.currentTarget) cancelDialog(); }}>
	<div class="picker-card">
		<div class="grid">
			{#each PRESETS as c}
				<button
					class="swatch"
					class:active={selected === c}
					style="background:{c}; {c === '#ffffff' ? 'border:1px solid var(--border);' : ''}"
					onclick={() => selected = c}
				></button>
			{/each}
		</div>
		<div class="custom-row">
			<input type="color" bind:value={selected} class="color-input" />
			<span class="hex">{selected}</span>
		</div>
		<div class="actions">
			<button class="btn-cancel" onclick={() => cancelDialog()}>Cancel</button>
			<button class="btn-ok" onclick={confirm}>OK</button>
		</div>
	</div>
</div>

<style>
	.picker-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.3);
		z-index: 2100; display: flex; align-items: center; justify-content: center;
	}
	.picker-card {
		background: var(--bg-card); padding: 16px; border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.3);
	}
	.grid {
		display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 12px;
	}
	.swatch {
		width: 32px; height: 32px; border: 2px solid transparent; border-radius: 6px;
		cursor: pointer; padding: 0;
	}
	.swatch.active { border-color: var(--blue); box-shadow: 0 0 0 2px var(--bg-card), 0 0 0 4px var(--blue); }
	.custom-row {
		display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
	}
	.color-input { width: 32px; height: 32px; border: none; cursor: pointer; padding: 0; }
	.hex { font-size: 13px; color: var(--text-dim); font-family: monospace; }
	.actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn-cancel { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
	.btn-ok { padding: 6px 14px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
</style>
