// Re-export from the original root state.js for Svelte components
// This ensures components read/write the SAME data as engine modules

import { state as _state } from '../../state.js';

// Re-export the state object directly
// Svelte components will poll or use ManualUpdate pattern
export const state = _state;

// Also re-export as writable stores-compatible wrappers
function createWritable(initialValue) {
	let value = initialValue;
	const subs = new Set();
	return {
		set(v) { value = v; for (const cb of subs) cb(value); },
		update(fn) { this.set(fn(value)); },
		subscribe(cb) { cb(value); subs.add(cb); return () => subs.delete(cb); },
		get value() { return value; }
	};
}

// Polling helpers for Svelte components
let _pollTimer = null;
let _pollCallbacks = new Map();
let _pollId = 0;

export function startPoll(fn, intervalMs = 1000) {
	const id = ++_pollId;
	_pollCallbacks.set(id, fn);
	if (!_pollTimer) {
		_pollTimer = setInterval(() => {
			for (const cb of _pollCallbacks.values()) {
				try { cb(); } catch (e) { /* ignore */ }
			}
		}, intervalMs);
	}
	return id;
}

export function stopPoll(id) {
	_pollCallbacks.delete(id);
	if (_pollCallbacks.size === 0 && _pollTimer) {
		clearInterval(_pollTimer);
		_pollTimer = null;
	}
}
