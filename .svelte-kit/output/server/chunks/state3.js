import { t as state$1 } from "./state.js";
import { a as t$1, i as setLang$1, n as getSupported$1, t as getLang$1 } from "./i18n.js";
//#region src/lib/i18n/i18n.js
function createWritable(initialValue) {
	let value = initialValue;
	const subs = /* @__PURE__ */ new Set();
	return {
		set(v) {
			value = v;
			for (const cb of subs) cb(value);
		},
		update(fn) {
			this.set(fn(value));
		},
		subscribe(cb) {
			cb(value);
			subs.add(cb);
			return () => subs.delete(cb);
		},
		get() {
			return value;
		}
	};
}
var lang = createWritable(getLang$1());
function t(key, vars) {
	return t$1(key, vars);
}
function setLang(l) {
	setLang$1(l);
	lang.set(l);
}
function getLang() {
	return getLang$1();
}
function getSupported() {
	return getSupported$1();
}
//#endregion
//#region src/lib/state.js
var state = state$1;
//#endregion
export { setLang as a, lang as i, getLang as n, t as o, getSupported as r, state as t };
