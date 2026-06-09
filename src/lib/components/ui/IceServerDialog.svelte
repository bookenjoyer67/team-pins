<script>
	import { t } from '$lib/i18n/i18n.js';
	import { cancelDialog } from '$lib/stores/dialogs.js';
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';

	let { title = 'ICE / TURN Servers', onSave = () => {} } = $props();

	// ICE servers — plain array with Svelte-managed {#each} (few items, rarely changes)
	let servers = [];

	// Relay URLs — imperatively managed DOM (avoids Svelte let reactivity issues)
	let relayContainer;

	function renderRelays() {
		if (!relayContainer) return;
		relayContainer.innerHTML = '';
		const raw = (localStorage.getItem('pins-relay-urls') || localStorage.getItem('pins-relay-url') || '');
		const list = raw.split(',').map(u => u.trim().replace(/\/$/, '')).filter(Boolean);
		const items = list.length > 0 ? list : [''];
		items.forEach(u => addRelayRow(u));
	}

	function addRelayRow(val) {
		if (!relayContainer) return;
		const row = document.createElement('div');
		row.className = 'row';
		const inp = document.createElement('input');
		inp.value = val || '';
		inp.placeholder = 'wss://signal.catperson.online';
		inp.style.cssText = 'flex:1;padding:4px;border:1px solid var(--border);border-radius:3px;font-size:12px;background:var(--bg-input);color:var(--text);';
		const btn = document.createElement('button');
		btn.textContent = '×';
		btn.className = 'btn-remove';
		btn.onclick = () => { row.remove(); };
		row.appendChild(inp);
		row.appendChild(btn);
		relayContainer.appendChild(row);
	}

	function addRelay() {
		addRelayRow('');
	}

	function collectRelayUrls() {
		if (!relayContainer) return [];
		const urls = [];
		relayContainer.querySelectorAll('input').forEach(inp => {
			const v = inp.value.trim().replace(/\/$/, '');
			if (v) urls.push(v);
		});
		return urls;
	}

	let pmtilesUrl = localStorage.getItem('pins-pmtiles-url') || '';
	let routingUrl = localStorage.getItem('pins-osrm-url') || 'https://routing.openstreetmap.de/routed-car';
	let routingProfile = localStorage.getItem('pins-routing-profile') || 'car';

	function load() {
		const saved = localStorage.getItem('pins-ice-servers');
		servers = saved ? JSON.parse(saved) : [];
		if (servers.length === 0) servers.push({ urls: ['stun:'], username: '', credential: '' });
	}

	function addServer() {
		servers = [...servers, { urls: ['stun:'], username: '', credential: '' }];
	}
	function removeServer(i) {
		servers = servers.filter((_, idx) => idx !== i);
	}

	async function save() {
		const cleaned = servers
			.filter(s => s.urls.some(u => u && u !== 'stun:'))
			.map(s => {
				const entry = { urls: s.urls.filter(Boolean) };
				if (s.username) entry.username = s.username;
				if (s.credential) entry.credential = s.credential;
				return entry;
			});

		if (cleaned.length > 0) {
			localStorage.setItem('pins-ice-servers', JSON.stringify(cleaned));
		} else {
			localStorage.removeItem('pins-ice-servers');
		}

		const urls = collectRelayUrls();
		const relayMod = await import('../../../../relay.js');
		relayMod.saveRelayUrls(urls);
		if (urls.length > 0) {
			await Promise.all(urls.map(url => relayMod.connect(url).catch(() => null)));
			for (const url of urls) {
				relayMod.fetchCommunityList(url).catch(() => {});
			}
		}

		if (pmtilesUrl) localStorage.setItem('pins-pmtiles-url', pmtilesUrl);
		else localStorage.removeItem('pins-pmtiles-url');
		if (routingUrl) localStorage.setItem('pins-osrm-url', routingUrl);
		else localStorage.removeItem('pins-osrm-url');
		localStorage.setItem('pins-routing-profile', routingProfile);

		onSave(cleaned.length > 0 ? cleaned : null);
		import('$lib/stores/dialogs.js').then(m => m.resolveDialog(true));
	}

	function reset() {
		servers = [{ urls: ['stun:'], username: '', credential: '' }];
		localStorage.removeItem('pins-ice-servers');
	}

	onMount(() => {
		load();
		renderRelays();
	});
