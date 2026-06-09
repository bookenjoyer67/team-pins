// Dialog store — Promise-based API matching the old dialogs.js interface.
// Engine modules call convenience functions that return Promises.
// +layout.svelte renders the top dialog from the stack.

let _id = 0;
let _stack = [];
const _listeners = new Set();

function notify() {
	for (const fn of _listeners) fn([..._stack]);
}

export const dialogs = {
	subscribe(fn) {
		fn([..._stack]);
		_listeners.add(fn);
		return () => _listeners.delete(fn);
	},
	get stack() { return _stack; }
};

function push(component, props, resolve) {
	const id = ++_id;
	_stack.push({ id, component, props, resolve });
	notify();
}

function pop(result) {
	const entry = _stack.pop();
	if (entry) {
		if (entry.resolve) entry.resolve(result);
		notify();
	}
}

// --- Engine-compatible convenience functions ---

export function confirm(message) {
	return new Promise((resolve) => push('confirm', { message }, resolve));
}

export function alert(message) {
	return new Promise((resolve) => push('alert', { message }, resolve));
}

export function promptPassword(title, checkboxLabel = null) {
	return new Promise((resolve) => push('password', { title, checkboxLabel }, resolve));
}

export function promptSetPassword(label) {
	return new Promise((resolve) => push('setPassword', { label }, resolve));
}

export function showQRAnswer(title, answer, qrSvg) {
	return new Promise((resolve) => push('qrAnswer', { title, answer, qrSvg }, resolve));
}

export function showQRHost(connId, code, compact, link, callbacks) {
	return new Promise((resolve) => push('qrHost', { connId, code, compact, link, ...callbacks }, resolve));
}

export function showIceServer(onSave) {
	return new Promise((resolve) => push('iceServer', { onSave }, resolve));
}

export function showProgress(title) {
	let pct = 0;
	let label = 'Preparing...';
	const id = ++_id;
	const entry = {
		id,
		component: 'progress',
		props: {
			title,
			get percent() { return pct; },
			get label() { return label; }
		},
		resolve: null
	};
	_stack.push(entry);
	notify();
	return {
		update(p, m) {
			pct = Math.min(100, Math.max(0, Math.round(p)));
			if (m) label = m;
			notify();
		},
		done() {
			const idx = _stack.findIndex(d => d.id === id);
			if (idx >= 0) { _stack.splice(idx, 1); notify(); }
		}
	};
}

export function showColorPicker(currentColor, onChange) {
	return new Promise((resolve) => push('colorPicker', { currentColor, onChange }, resolve));
}

export function showDrawingForm(geometry) {
	return new Promise((resolve) => push('drawingForm', { geometry }, resolve));
}

export function showPinDetail(pinId) {
	return new Promise((resolve) => push('pinDetail', { pinId }, resolve));
}

export function showPinForm(lat, lng) {
	return new Promise((resolve) => push('pinForm', { lat, lng }, resolve));
}

export function showEditPinForm(pinId) {
	return new Promise((resolve) => push('pinForm', { pinId, editing: true }, resolve));
}

export function showHostModal() {
	return new Promise((resolve) => push('hostModal', {}, resolve));
}

export function showJoinModal() {
	return new Promise((resolve) => push('joinModal', {}, resolve));
}

// Called by dialog components to resolve and close
export function resolveDialog(result) {
	pop(result);
}

// Close without resolution (Escape/backdrop)
export function cancelDialog() {
	pop(null);
}
