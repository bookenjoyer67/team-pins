const LAYER_PALETTE = ['#7c3aed', '#2563eb', '#16a34a', '#f97316', '#eab308', '#ec4899', '#ef4444', '#0891b2'];
const DEFAULT_LAYER_COLOR = '#7c3aed';

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

// --- User identity & preferences ---
export const user = createWritable({ id: crypto.randomUUID() });
export const displayName = createWritable('Me');
export const signingPublicKey = createWritable(null);
export const signingSecretKey = createWritable(null);

// --- Current map/community ---
export const currentSet = createWritable(null);
export const currentCommunity = createWritable(null);
export const dek = createWritable(null);

// --- Notifications ---
export const _notifications = [];
export const notifications = {
	set(v) { _notifications.splice(0, _notifications.length, ...(v || [])); },
	get() { return _notifications; },
	subscribe(cb) { cb(_notifications); return () => {}; }
};

// --- History ---
export const _history = [];
export const history = {
	set(v) { _history.splice(0, _history.length, ...(v || [])); },
	get() { return _history; },
	subscribe(cb) { cb(_history); return () => {}; }
};

// --- Pin placement state ---
export const lastPlacedPinId = createWritable(null);
export const pendingConnId = createWritable(null);

// --- Color constants ---
export const defaultLayerColor = DEFAULT_LAYER_COLOR;
export const layerPalette = LAYER_PALETTE;