</script>

<Modal onClose={() => cancelDialog()}>
	{#snippet children()}
		<h3 style="margin:0 0 4px;">{title}</h3>
		<p style="font-size:11px;color:var(--text-dim);margin:0 0 4px;">{t('iceDescription') || 'STUN/TURN servers help peers connect behind NAT'}</p>

		<!-- ICE servers -->
		{#each servers as row, i (i)}
			<div class="row">
				<input value={row.urls.join(',')} placeholder="stun:host:port"
					oninput={(e) => { row.urls = e.target.value.split(',').map(u => u.trim()).filter(Boolean); }} />
				<input value={row.username || ''} placeholder="username"
					oninput={(e) => { row.username = e.target.value; }} />
				<input value={row.credential || ''} placeholder="credential"
					oninput={(e) => { row.credential = e.target.value; }} />
				<button class="btn-remove" onclick={() => removeServer(i)}>×</button>
			</div>
		{/each}
		<button class="btn-add" onclick={addServer}>{t('addServer') || '+ Add server'}</button>

		<!-- Relay servers (imperative DOM — no Svelte reactivity) -->
		<div class="section">
			<label class="section-label">Signal relay servers</label>
			<div bind:this={relayContainer}></div>
			<button class="btn-add" onclick={addRelay}>+ Add relay</button>
		</div>

		<!-- PMTiles + Routing -->
		<div class="section">
			<label class="section-label">PMTiles URL (vector basemap)</label>
			<input bind:value={pmtilesUrl} placeholder="https://example.com/map.pmtiles" class="full-input" />
		</div>
		<div class="section">
			<label class="section-label">Routing Server (OSRM)</label>
			<input bind:value={routingUrl} placeholder="https://routing.openstreetmap.de/routed-car" class="full-input" />
			<select bind:value={routingProfile} class="full-input">
				<option value="car">Car</option>
				<option value="foot">Walking</option>
				<option value="bike">Cycling</option>
			</select>
		</div>

		<div class="actions">
			<button class="btn-reset" onclick={reset}>{t('reset')}</button>
			<button class="btn-cancel" onclick={() => cancelDialog()}>{t('cancel')}</button>
			<button class="btn-save" onclick={save}>{t('save')}</button>
		</div>
	{/snippet}
</Modal>

<style>
	.row { display: flex; gap: 4px; margin-bottom: 6px; align-items: center; }
	.row input { flex: 1; padding: 4px; border: 1px solid var(--border); border-radius: 3px; font-size: 12px; background: var(--bg-input); color: var(--text); }
	.row input:not(:first-child) { width: 80px; flex: none; }
	.btn-remove { padding: 2px 6px; border: 1px solid #dc2626; background: var(--bg-card); color: #dc2626; border-radius: 3px; cursor: pointer; font-size: 12px; }
	.btn-add { padding: 4px 10px; border: 1px dashed #9ca3af; background: transparent; color: var(--text-dim); border-radius: 3px; cursor: pointer; font-size: 12px; margin-bottom: 12px; width: 100%; }
	.section { margin-bottom: 12px; border-top: 1px solid var(--border); padding-top: 8px; }
	.section-label { font-size: 12px; color: var(--text-dim); display: block; margin-bottom: 4px; }
	:global(#piggpin-settings .row input) { flex: 1; padding: 4px; border: 1px solid var(--border); border-radius: 3px; font-size: 12px; background: var(--bg-input); color: var(--text); }
	:global(#piggpin-settings .btn-remove) { padding: 2px 6px; border: 1px solid #dc2626; background: var(--bg-card); color: #dc2626; border-radius: 3px; cursor: pointer; font-size: 12px; }
	.full-input { width: 100%; padding: 4px; border: 1px solid var(--border); border-radius: 3px; font-size: 12px; box-sizing: border-box; background: var(--bg-input); color: var(--text); margin-bottom: 4px; }
	.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
	.btn-reset { padding: 6px 14px; border: 1px solid #dc2626; background: var(--bg-card); color: #dc2626; border-radius: 4px; cursor: pointer; }
	.btn-cancel { padding: 6px 14px; border: 1px solid var(--border); background: var(--border-light); border-radius: 4px; cursor: pointer; color: var(--text); }
	.btn-save { padding: 6px 14px; border: none; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
</style>
