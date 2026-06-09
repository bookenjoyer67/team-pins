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

// --- Sync status ---
export const relayConnected = createWritable(false);
export const meshConnected = createWritable(false);
