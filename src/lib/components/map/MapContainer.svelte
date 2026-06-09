<script>
	import { onMount } from 'svelte';
	import { state } from '$lib/state.js';

	let mapContainer;

	onMount(async () => {
		// Call the original initMap() from map.js — handles all Leaflet setup
		// (tile layers, cluster group, peer markers, POI, OSM notes,
		//  street view, style picker, vector basemap, popup lifecycle)
		const { initMap } = await import('../../../../map.js');
		initMap();

		// After initMap sets state.map, apply saved tile preference
		const savedTile = localStorage.getItem('pins-tile-layer');
		if (savedTile && state.map) {
			// Fix layer control position to topleft (matches original)
			// initMap's layer control is at 'topleft' by default
		}

		return () => {
			state.map?.remove();
		};
	});
</script>

<div id="map-container" bind:this={mapContainer}></div>

{#if window._isEmbed}
	<a id="piggpin-watermark" href="https://github.com/bookenjoyer67/team-pins" target="_blank" rel="noopener">piggPin</a>
{/if}