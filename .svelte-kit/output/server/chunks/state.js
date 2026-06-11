//#region src/lib/stores/app.js
var LAYER_PALETTE = [
	"#7c3aed",
	"#2563eb",
	"#16a34a",
	"#f97316",
	"#eab308",
	"#ec4899",
	"#ef4444",
	"#0891b2"
];
var DEFAULT_LAYER_COLOR = "#7c3aed";
function createWritable$4(initialValue) {
	let value = initialValue;
	const subs = /* @__PURE__ */ new Set();
	return {
		set(v) {
			value = v;
			for (const cb of subs) cb(value);
		},
		update(fn) {
			this.set(fn(value));
		},
		subscribe(cb) {
			cb(value);
			subs.add(cb);
			return () => subs.delete(cb);
		},
		get() {
			return value;
		}
	};
}
var user = createWritable$4({ id: crypto.randomUUID() });
var displayName = createWritable$4("Me");
var signingPublicKey = createWritable$4(null);
var signingSecretKey = createWritable$4(null);
var currentSet = createWritable$4(null);
var currentCommunity = createWritable$4(null);
var dek = createWritable$4(null);
var _notifications = [];
var _history = [];
var lastPlacedPinId = createWritable$4(null);
var pendingConnId = createWritable$4(null);
var defaultLayerColor = DEFAULT_LAYER_COLOR;
var layerPalette = LAYER_PALETTE;
//#endregion
//#region src/lib/stores/map.js
function createWritable$3(initialValue) {
	let value = initialValue;
	const subs = /* @__PURE__ */ new Set();
	return {
		set(v) {
			value = v;
			for (const cb of subs) cb(value);
		},
		update(fn) {
			this.set(fn(value));
		},
		subscribe(cb) {
			cb(value);
			subs.add(cb);
			return () => subs.delete(cb);
		},
		get() {
			return value;
		}
	};
}
var map = createWritable$3(null);
var clusterGroup = createWritable$3(null);
var _markers = [];
var _drawingLayers = [];
var _chainLayers = [];
var _pinSearchText = [];
var placingPin = createWritable$3(false);
var streetViewing = createWritable$3(false);
var measuring = createWritable$3(false);
var freeDrawing = createWritable$3(false);
var _freePoints = [];
var freePreview = createWritable$3(null);
var _freeStrokes = [];
var _freeUndoStack = [];
var freeStrokeColor = createWritable$3("#7c3aed");
var freeStrokeWidth = createWritable$3(3);
var suppressMapSync = createWritable$3(false);
var followMap = createWritable$3(true);
var timeFrom = createWritable$3(null);
var timeTo = createWritable$3(null);
var minTrustScore = createWritable$3(null);
//#endregion
//#region src/lib/stores/layers.js
function createWritable$2(initialValue) {
	let value = initialValue;
	const subs = /* @__PURE__ */ new Set();
	return {
		set(v) {
			value = v;
			for (const cb of subs) cb(value);
		},
		update(fn) {
			this.set(fn(value));
		},
		subscribe(cb) {
			cb(value);
			subs.add(cb);
			return () => subs.delete(cb);
		},
		get() {
			return value;
		}
	};
}
var _layers = [];
var layers = {
	set(v) {
		_layers.splice(0, _layers.length, ...v || []);
	},
	get() {
		return _layers;
	},
	subscribe(cb) {
		cb(_layers);
		return () => {};
	}
};
var _schemas = [];
var schemas = {
	set(v) {
		_schemas.splice(0, _schemas.length, ...v || []);
	},
	get() {
		return _schemas;
	},
	subscribe(cb) {
		cb(_schemas);
		return () => {};
	}
};
var activeLayerId = createWritable$2(null);
var _subscribedDEKs = /* @__PURE__ */ new Map();
var _subscribedMarkers = [];
var _subscribedDrawingLayers = [];
//#endregion
//#region src/lib/stores/peers.js
function createWritable$1(initialValue) {
	let value = initialValue;
	const subs = /* @__PURE__ */ new Set();
	return {
		set(v) {
			value = v;
			for (const cb of subs) cb(value);
		},
		update(fn) {
			this.set(fn(value));
		},
		subscribe(cb) {
			cb(value);
			subs.add(cb);
			return () => subs.delete(cb);
		},
		get() {
			return value;
		}
	};
}
var _peers = /* @__PURE__ */ new Map();
var peers = {
	get() {
		return _peers;
	},
	subscribe(cb) {
		cb(_peers);
		return () => {};
	}
};
var _hostedConnections = /* @__PURE__ */ new Set();
createWritable$1(0);
//#endregion
//#region src/lib/stores/sync.js
function createWritable(initialValue) {
	let value = initialValue;
	const subs = /* @__PURE__ */ new Set();
	return {
		set(v) {
			value = v;
			for (const cb of subs) cb(value);
		},
		update(fn) {
			this.set(fn(value));
		},
		subscribe(cb) {
			cb(value);
			subs.add(cb);
			return () => subs.delete(cb);
		},
		get() {
			return value;
		}
	};
}
createWritable(false);
createWritable(false);
//#endregion
//#region src/lib/engine/state-adapter.js
var state = {
	get user() {
		return user.get();
	},
	set user(v) {
		user.set(v);
	},
	get displayName() {
		return displayName.get();
	},
	set displayName(v) {
		displayName.set(v);
	},
	get signingPublicKey() {
		return signingPublicKey.get();
	},
	set signingPublicKey(v) {
		signingPublicKey.set(v);
	},
	get signingSecretKey() {
		return signingSecretKey.get();
	},
	set signingSecretKey(v) {
		signingSecretKey.set(v);
	},
	get currentSet() {
		return currentSet.get();
	},
	set currentSet(v) {
		currentSet.set(v);
	},
	get currentCommunity() {
		return currentCommunity.get();
	},
	set currentCommunity(v) {
		currentCommunity.set(v);
	},
	get myRole() {
		const comm = currentCommunity.get();
		const pk = signingPublicKey.get();
		if (!comm || !pk) return null;
		const me = (comm.members || []).find((m) => m.pubkey === pk);
		return me ? me.role : null;
	},
	get dek() {
		return dek.get();
	},
	set dek(v) {
		dek.set(v);
	},
	get map() {
		return map.get();
	},
	set map(v) {
		map.set(v);
	},
	get clusterGroup() {
		return clusterGroup.get();
	},
	set clusterGroup(v) {
		clusterGroup.set(v);
	},
	get markers() {
		return _markers;
	},
	get drawingLayers() {
		return _drawingLayers;
	},
	get chainLayers() {
		return _chainLayers;
	},
	get pinSearchText() {
		return _pinSearchText;
	},
	get placingPin() {
		return placingPin.get();
	},
	set placingPin(v) {
		placingPin.set(v);
	},
	get streetViewing() {
		return streetViewing.get();
	},
	set streetViewing(v) {
		streetViewing.set(v);
	},
	get measuring() {
		return measuring.get();
	},
	set measuring(v) {
		measuring.set(v);
	},
	get freeDrawing() {
		return freeDrawing.get();
	},
	set freeDrawing(v) {
		freeDrawing.set(v);
	},
	get freePoints() {
		return _freePoints;
	},
	set freePoints(v) {
		_freePoints.splice(0, _freePoints.length, ...v || []);
	},
	get freePreview() {
		return freePreview.get();
	},
	set freePreview(v) {
		freePreview.set(v);
	},
	get freeStrokes() {
		return _freeStrokes;
	},
	get freeUndoStack() {
		return _freeUndoStack;
	},
	get freeStrokeColor() {
		return freeStrokeColor.get();
	},
	set freeStrokeColor(v) {
		freeStrokeColor.set(v);
	},
	get freeStrokeWidth() {
		return freeStrokeWidth.get();
	},
	set freeStrokeWidth(v) {
		freeStrokeWidth.set(v);
	},
	get lastPlacedPinId() {
		return lastPlacedPinId.get();
	},
	set lastPlacedPinId(v) {
		lastPlacedPinId.set(v);
	},
	get pendingConnId() {
		return pendingConnId.get();
	},
	set pendingConnId(v) {
		pendingConnId.set(v);
	},
	get peers() {
		return peers.get();
	},
	get suppressMapSync() {
		return suppressMapSync.get();
	},
	set suppressMapSync(v) {
		suppressMapSync.set(v);
	},
	get followMap() {
		return followMap.get();
	},
	set followMap(v) {
		followMap.set(v);
	},
	get hostedConnections() {
		return _hostedConnections;
	},
	get history() {
		return _history;
	},
	get layers() {
		return _layers;
	},
	set layers(v) {
		_layers.splice(0, _layers.length, ...v || []);
	},
	get schemas() {
		return _schemas;
	},
	set schemas(v) {
		_schemas.splice(0, _schemas.length, ...v || []);
	},
	get activeLayerId() {
		return activeLayerId.get();
	},
	set activeLayerId(v) {
		activeLayerId.set(v);
	},
	get timeFrom() {
		return timeFrom.get();
	},
	set timeFrom(v) {
		timeFrom.set(v);
	},
	get timeTo() {
		return timeTo.get();
	},
	set timeTo(v) {
		timeTo.set(v);
	},
	get minTrustScore() {
		return minTrustScore.get();
	},
	set minTrustScore(v) {
		minTrustScore.set(v);
	},
	get defaultLayerColor() {
		return defaultLayerColor;
	},
	get layerPalette() {
		return layerPalette;
	},
	get subscribedDEKs() {
		return _subscribedDEKs;
	},
	get subscribedMarkers() {
		return _subscribedMarkers;
	},
	get subscribedDrawingLayers() {
		return _subscribedDrawingLayers;
	},
	get notifications() {
		return _notifications;
	},
	set notifications(v) {
		_notifications.splice(0, _notifications.length, ...v || []);
	},
	get unreadNotificationCount() {
		return _notifications.filter((n) => !n.read).length;
	}
};
//#endregion
export { freeDrawing as a, _history as c, schemas as i, _notifications as l, peers as n, measuring as o, layers as r, placingPin as s, state as t, currentSet as u };
