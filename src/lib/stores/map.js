function createWritable(initialValue) {
	let value = initialValue;
	const subs = new Set();
	return {
		set(v) { value = v; for (const cb of subs) cb(value); },
		update(fn) { this.set(fn(value)); },
		subscribe(cb) { cb(value); subs.add(cb); return () => subs.delete(cb); },
		get() { return value; }
	};
}

// --- Map instance ---
export const map = createWritable(null);
export const clusterGroup = createWritable(null);

// --- Pin markers and drawing layers ---
export const _markers = [];
export const markers = {
	set(v) { _markers.splice(0, _markers.length, ...(v || [])); },
	get() { return _markers; },
	subscribe(cb) { cb(_markers); return () => {}; }
};
export const _drawingLayers = [];
export const drawingLayers = {
	set(v) { _drawingLayers.splice(0, _drawingLayers.length, ...(v || [])); },
	get() { return _drawingLayers; },
	subscribe(cb) { cb(_drawingLayers); return () => {}; }
};
export const _chainLayers = [];
export const chainLayers = {
	set(v) { _chainLayers.splice(0, _chainLayers.length, ...(v || [])); },
	get() { return _chainLayers; },
	subscribe(cb) { cb(_chainLayers); return () => {}; }
};

// --- Search ---
export const _pinSearchText = [];
export const pinSearchText = {
	set(v) { _pinSearchText.splice(0, _pinSearchText.length, ...(v || [])); },
	get() { return _pinSearchText; },
	subscribe(cb) { cb(_pinSearchText); return () => {}; }
};

// --- Tool modes ---
export const placingPin = createWritable(false);
export const streetViewing = createWritable(false);
export const measuring = createWritable(false);

// --- Free drawing ---
export const freeDrawing = createWritable(false);
export const _freePoints = [];
export const freePoints = {
	set(v) { _freePoints.splice(0, _freePoints.length, ...(v || [])); },
	get() { return _freePoints; },
	subscribe(cb) { cb(_freePoints); return () => {}; }
};
export const freePreview = createWritable(null);
export const _freeStrokes = [];
export const freeStrokes = {
	set(v) { _freeStrokes.splice(0, _freeStrokes.length, ...(v || [])); },
	get() { return _freeStrokes; },
	subscribe(cb) { cb(_freeStrokes); return () => {}; }
};
export const _freeUndoStack = [];
export const freeUndoStack = {
	set(v) { _freeUndoStack.splice(0, _freeUndoStack.length, ...(v || [])); },
	get() { return _freeUndoStack; },
	subscribe(cb) { cb(_freeUndoStack); return () => {}; }
};
export const freeStrokeColor = createWritable('#7c3aed');
export const freeStrokeWidth = createWritable(3);

// --- Sync controls ---
export const suppressMapSync = createWritable(false);
export const followMap = createWritable(true);

// --- Time/trust filters ---
export const timeFrom = createWritable(null);
export const timeTo = createWritable(null);
export const minTrustScore = createWritable(null);
