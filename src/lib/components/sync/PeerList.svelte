<script>
	import { currentSet } from '$stores/app.js';
	import { peers } from '$stores/peers.js';
	import { onMount, onDestroy } from 'svelte';

	let items = [];

	function refresh() {
		items = [...peers.get().values()]
			.filter(p => p.setId === $currentSet || p.userId)
			.map(p => ({
				name: p.name || 'Peer',
				online: !p.offline,
				key: p.userId || p.name
			}));
	}

	let timer;
	onMount(() => {
		refresh();
		window._refreshPeerList = refresh;
		timer = setInterval(refresh, 10000);
		const unsub = currentSet.subscribe(refresh);
		return () => { clearInterval(timer); unsub(); delete window._refreshPeerList; };
	});
	onDestroy(() => clearInterval(timer));
</script>

{#if items.length > 0}
	<div id="peer-list" class="visible">
		<h4>Peers</h4>
		{#each items as item (item.key)}
			<div class="peer-row">
				<span class="peer-dot" class:online={item.online} class:offline={!item.online}></span>
				{item.name}
			</div>
		{/each}
	</div>
{/if}

<style>
	#peer-list { position: absolute; bottom: 20px; left: 10px; z-index: 1000; background: var(--bg-card); color: var(--text); padding: 8px; border-radius: 6px; box-shadow: 0 1px 5px var(--shadow); font-size: 12px; max-width: 200px; display: none; }
	#peer-list.visible { display: block; }
	#peer-list h4 { margin: 0 0 4px; font-size: 12px; color: var(--text-dim); }
	.peer-row { padding: 2px 0; }
	.peer-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; }
	.peer-dot.online { background: #16a34a; }
	.peer-dot.offline { background: var(--text-muted); }
</style>
