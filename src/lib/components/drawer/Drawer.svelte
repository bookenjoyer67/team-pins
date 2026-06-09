<script>
	import { onMount, onDestroy } from 'svelte';
	import { state } from '$lib/state.js';
	import { map, placingPin, freeDrawing, measuring, timeFrom, timeTo, minTrustScore } from '$stores/map.js';
	import { drawerExpanded, stripMinimal, stripTop, gridEnabled, timeSliderVisible, trustSliderVisible, selectionActive, trustFilterValue } from '$lib/stores/drawer.js';
	import { t, lang } from '$lib/i18n/i18n.js';
	import L from 'leaflet';

	// --- Drag state ---
	let stripEl;
	let containerEl;
	let dragActive = false;
	let dragStartY = 0;
	let dragStartTop = 0;

	function startDrag(e) {
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		dragActive = true;
		dragStartY = clientY;
		dragStartTop = $stripTop ?? containerEl?.getBoundingClientRect().top ?? 0;
	}

	function moveDrag(e) {
		if (!dragActive) return;
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		const dy = clientY - dragStartY;
		let newTop = dragStartTop + dy;
		const stripH = stripEl?.getBoundingClientRect().height ?? 32;
		const maxTop = window.innerHeight - stripH - 8;
		newTop = Math.max(36, Math.min(newTop, maxTop));
		// Direct DOM for smooth drag — no store update (avoids re-render jitter)
		containerEl.style.transition = 'none';
		containerEl.style.top = newTop + 'px';
		containerEl.style.transform = 'none';
	}

	function endDrag() {
		if (!dragActive) return;
		dragActive = false;
		// Persist position to store on release
		const top = parseInt(containerEl.style.top, 10);
		if (!isNaN(top)) stripTop.set(top);
	}

	function handleKey(e) {
		if (e.key === 'Escape' && $drawerExpanded) drawerExpanded.set(false);
	}

	onMount(() => {
		document.addEventListener('keydown', handleKey);
		document.addEventListener('mousemove', moveDrag);
		document.addEventListener('touchmove', moveDrag, { passive: false });
		document.addEventListener('mouseup', endDrag);
		document.addEventListener('touchend', endDrag);
		return () => {
			document.removeEventListener('keydown', handleKey);
			document.removeEventListener('mousemove', moveDrag);
			document.removeEventListener('touchmove', moveDrag);
			document.removeEventListener('mouseup', endDrag);
			document.removeEventListener('touchend', endDrag);
		};
	});
	function togglePin() {
		placingPin.update(v => !v);
		const m = map.get();
		if (m) m.getContainer().style.cursor = placingPin.get() ? 'crosshair' : '';
	}
	function toggleDraw() {
		if (!window._drawInit) {
			window._drawInit = true;
			import('../../../../freeDraw.js').then(fd => {
				fd.initFreeDraw(window._showDrawingForm);
				fd.addFreeDrawButton();
			});
		}
		freeDrawing.update(v => !v);
		if (freeDrawing.get()) {
			import('../../../../freeDraw.js').then(fd => fd.enterDrawingMode());
		} else {
			import('../../../../freeDraw.js').then(fd => fd.exitDrawingMode());
		}
	}
	function toggleMeasure() {
		measuring.update(v => !v);
		if (measuring.get()) {
			// Enable measuring mode
			const m = $map;
			if (!m) return;
			m.getContainer().style.cursor = 'crosshair';
			const markers = [];
			let pointA = null;
			let measureLayer = null;
			state._measureMarkers = markers;
			const click = (e) => {
				if (!measuring.get() || freeDrawing.get()) return;
				if (pointA) {
					if (measureLayer) m.removeLayer(measureLayer);
					markers.forEach(mk => m.removeLayer(mk));
					markers.length = 0;
					const start = L.circleMarker(pointA, { radius: 5, color: '#0e7490', fillColor: '#0e7490', fillOpacity: 1, weight: 2, interactive: false }).addTo(m);
					const end = L.circleMarker(e.latlng, { radius: 5, color: '#0e7490', fillColor: '#0e7490', fillOpacity: 1, weight: 2, interactive: false }).addTo(m);
					markers.push(start, end);
					const d = pointA.distanceTo(e.latlng);
					const dist = d > 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`;
					measureLayer = L.polyline([pointA, e.latlng], { color: '#0e7490', weight: 2, dashArray: '6 4' }).addTo(m);
					measureLayer.bindTooltip(dist, { permanent: true, direction: 'center', offset: [0, -6] }).openTooltip();
					state._measureLayer = measureLayer;
					pointA = null;
				} else {
					if (measureLayer) m.removeLayer(measureLayer);
					markers.forEach(mk => m.removeLayer(mk));
					markers.length = 0;
					pointA = e.latlng;
					const start = L.circleMarker(pointA, { radius: 5, color: '#0e7490', fillColor: '#0e7490', fillOpacity: 1, weight: 2, interactive: false }).addTo(m);
					markers.push(start);
				}
			};
			state._measureClick = click;
			m.on('click', click);
		} else {
			// Disable measuring
			const m = $map;
			if (m) {
				m.getContainer().style.cursor = '';
				if (state._measureLayer) { m.removeLayer(state._measureLayer); state._measureLayer = null; }
				if (state._measureMarkers) { state._measureMarkers.forEach(mk => m.removeLayer(mk)); state._measureMarkers = []; }
				if (state._measureClick) { m.off('click', state._measureClick); state._measureClick = null; }
			}
		}
	}
	function toggleSelect() {
		selectionActive.update(v => !v);
		if (selectionActive.get()) {
			const m = $map;
			if (!m) return;
			m.getContainer().style.cursor = 'crosshair';
			m.dragging.disable();
			let selStart = null;
			let selRect = null;
			let selPoly = null;
			let selMarkers = [];
			let selDrawings = [];
			let selBar = null;
			let lassoMode = false;

			function clearSelLayer() {
				if (selRect) { m.removeLayer(selRect); selRect = null; }
				if (selPoly) { m.removeLayer(selPoly); selPoly = null; }
			}
			function clearSelection() {
				selMarkers.forEach(mk => { const icon = mk._icon; if (icon) icon.style.filter = ''; });
				selDrawings.forEach(l => { l.setStyle({ color: l._origColor || l.options?.color || '#2563eb' }); });
				selMarkers = []; selDrawings = [];
				if (selBar) { selBar.remove(); selBar = null; }
				clearSelLayer();
			}
			function showBar() {
				if (selBar) selBar.remove();
				const total = selMarkers.length + selDrawings.length;
				if (total === 0) return;
				selBar = document.createElement('div');
				selBar.style.cssText = 'position:absolute;top:214px;right:48px;z-index:1001;display:flex;gap:4px;';
				const delBtn = document.createElement('button');
				delBtn.textContent = `Delete (${total})`;
				delBtn.style.cssText = 'height:28px;border:none;border-radius:4px;background:#dc2626;color:white;cursor:pointer;font-size:12px;font-weight:600;padding:0 8px;';
				delBtn.onclick = async () => {
					const { deletePin, deleteDrawing } = await import('../../../../map.js');
					for (const mk of selMarkers) if (mk._pinId) await deletePin(mk._pinId);
					for (const l of selDrawings) await deleteDrawing(l._drawingId);
					clearSelection();
				};
				selBar.appendChild(delBtn);
				m.getContainer().appendChild(selBar);
			}

			const pointerdown = (e) => {
				if (!selectionActive.get()) return;
				if (e.target.closest('button')) return;
				clearSelection();
				const rc = m.getContainer().getBoundingClientRect();
				selStart = m.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
				if (lassoMode) {
					selPoly = L.polyline([[selStart.lat, selStart.lng]], { color: '#2563eb', weight: 1.5, dashArray: '4 4' }).addTo(m);
				} else {
					selRect = L.rectangle(L.latLngBounds(selStart, selStart), { color: '#2563eb', weight: 1.5, dashArray: '4 4', fillOpacity: 0.08 }).addTo(m);
				}
			};
			const pointermove = (e) => {
				if (!selStart) return;
				const rc = m.getContainer().getBoundingClientRect();
				const curr = m.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
				if (lassoMode && selPoly) {
					const ll = selPoly.getLatLngs();
					ll.push([curr.lat, curr.lng]);
					selPoly.setLatLngs(ll);
				} else if (selRect) {
					selRect.setBounds(L.latLngBounds(selStart, curr));
				}
			};
			const pointerup = (e) => {
				if (!selStart) return;
				const rc = m.getContainer().getBoundingClientRect();
				const curr = m.containerPointToLatLng([e.clientX - rc.left, e.clientY - rc.top]);
				if (lassoMode && selPoly) {
					const ll = selPoly.getLatLngs();
					if (ll.length > 3) {
						const polyArr = ll.map(ll2 => [ll2.lng, ll2.lat]);
						state.markers.forEach(mk => {
							const latlng = mk.getLatLng();
							if (pointInPolygon([latlng.lng, latlng.lat], polyArr)) {
								selMarkers.push(mk);
								const icon = mk._icon;
								if (icon) icon.style.filter = 'drop-shadow(0 0 4px #2563eb) brightness(1.2)';
							}
						});
						state.drawingLayers.forEach(l => {
							try {
								const lb = l.getBounds();
								if (lb) {
									const c = lb.getCenter();
									if (pointInPolygon([c.lng, c.lat], polyArr)) {
										selDrawings.push(l);
										l._origColor = l.options?.color || l._origColor;
										l.setStyle({ color: '#2563eb', weight: (l.options?.weight || 2) + 1 });
									}
								}
							} catch (_) {}
						});
						if (selMarkers.length + selDrawings.length > 0) showBar();
					}
				} else if (selStart.distanceTo(curr) > 5) {
					const bounds = L.latLngBounds(selStart, curr);
					state.markers.forEach(mk => {
						if (bounds.contains(mk.getLatLng())) {
							selMarkers.push(mk);
							const icon = mk._icon;
							if (icon) icon.style.filter = 'drop-shadow(0 0 4px #2563eb) brightness(1.2)';
						}
					});
					state.drawingLayers.forEach(l => {
						try {
							const lb = l.getBounds();
							if (lb && bounds.intersects(lb)) {
								selDrawings.push(l);
								l._origColor = l.options?.color || l._origColor;
								l.setStyle({ color: '#2563eb', weight: (l.options?.weight || 2) + 1 });
							}
						} catch (_) {}
					});
					if (selMarkers.length + selDrawings.length > 0) showBar();
				}
				clearSelLayer();
				selStart = null;
			};

			function pointInPolygon(point, polygon) {
				let inside = false;
				for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
					if ((polygon[i][1] > point[1]) !== (polygon[j][1] > point[1]) &&
						point[0] < (polygon[j][0] - polygon[i][0]) * (point[1] - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0])
						inside = !inside;
				}
				return inside;
			}

			m.getContainer().addEventListener('pointerdown', pointerdown);
			m.getContainer().addEventListener('pointermove', pointermove);
			m.getContainer().addEventListener('pointerup', pointerup);

			// Right-click toggles lasso mode
			const contextMenu = (e) => {
				if (!selectionActive.get()) return;
				e.preventDefault();
				lassoMode = !lassoMode;
				clearSelLayer();
			};
			m.getContainer().addEventListener('contextmenu', contextMenu);

			// Store for cleanup
			state._selectionCleanup = () => {
				m.getContainer().removeEventListener('pointerdown', pointerdown);
				m.getContainer().removeEventListener('pointermove', pointermove);
				m.getContainer().removeEventListener('pointerup', pointerup);
				m.getContainer().removeEventListener('contextmenu', contextMenu);
				clearSelLayer();
				clearSelection();
			};
		} else {
			const m = map.get();
			if (m) {
				m.getContainer().style.cursor = '';
				m.dragging.enable();
				if (state._selectionCleanup) { state._selectionCleanup(); state._selectionCleanup = null; }
			}
		}
	}
	function toggleGrid() {
		gridEnabled.update(v => !v);
		const m = map.get();
		if (!m) return;
		if (gridEnabled.get()) {
			drawGrid(m);
			const handler = () => drawGrid(m);
			m.on('moveend zoomend baselayerchange', handler);
			state._gridHandler = handler;
		} else {
			if (state._gridLayer) { m.removeLayer(state._gridLayer); state._gridLayer = null; }
			if (state._gridHandler) { m.off('moveend zoomend baselayerchange', state._gridHandler); state._gridHandler = null; }
		}
	}

	function drawGrid(m) {
		if (state._gridLayer) m.removeLayer(state._gridLayer);
		const bounds = m.getBounds();
		const zoom = m.getZoom();
		let step = zoom <= 3 ? 10 : zoom <= 6 ? 5 : zoom <= 9 ? 1 : 0.1;
		const lines = [];
		const style = { color: '#94a3b8', weight: 1, opacity: 0.25, dashArray: '6 4', interactive: false };
		const south = Math.floor(bounds.getSouth() / step) * step;
		const north = Math.ceil(bounds.getNorth() / step) * step;
		for (let lat = south; lat <= north; lat += step)
			lines.push(L.polyline([[lat, bounds.getWest()], [lat, bounds.getEast()]], style));
		const west = Math.floor(bounds.getWest() / step) * step;
		const east = Math.ceil(bounds.getEast() / step) * step;
		for (let lng = west; lng <= east; lng += step)
			lines.push(L.polyline([[bounds.getSouth(), lng], [bounds.getNorth(), lng]], style));
		state._gridLayer = L.layerGroup(lines).addTo(m);
	}
	function toggleTime() {
		timeSliderVisible.update(v => !v);
		if (!$timeSliderVisible) {
			timeFrom.set(null);
			timeTo.set(null);
			window._applyTimeFilter?.();
		}
	}
	function toggleTrust() {
		trustSliderVisible.update(v => !v);
		if (!$trustSliderVisible) {
			minTrustScore.set(null);
		}
	}
	function toggleRoute() {
		window._toggleRouting?.();
	}
	function applyTimeFilter() {
		window._applyTimeFilter?.();
	}

	let timeFromVal = '';
	let timeToVal = '';

	function resetTime() {
		timeFromVal = '';
		timeToVal = '';
		timeFrom.set(null);
		timeTo.set(null);
		applyTimeFilter();
	}
	function applyTime() {
		timeFrom.set(timeFromVal ? parseInt(timeFromVal, 10) : null);
		timeTo.set(timeToVal ? parseInt(timeToVal, 10) : null);
		applyTimeFilter();
	}

	// --- Social popup ---
	function showSocial() {
		const el = document.createElement('div');
		el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);z-index:3000;display:flex;align-items:center;justify-content:center;';
		const items = [
			['📡', 'Host', () => window._showHostModal?.()],
			['🤝', 'Join', () => window._showJoinModal?.()],
			['🔍', 'Discover', () => window._showDiscoverModal?.()],
			['📤', 'Export', () => window._exportMap?.()],
			['📥', 'Import', () => window._importMap?.()],
			['↗', 'Share', () => window._shareMap?.()],
			['⚡', 'Relay', () => window._showIceServerDialog?.((servers) => { import('../../../../peer.js').then(p => p.setIceServers(servers)); })],
		];
		const rows = items.map(([icon, label, action], i) =>
			`<button class="social-item" data-i="${i}" style="display:block;width:100%;padding:8px 12px;border:none;background:transparent;color:var(--text);cursor:pointer;font-size:13px;text-align:left;border-radius:4px;">${icon}  ${label}</button>`
		).join('');
		el.innerHTML = `<div style="background:var(--bg-card);padding:12px;border-radius:8px;min-width:180px;box-shadow:0 4px 20px rgba(0,0,0,0.3);">${rows}<button id="social-close" style="display:block;width:100%;padding:6px 12px;margin-top:6px;border:1px solid var(--border);background:var(--border-light);color:var(--text);border-radius:4px;cursor:pointer;font-size:13px;">Close</button></div>`;
		el.onclick = e => { if (e.target === el) el.remove(); };
		document.body.appendChild(el);
		el.querySelectorAll('.social-item').forEach(b => {
			b.onmouseenter = () => b.style.background = 'var(--bg-input)';
			b.onmouseleave = () => b.style.background = 'transparent';
			b.onclick = () => { items[+b.dataset.i][2](); el.remove(); };
		});
		el.querySelector('#social-close').onclick = () => el.remove();
	}

	// Language reactivity
	let re = 0;
	lang.subscribe(() => re++);

	// Sync body class for CSS map shift
	{
		let _prev = false;
		drawerExpanded.subscribe(v => {
			if (v !== _prev) {
				_prev = v;
				if (v) document.body.classList.add('drawer-expanded');
				else document.body.classList.remove('drawer-expanded');
			}
		});
	}
</script>

<div class="drawer-container" class:expanded={$drawerExpanded} bind:this={containerEl} style={!dragActive && $stripTop !== null ? `top:${$stripTop}px;transform:none;` : ''}>
	<!-- Collapsed strip -->
	{#if !$drawerExpanded}
		<div class="strip" bind:this={stripEl} onmousedown={startDrag} ontouchstart={startDrag}>
			<button class="strip-btn" onclick={() => drawerExpanded.set(true)} title="Menu">≡</button>
			{#if !$stripMinimal}
				<button class="strip-btn" class:active={$placingPin} onclick={togglePin} title={t('pin') || 'Pin'}>📌</button>
				<button class="strip-btn" class:active={$freeDrawing} onclick={toggleDraw} title={t('draw') || 'Draw'}>✏️</button>
				<button class="strip-btn" class:active={$measuring} onclick={toggleMeasure} title={t('measure') || 'Measure'}>📏</button>
				<button class="strip-btn" class:active={$selectionActive} onclick={toggleSelect} title={t('select') || 'Select'}>⊞</button>
				<button class="strip-btn" onclick={() => window._showChainsModal?.()} title={t('chains') || 'Chains'}>🔗</button>
				<button class="strip-btn" onclick={toggleRoute} title={t('route') || 'Route'}>🛣</button>
				<div class="sep"></div>
				<button class="strip-btn" onclick={showSocial} title="Social">🌐</button>
			{/if}
			<button class="collapse-tri" onclick={() => stripMinimal.update(v => !v)} title={$stripMinimal ? 'Show tools' : 'Hide tools'}>
				{$stripMinimal ? '▶' : '▼'}
			</button>
			<div class="grip">
				<span></span><span></span><span></span>
			</div>
		</div>
	{/if}

	<!-- Expanded panel -->
	{#if $drawerExpanded}
		<div class="panel">
			<div class="panel-header">
				<span>piggPin</span>
				<button class="close-btn" onclick={() => drawerExpanded.set(false)}>×</button>
			</div>
			<div class="panel-body">
				<!-- DATA -->
				<div class="section">
					<button class="sec-header" onclick={(e) => e.currentTarget.parentElement.classList.toggle('collapsed')}>
						<span>Data</span><span class="arr">▼</span>
					</button>
					<div class="sec-body">
						<button class="item" onclick={() => window._showSetsModal?.()}>🗺 Maps</button>
						<button class="item" onclick={() => window._showLayersModal?.()}>📑 Layers</button>
						<button class="item" onclick={() => window._showSchemaManagerModal?.()}>📋 Schemas</button>
						<button class="item" onclick={() => window._showCollectionsModal?.()}>📁 Collections</button>
					</div>
				</div>
				<!-- TOOLS -->
				<div class="section">
					<button class="sec-header" onclick={(e) => e.currentTarget.parentElement.classList.toggle('collapsed')}>
						<span>Tools</span><span class="arr">▼</span>
					</button>
					<div class="sec-body">
						<button class="item" class:active={$placingPin} onclick={togglePin}>📌 Pin</button>
						<button class="item" class:active={$freeDrawing} onclick={toggleDraw}>✏️ Draw</button>
						<button class="item" class:active={$measuring} onclick={toggleMeasure}>📏 Measure</button>
						<button class="item" class:active={$selectionActive} onclick={toggleSelect}>⊞ Select</button>
						<button class="item" onclick={() => window._showChainsModal?.()}>🔗 Chains</button>
						<button class="item" onclick={toggleRoute}>🛣 Route</button>
					</div>
				</div>
				<!-- VIEW -->
				<div class="section">
					<button class="sec-header" onclick={(e) => e.currentTarget.parentElement.classList.toggle('collapsed')}>
						<span>View</span><span class="arr">▼</span>
					</button>
					<div class="sec-body">
						<button class="item" class:active={$gridEnabled} onclick={toggleGrid}>▦ Grid</button>
						<button class="item" class:active={$timeSliderVisible} onclick={toggleTime}>⏳ Time</button>
						<button class="item" class:active={$trustSliderVisible} onclick={toggleTrust}>🛡 Trust</button>
						<button class="item" onclick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>⛶ Fullscreen</button>
						<button class="item" onclick={() => window._startCurrentMapSlideshow?.()}>▶ Slideshow</button>
						<button class="item" onclick={() => window._showOfflineDownloadModal?.($map)}>📥 Offline</button>
					</div>
				</div>
				<!-- SHARE -->
				<div class="section">
					<button class="sec-header" onclick={(e) => e.currentTarget.parentElement.classList.toggle('collapsed')}>
						<span>Share</span><span class="arr">▼</span>
					</button>
					<div class="sec-body">
						<button class="item" onclick={() => window._showHostModal?.()}>📡 Host</button>
						<button class="item" onclick={() => window._showJoinModal?.()}>🤝 Join</button>
						<button class="item" onclick={() => window._showDiscoverModal?.()}>🔍 Discover</button>
						<button class="item" onclick={() => window._exportMap?.()}>📤 Export</button>
						<button class="item" onclick={() => window._importMap?.()}>📥 Import</button>
						<button class="item" onclick={() => window._shareMap?.()}>↗ Share</button>
					</div>
				</div>
				<!-- SETTINGS -->
				<div class="section">
					<button class="sec-header" onclick={(e) => e.currentTarget.parentElement.classList.toggle('collapsed')}>
						<span>Settings</span><span class="arr">▼</span>
					</button>
					<div class="sec-body">
						<button class="item" onclick={() => { const on = window._toggleSound?.(); window._svelteToast?.(on ? 'Sound ON' : 'Sound MUTED', on ? '#16a34a' : '#9ca3af'); }}>🔊 Sound</button>
						<button class="item" onclick={() => { const on = window._togglePush?.(); window._svelteToast?.(on ? 'Push ON' : 'Push OFF', on ? '#16a34a' : '#9ca3af'); }}>🔔 Push</button>
						<button class="item" onclick={() => { document.body.classList.toggle('dark'); localStorage.setItem('pins-theme', document.body.classList.contains('dark') ? 'dark' : 'light'); }}>🌓 Theme</button>
						<button class="item" onclick={() => window._showLangChooser?.()}>🌐 Language</button>
						<button class="item" onclick={() => window._showIceServerDialog?.((servers) => { import('../../../../peer.js').then(p => p.setIceServers(servers)); })}>⚡ Relay</button>
						<button class="item" onclick={() => window._rotateKeys?.()}>🔑 Rotate Keys</button>
						<button class="item" onclick={() => window.open('https://github.com/bookenjoyer67/team-pins', '_blank')}>🐙 GitHub</button>
						<button class="item" onclick={() => window._showDonateModal?.()}>💸 Donate</button>
						<button class="item" onclick={() => window._checkForUpdates?.()}>↻ Check Updates</button>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

{#if $drawerExpanded}
	<div class="backdrop" onclick={() => drawerExpanded.set(false)}></div>
{/if}

<!-- Time slider (shown when toggled from View) -->
{#if $timeSliderVisible}
	<div class="slider-bar" style="bottom:10px;">
		<span class="slider-icon">⏳</span>
		<input type="number" placeholder="-∞" bind:value={timeFromVal} class="slider-inp" onkeydown={(e) => { if (e.key === 'Enter') applyTime(); }} />
		<span class="slider-sep">–</span>
		<input type="number" placeholder="∞" bind:value={timeToVal} class="slider-inp" onkeydown={(e) => { if (e.key === 'Enter') applyTime(); }} />
		<button class="slider-btn reset" onclick={resetTime}>reset</button>
		<button class="slider-btn apply" onclick={applyTime}>apply</button>
	</div>
{/if}

<!-- Trust slider (shown when toggled from View) -->
{#if $trustSliderVisible}
	<div class="slider-bar" style="bottom:42px;">
		<span class="slider-icon">🛡</span>
		<input type="range" min="-20" max="20" bind:value={$trustFilterValue} class="slider-range"
			oninput={() => {
				const v = $trustFilterValue / 10;
				minTrustScore.set(v);
			}} />
		<span class="slider-val">{$trustFilterValue === -20 ? 'off' : ($trustFilterValue / 10).toFixed(1)}</span>
	</div>
{/if}

<style>
	.drawer-container {
		position: fixed; top: 50%; right: 0; z-index: 2000;
		transform: translateY(-50%);
		transition: width 0.2s ease, top 0.1s ease;
	}
	.drawer-container.expanded {
		top: 0; height: 100%; width: 200px; transform: none;
		background: var(--bg-card); border-left: 1px solid var(--border);
	}

	/* Strip */
	.strip {
		display: flex; flex-direction: column; align-items: center;
		padding: 8px 2px; gap: 6px; width: 32px;
		background: var(--bg-glass); backdrop-filter: blur(4px);
		border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.12);
		cursor: grab;
	}
	.strip:active { cursor: grabbing; }
	.strip-btn {
		width: 26px; height: 32px; border: none; background: transparent;
		color: var(--text-dim); cursor: pointer; font-size: 14px;
		padding: 0; border-radius: 4px; flex-shrink: 0;
		transition: background 0.1s;
	}
	.strip-btn:hover { background: var(--bg-input); }
	.strip-btn.active { color: var(--blue); }
	.sep {
		width: 20px; height: 1px; background: var(--border);
		flex-shrink: 0; margin: 4px 0;
	}
	.collapse-tri {
		width: 26px; height: 20px; border: none; background: transparent;
		color: var(--text-muted); cursor: pointer; font-size: 10px;
		padding: 0; border-radius: 4px; flex-shrink: 0;
		opacity: 0.6;
	}
	.grip {
		width: 14px; height: 14px; display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 2px;
		opacity: 0.4; flex-shrink: 0; padding: 4px 0;
	}
	.grip span {
		display: block; background: var(--text-dim); border-radius: 1px;
	}
	.grip span:nth-child(1) { width: 12px; height: 1px; }
	.grip span:nth-child(2) { width: 8px; height: 1px; }
	.grip span:nth-child(3) { width: 12px; height: 1px; }

	/* Backdrop */
	.backdrop {
		position: fixed; inset: 0; z-index: 1999;
		background: rgba(0,0,0,0.3);
	}

	/* Panel */
	.panel {
		position: absolute; inset: 0; z-index: 1;
		overflow-y: auto; overflow-x: hidden;
		display: flex; flex-direction: column;
		-webkit-overflow-scrolling: touch;
	}
	.panel-header {
		display: flex; justify-content: space-between; align-items: center;
		padding: 8px 4px 8px 8px; flex-shrink: 0;
		font-size: 13px; font-weight: 600; color: var(--text-dim);
		position: sticky; top: 0; z-index: 1;
		background: var(--bg-card);
	}
	.close-btn {
		width: 26px; height: 26px; border: none; background: transparent;
		color: var(--text-dim); cursor: pointer; font-size: 16px;
		padding: 0; border-radius: 4px;
	}
	.panel-body { flex: 1; padding: 0 8px 16px; }

	/* Sections */
	.section { margin-bottom: 4px; }
	.sec-header {
		display: flex; justify-content: space-between; align-items: center;
		width: 100%; padding: 6px 4px; border: none; background: transparent;
		font-size: 10px; font-weight: 600; color: var(--text-muted);
		text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer;
	}
	.arr { font-size: 10px; }
	.section.collapsed .sec-body { display: none; }
	.section.collapsed .arr { transform: rotate(-90deg); }
	.sec-body { display: block; }
	.item {
		display: flex; align-items: center; gap: 8px;
		width: 100%; padding: 6px 8px; border: none; background: transparent;
		color: var(--text); cursor: pointer; font-size: 12px; text-align: left;
		border-radius: 4px;
	}
	.item:hover { background: var(--bg-input); }
	.item.active {
		box-shadow: inset 3px 0 0 var(--blue);
		color: var(--blue);
	}

	/* Slider bars */
	.slider-bar {
		position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
		z-index: 1001; display: flex; align-items: center; gap: 8px;
		padding: 6px 12px; background: var(--bg-glass);
		backdrop-filter: blur(4px); border-radius: 6px;
		box-shadow: 0 1px 5px var(--shadow);
		font-size: 12px; white-space: nowrap;
	}
	.slider-icon { color: var(--text-dim); }
	.slider-sep { color: var(--text-dim); }
	.slider-inp {
		width: 70px; padding: 3px 4px; border: 1px solid var(--border);
		border-radius: 3px; background: var(--bg-input); color: var(--text);
		font-size: 12px; text-align: center;
	}
	.slider-range { width: 100px; accent-color: var(--blue); }
	.slider-val { min-width: 24px; text-align: right; font-size: 11px; color: var(--text-dim); }
	.slider-btn {
		padding: 3px 8px; border: 1px solid var(--border); border-radius: 3px;
		cursor: pointer; font-size: 11px;
	}
	.slider-btn.reset { background: var(--bg-input); color: var(--text-dim); }
	.slider-btn.apply { border: none; background: #2563eb; color: white; }
</style>
