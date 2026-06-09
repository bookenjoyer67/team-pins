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

// --- Layers ---
export const _layers = [];
export const layers = {
	set(v) { _layers.splice(0, _layers.length, ...(v || [])); },
	get() { return _layers; },
	subscribe(cb) { cb(_layers); return () => {}; }
};

// --- Schemas ---
export const _schemas = [];
export const schemas = {
	set(v) { _schemas.splice(0, _schemas.length, ...(v || [])); },
	get() { return _schemas; },
	subscribe(cb) { cb(_schemas); return () => {}; }
};

// --- Active layer ---
export const activeLayerId = createWritable(null);

// --- Subscribed layers (cross-set) ---
export const _subscribedDEKs = new Map();
export const _subscribedMarkers = [];
export const _subscribedDrawingLayers = [];
