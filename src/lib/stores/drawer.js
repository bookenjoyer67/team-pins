// Drawer state — UI toggle states and drawer position

function createWritable(initial) {
	let val = initial;
	const subs = new Set();
	return {
		set(v) { val = v; for (const fn of subs) fn(val); },
		update(fn) { this.set(fn(val)); },
		subscribe(fn) { fn(val); subs.add(fn); return () => subs.delete(fn); },
		get() { return val; }
	};
}

export const drawerExpanded = createWritable(false);
export const stripMinimal = createWritable(false);
export const stripTop = createWritable(null);

// Tool toggle states (backed by map stores)
export const gridEnabled = createWritable(false);
export const timeSliderVisible = createWritable(false);
export const trustSliderVisible = createWritable(false);
export const selectionActive = createWritable(false);

// Trust filter value
export const trustFilterValue = createWritable(-20); // -2.0 to 2.0 (stored as *10)
