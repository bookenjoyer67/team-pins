<script>
	import { _history } from '$stores/app.js';
	import { t, lang } from '$lib/i18n/i18n.js';
	import { onMount, onDestroy } from 'svelte';

	let items = [];

	function refresh() {
		items = [..._history].slice(0, 10);
	}

	function formatTime(ts) {
		return new Date(ts).toLocaleTimeString();
	}

	let timer;
	onMount(() => {
		refresh();
		// Periodic refresh: array mutations don't trigger store subscribers
		timer = setInterval(refresh, 3000);
		const unsub = lang.subscribe(refresh);
		return () => { clearInterval(timer); unsub(); };
	});
	onDestroy(() => clearInterval(timer));
</script>

{#if items.length > 0}
	<div id="history-panel">
		<h4>{t('history') || 'History'}</h4>
		{#each items as item (item.time)}
			<div class="hist-item">
				{item.action}: {item.detail}
				<br /><span class="hist-time">{formatTime(item.time)}</span>
			</div>
		{/each}
	</div>
{/if}

<style>
	#history-panel { position: absolute; bottom: 20px; right: 10px; z-index: 1000; background: var(--bg-card); color: var(--text); padding: 8px; border-radius: 6px; box-shadow: 0 1px 5px var(--shadow); font-size: 11px; max-width: 220px; max-height: 200px; overflow-y: auto; }
	#history-panel h4 { margin: 0 0 4px; font-size: 11px; color: var(--text-dim); }
	.hist-item { border-bottom: 1px solid var(--border-light); padding: 3px 0; }
	.hist-time { color: var(--text-muted); }
</style>
