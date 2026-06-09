// i18n wrapper — re-exports original i18n.js with Svelte store reactivity
import {
	t as _t,
	setLang as _setLang,
	getLang as _getLang,
	getSupported as _getSupported,
	getTutorialPin as _getTutorialPin
} from '../../../i18n.js';

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

export const lang = createWritable(_getLang());

export function t(key, vars) {
	return _t(key, vars);
}

export function setLang(l) {
	_setLang(l);
	lang.set(l);
}

export function getLang() {
	return _getLang();
}

export function getSupported() {
	return _getSupported();
}

export function getTutorialPin(index) {
	return _getTutorialPin(index);
}
