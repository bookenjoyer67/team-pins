//#region map.js
function addPickMarker(lat, lng) {
	if (!state.map) {
		console.warn("[piggpin] addPickMarker: map not ready");
		return;
	}
	if (!window._pickMode) {
		console.warn("[piggpin] addPickMarker: not in pick mode");
		return;
	}
	console.log("[piggpin] pick: placing marker at", lat, lng);
	const icon = L.divIcon({
		className: "pick-marker",
		html: "<div style=\"width:24px;height:24px;background:#2563eb;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);cursor:grab;\"></div>",
		iconSize: [24, 24],
		iconAnchor: [12, 12]
	});
	const marker = L.marker([lat, lng], {
		draggable: true,
		icon
	}).addTo(state.map);
	const fmt = (v) => v.toFixed(5);
	marker.bindTooltip(`${fmt(lat)}, ${fmt(lng)}`, {
		permanent: true,
		direction: "top",
		className: "pick-tooltip"
	}).openTooltip();
	let pickPinData = null;
	if (state.dek) try {
		const enc = encrypt_pin_data("Pin", "", lat, lng, "#2563eb", state.dek);
		pickPinData = {
			pin_id: generate_uuid(),
			community_id: state.currentSet,
			ciphertext: enc.ciphertext,
			nonce: enc.nonce,
			author_pubkey: state.signingPublicKey,
			created_at: Date.now(),
			layer_id: state.layers[0]?.layer_id || "",
			emoji: "📌"
		};
		DB.savePin(pickPinData).catch((e) => console.warn("[piggpin] pick pin save failed:", e));
	} catch (e) {
		pickPinData = null;
	}
	marker.on("dragend", () => {
		const pos = marker.getLatLng();
		marker.setTooltipContent(`${fmt(pos.lat)}, ${fmt(pos.lng)}`);
		console.log("[piggpin] pick: sending drag coords", pos.lat, pos.lng);
		try {
			window.parent.postMessage({
				type: "piggpin:location-picked",
				lat: pos.lat,
				lng: pos.lng
			}, "*");
		} catch (_) {}
	});
	try {
		console.log("[piggpin] pick: sending initial coords", lat, lng);
		window.parent.postMessage({
			type: "piggpin:location-picked",
			lat,
			lng
		}, "*");
	} catch (_) {}
	if (pickPinData) {
		window._broadcast?.("new_pin", {
			...pickPinData,
			team_id: state.currentSet
		});
		window._relayPushDelta?.(state.currentSet, [pickPinData], [], [], [], [], [], [], {});
	}
}
//#endregion
export { addPickMarker };
