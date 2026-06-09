// State adapter — presents Svelte stores as the same getter/setter API
// that engine modules (db, sync, peer, relay, etc.) expect from state.js
// Uses relative paths so it works whether imported from root or from src/

import * as appStore from '../stores/app.js';
import * as mapStore from '../stores/map.js';
import * as layersStore from '../stores/layers.js';
import * as peersStore from '../stores/peers.js';
import * as syncStore from '../stores/sync.js';

export const state = {
	// --- User identity ---
	get user() { return appStore.user.get(); },
	set user(v) { appStore.user.set(v); },
	get displayName() { return appStore.displayName.get(); },
	set displayName(v) { appStore.displayName.set(v); },
	get signingPublicKey() { return appStore.signingPublicKey.get(); },
	set signingPublicKey(v) { appStore.signingPublicKey.set(v); },
	get signingSecretKey() { return appStore.signingSecretKey.get(); },
	set signingSecretKey(v) { appStore.signingSecretKey.set(v); },

	// --- Current set/community ---
	get currentSet() { return appStore.currentSet.get(); },
	set currentSet(v) { appStore.currentSet.set(v); },
	get currentCommunity() { return appStore.currentCommunity.get(); },
	set currentCommunity(v) { appStore.currentCommunity.set(v); },
	get myRole() {
		const comm = appStore.currentCommunity.get();
		const pk = appStore.signingPublicKey.get();
		if (!comm || !pk) return null;
		const me = (comm.members || []).find(m => m.pubkey === pk);
		return me ? me.role : null;
	},
	get dek() { return appStore.dek.get(); },
	set dek(v) { appStore.dek.set(v); },

	// --- Map instance ---
	get map() { return mapStore.map.get(); },
	set map(v) { mapStore.map.set(v); },
	get clusterGroup() { return mapStore.clusterGroup.get(); },
	set clusterGroup(v) { mapStore.clusterGroup.set(v); },

	// --- Markers and drawing layers (preserve reference semantics for in-place mutation) ---
	get markers() { return mapStore._markers; },
	get drawingLayers() { return mapStore._drawingLayers; },
	get chainLayers() { return mapStore._chainLayers; },

	// --- Search ---
	get pinSearchText() { return mapStore._pinSearchText; },

	// --- Tool modes ---
	get placingPin() { return mapStore.placingPin.get(); },
	set placingPin(v) { mapStore.placingPin.set(v); },
	get streetViewing() { return mapStore.streetViewing.get(); },
	set streetViewing(v) { mapStore.streetViewing.set(v); },
	get measuring() { return mapStore.measuring.get(); },
	set measuring(v) { mapStore.measuring.set(v); },

	// --- Free drawing ---
	get freeDrawing() { return mapStore.freeDrawing.get(); },
	set freeDrawing(v) { mapStore.freeDrawing.set(v); },
	get freePoints() { return mapStore._freePoints; },
	set freePoints(v) { mapStore._freePoints.splice(0, mapStore._freePoints.length, ...(v || [])); },
	get freePreview() { return mapStore.freePreview.get(); },
	set freePreview(v) { mapStore.freePreview.set(v); },
	get freeStrokes() { return mapStore._freeStrokes; },
	get freeUndoStack() { return mapStore._freeUndoStack; },
	get freeStrokeColor() { return mapStore.freeStrokeColor.get(); },
	set freeStrokeColor(v) { mapStore.freeStrokeColor.set(v); },
	get freeStrokeWidth() { return mapStore.freeStrokeWidth.get(); },
	set freeStrokeWidth(v) { mapStore.freeStrokeWidth.set(v); },

	// --- Last placed / pending ---
	get lastPlacedPinId() { return appStore.lastPlacedPinId.get(); },
	set lastPlacedPinId(v) { appStore.lastPlacedPinId.set(v); },
	get pendingConnId() { return appStore.pendingConnId.get(); },
	set pendingConnId(v) { appStore.pendingConnId.set(v); },

	// --- Peers ---
	get peers() { return peersStore.peers.get(); },
	get suppressMapSync() { return mapStore.suppressMapSync.get(); },
	set suppressMapSync(v) { mapStore.suppressMapSync.set(v); },
	get followMap() { return mapStore.followMap.get(); },
	set followMap(v) { mapStore.followMap.set(v); },
	get hostedConnections() { return peersStore._hostedConnections; },

	// --- History ---
	get history() { return appStore._history; },

	// --- Layers ---
	get layers() { return layersStore._layers; },
	set layers(v) { layersStore._layers.splice(0, layersStore._layers.length, ...(v || [])); },
	get schemas() { return layersStore._schemas; },
	set schemas(v) { layersStore._schemas.splice(0, layersStore._schemas.length, ...(v || [])); },
	get activeLayerId() { return layersStore.activeLayerId.get(); },
	set activeLayerId(v) { layersStore.activeLayerId.set(v); },

	// --- Time / trust filters ---
	get timeFrom() { return mapStore.timeFrom.get(); },
	set timeFrom(v) { mapStore.timeFrom.set(v); },
	get timeTo() { return mapStore.timeTo.get(); },
	set timeTo(v) { mapStore.timeTo.set(v); },
	get minTrustScore() { return mapStore.minTrustScore.get(); },
	set minTrustScore(v) { mapStore.minTrustScore.set(v); },

	// --- Constants ---
	get defaultLayerColor() { return appStore.defaultLayerColor; },
	get layerPalette() { return appStore.layerPalette; },

	// --- Subscribed layers ---
	get subscribedDEKs() { return layersStore._subscribedDEKs; },
	get subscribedMarkers() { return layersStore._subscribedMarkers; },
	get subscribedDrawingLayers() { return layersStore._subscribedDrawingLayers; },

	// --- Notifications ---
	get notifications() { return appStore._notifications; },
	set notifications(v) { appStore._notifications.splice(0, appStore._notifications.length, ...(v || [])); },
	get unreadNotificationCount() { return appStore._notifications.filter(n => !n.read).length; },
};
