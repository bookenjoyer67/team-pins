//#region src/lib/stores/dialogs.js
var _id = 0;
var _stack = [];
var _listeners = /* @__PURE__ */ new Set();
function notify() {
	for (const fn of _listeners) fn([..._stack]);
}
var dialogs = {
	subscribe(fn) {
		fn([..._stack]);
		_listeners.add(fn);
		return () => _listeners.delete(fn);
	},
	get stack() {
		return _stack;
	}
};
function push(component, props, resolve) {
	const id = ++_id;
	_stack.push({
		id,
		component,
		props,
		resolve
	});
	notify();
}
function pop(result) {
	const entry = _stack.pop();
	if (entry) {
		if (entry.resolve) entry.resolve(result);
		notify();
	}
}
function confirm(message) {
	return new Promise((resolve) => push("confirm", { message }, resolve));
}
function alert(message) {
	return new Promise((resolve) => push("alert", { message }, resolve));
}
function promptPassword(title, checkboxLabel = null) {
	return new Promise((resolve) => push("password", {
		title,
		checkboxLabel
	}, resolve));
}
function promptSetPassword(label) {
	return new Promise((resolve) => push("setPassword", { label }, resolve));
}
function showQRAnswer(title, answer, qrSvg) {
	return new Promise((resolve) => push("qrAnswer", {
		title,
		answer,
		qrSvg
	}, resolve));
}
function showQRHost(connId, code, compact, link, callbacks) {
	return new Promise((resolve) => push("qrHost", {
		connId,
		code,
		compact,
		link,
		...callbacks
	}, resolve));
}
function showIceServer(onSave) {
	return new Promise((resolve) => push("iceServer", { onSave }, resolve));
}
function showProgress(title) {
	let pct = 0;
	let label = "Preparing...";
	const id = ++_id;
	const entry = {
		id,
		component: "progress",
		props: {
			title,
			get percent() {
				return pct;
			},
			get label() {
				return label;
			}
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
			const idx = _stack.findIndex((d) => d.id === id);
			if (idx >= 0) {
				_stack.splice(idx, 1);
				notify();
			}
		}
	};
}
function showColorPicker(currentColor, onChange) {
	return new Promise((resolve) => push("colorPicker", {
		currentColor,
		onChange
	}, resolve));
}
function showDrawingForm(geometry) {
	return new Promise((resolve) => push("drawingForm", { geometry }, resolve));
}
function showPinDetail(pinId) {
	return new Promise((resolve) => push("pinDetail", { pinId }, resolve));
}
function showPinForm(lat, lng) {
	return new Promise((resolve) => push("pinForm", {
		lat,
		lng
	}, resolve));
}
function showEditPinForm(pinId) {
	return new Promise((resolve) => push("pinForm", {
		pinId,
		editing: true
	}, resolve));
}
function showHostModal() {
	return new Promise((resolve) => push("hostModal", {}, resolve));
}
function showJoinModal() {
	return new Promise((resolve) => push("joinModal", {}, resolve));
}
function resolveDialog(result) {
	pop(result);
}
function cancelDialog() {
	pop(null);
}
//#endregion
export { showQRAnswer as _, promptPassword as a, showColorPicker as c, showHostModal as d, showIceServer as f, showProgress as g, showPinForm as h, dialogs as i, showDrawingForm as l, showPinDetail as m, cancelDialog as n, promptSetPassword as o, showJoinModal as p, confirm as r, resolveDialog as s, alert as t, showEditPinForm as u, showQRHost as v };
