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

// --- Peers ---
const _peers = new Map();
export const peers = {
	get() { return _peers; },
	subscribe(cb) { cb(_peers); return () => {}; }
};

// --- Hosted connections ---
export const _hostedConnections = new Set();
export const hostedConnections = {
	get() { return _hostedConnections; },
	subscribe(cb) { cb(_hostedConnections); return () => {}; }
};

// --- Connection count (derived) ---
export const connectionCount = createWritable(0);
