import { G as attr, K as escape_html, a as attr_class, c as ensure_array_like, f as store_get, h as html, m as unsubscribe_stores, n as onDestroy, o as attr_style, p as stringify } from "../../chunks/index-server.js";
import { a as freeDrawing, o as measuring, s as placingPin } from "../../chunks/state.js";
import { i as lang, o as t } from "../../chunks/state3.js";
import "../../chunks/leaflet-shim.js";
//#region src/lib/components/map/MapContainer.svelte
function MapContainer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		$$renderer.push(`<div id="map-container"></div> `);
		if (window._isEmbed) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<a id="piggpin-watermark" href="https://github.com/bookenjoyer67/team-pins" target="_blank" rel="noopener">piggPin</a>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/lib/stores/drawer.js
function createWritable(initial) {
	let val = initial;
	const subs = /* @__PURE__ */ new Set();
	return {
		set(v) {
			val = v;
			for (const fn of subs) fn(val);
		},
		update(fn) {
			this.set(fn(val));
		},
		subscribe(fn) {
			fn(val);
			subs.add(fn);
			return () => subs.delete(fn);
		},
		get() {
			return val;
		}
	};
}
var drawerExpanded = createWritable(false);
var stripMinimal = createWritable(false);
var stripTop = createWritable(null);
var gridEnabled = createWritable(false);
var timeSliderVisible = createWritable(false);
var trustSliderVisible = createWritable(false);
var selectionActive = createWritable(false);
var trustFilterValue = createWritable(-20);
//#endregion
//#region src/lib/components/topbar/TopBar.svelte
function TopBar($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let searchText = "";
		let unreadCount = 0;
		let mapName = "";
		let peerCount = 0;
		$$renderer.push(`<div id="tabs-row" class="svelte-47xywd"><div class="topbar-inner svelte-47xywd"><div class="topbar-left svelte-47xywd"><span class="topbar-mapname svelte-47xywd">${escape_html(mapName)} ${html("")} ${html("")}</span> <div class="topbar-search-wrap svelte-47xywd"><input id="topbar-search" type="text"${attr("value", searchText)}${attr("placeholder", t("searchPlaces") || "Search places...")} class="svelte-47xywd"/> <button id="topbar-search-btn" class="svelte-47xywd">🔍</button></div></div> <div class="topbar-right svelte-47xywd">`);
		if (peerCount > 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<span class="badge peer svelte-47xywd">● ${escape_html(peerCount)}</span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> <button id="topbar-notif-btn" title="Notifications" class="svelte-47xywd">🔔 `);
		if (unreadCount > 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<span class="notif-badge svelte-47xywd">${escape_html(unreadCount > 99 ? "99+" : unreadCount)}</span>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></button> <button id="topbar-slideshow-btn" title="Slideshow" class="svelte-47xywd">▶</button> <button id="drawer-toggle-btn" title="Menu" class="svelte-47xywd">≡</button></div></div></div> `);
		$$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/lib/components/drawer/Drawer.svelte
function Drawer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let timeFromVal = "";
		let timeToVal = "";
		let re = 0;
		lang.subscribe(() => re++);
		{
			let _prev = false;
			drawerExpanded.subscribe((v) => {
				if (v !== _prev) {
					_prev = v;
					if (v) document.body.classList.add("drawer-expanded");
					else document.body.classList.remove("drawer-expanded");
				}
			});
		}
		$$renderer.push(`<div${attr_class("drawer-container svelte-1ovlrub", void 0, { "expanded": store_get($$store_subs ??= {}, "$drawerExpanded", drawerExpanded) })}${attr_style(store_get($$store_subs ??= {}, "$stripTop", stripTop) !== null ? `top:${store_get($$store_subs ??= {}, "$stripTop", stripTop)}px;transform:none;` : "")}>`);
		if (!store_get($$store_subs ??= {}, "$drawerExpanded", drawerExpanded)) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="strip svelte-1ovlrub"><button class="strip-btn svelte-1ovlrub" title="Menu">≡</button> `);
			if (!store_get($$store_subs ??= {}, "$stripMinimal", stripMinimal)) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<button${attr_class("strip-btn svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$placingPin", placingPin) })}${attr("title", t("pin") || "Pin")}>📌</button> <button${attr_class("strip-btn svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$freeDrawing", freeDrawing) })}${attr("title", t("draw") || "Draw")}>✏️</button> <button${attr_class("strip-btn svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$measuring", measuring) })}${attr("title", t("measure") || "Measure")}>📏</button> <button${attr_class("strip-btn svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$selectionActive", selectionActive) })}${attr("title", t("select") || "Select")}>⊞</button> <button class="strip-btn svelte-1ovlrub"${attr("title", t("chains") || "Chains")}>🔗</button> <button class="strip-btn svelte-1ovlrub"${attr("title", t("route") || "Route")}>🛣</button> `);
				if (!window._isEmbed) {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<div class="sep svelte-1ovlrub"></div> <button class="strip-btn svelte-1ovlrub" title="Social">🌐</button>`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <button class="collapse-tri svelte-1ovlrub"${attr("title", store_get($$store_subs ??= {}, "$stripMinimal", stripMinimal) ? "Show tools" : "Hide tools")}>${escape_html(store_get($$store_subs ??= {}, "$stripMinimal", stripMinimal) ? "▶" : "▼")}</button> <div class="grip svelte-1ovlrub"><span class="svelte-1ovlrub"></span><span class="svelte-1ovlrub"></span><span class="svelte-1ovlrub"></span></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (store_get($$store_subs ??= {}, "$drawerExpanded", drawerExpanded)) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="panel svelte-1ovlrub"><div class="panel-header svelte-1ovlrub"><span>piggPin</span> <button class="close-btn svelte-1ovlrub">×</button></div> <div class="panel-body svelte-1ovlrub"><div class="section svelte-1ovlrub"><button class="sec-header svelte-1ovlrub"><span>Data</span><span class="arr svelte-1ovlrub">▼</span></button> <div class="sec-body svelte-1ovlrub">`);
			if (!window._isEmbed) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<button class="item svelte-1ovlrub">🗺 Maps</button>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <button class="item svelte-1ovlrub">📑 Layers</button> <button class="item svelte-1ovlrub">📋 Schemas</button> <button class="item svelte-1ovlrub">📁 Collections</button></div></div> <div class="section svelte-1ovlrub"><button class="sec-header svelte-1ovlrub"><span>Tools</span><span class="arr svelte-1ovlrub">▼</span></button> <div class="sec-body svelte-1ovlrub"><button${attr_class("item svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$placingPin", placingPin) })}>📌 Pin</button> <button${attr_class("item svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$freeDrawing", freeDrawing) })}>✏️ Draw</button> <button${attr_class("item svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$measuring", measuring) })}>📏 Measure</button> <button${attr_class("item svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$selectionActive", selectionActive) })}>⊞ Select</button> <button class="item svelte-1ovlrub">🔗 Chains</button> <button class="item svelte-1ovlrub">🛣 Route</button></div></div> <div class="section svelte-1ovlrub"><button class="sec-header svelte-1ovlrub"><span>View</span><span class="arr svelte-1ovlrub">▼</span></button> <div class="sec-body svelte-1ovlrub"><button${attr_class("item svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$gridEnabled", gridEnabled) })}>▦ Grid</button> <button${attr_class("item svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$timeSliderVisible", timeSliderVisible) })}>⏳ Time</button> <button${attr_class("item svelte-1ovlrub", void 0, { "active": store_get($$store_subs ??= {}, "$trustSliderVisible", trustSliderVisible) })}>🛡 Trust</button> <button class="item svelte-1ovlrub">⛶ Fullscreen</button> <button class="item svelte-1ovlrub">▶ Slideshow</button> <button class="item svelte-1ovlrub">📥 Offline</button></div></div> `);
			if (window._isEmbed) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<div class="section svelte-1ovlrub"><button class="sec-header svelte-1ovlrub"><span>Share</span><span class="arr svelte-1ovlrub">▼</span></button> <div class="sec-body svelte-1ovlrub"><button class="item svelte-1ovlrub">📤 Export</button></div></div>`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<div class="section svelte-1ovlrub"><button class="sec-header svelte-1ovlrub"><span>Share</span><span class="arr svelte-1ovlrub">▼</span></button> <div class="sec-body svelte-1ovlrub"><button class="item svelte-1ovlrub">📡 Host</button> <button class="item svelte-1ovlrub">🤝 Join</button> <button class="item svelte-1ovlrub">🔍 Discover</button> <button class="item svelte-1ovlrub">📤 Export</button> <button class="item svelte-1ovlrub">📥 Import</button> <button class="item svelte-1ovlrub">↗ Share</button></div></div> <div class="section svelte-1ovlrub"><button class="sec-header svelte-1ovlrub"><span>Settings</span><span class="arr svelte-1ovlrub">▼</span></button> <div class="sec-body svelte-1ovlrub"><button class="item svelte-1ovlrub">🔊 Sound</button> <button class="item svelte-1ovlrub">🔔 Push</button> <button class="item svelte-1ovlrub">🌓 Theme</button> <button class="item svelte-1ovlrub">🌐 Language</button> <button class="item svelte-1ovlrub">⚡ Relay</button> <button class="item svelte-1ovlrub">🔑 Rotate Keys</button> <button class="item svelte-1ovlrub">🐙 GitHub</button> <button class="item svelte-1ovlrub">💸 Donate</button> <button class="item svelte-1ovlrub">↻ Check Updates</button></div></div>`);
			}
			$$renderer.push(`<!--]--></div></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--></div> `);
		if (store_get($$store_subs ??= {}, "$drawerExpanded", drawerExpanded)) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="backdrop svelte-1ovlrub"></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (store_get($$store_subs ??= {}, "$timeSliderVisible", timeSliderVisible)) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="slider-bar svelte-1ovlrub" style="bottom:10px;"><span class="slider-icon svelte-1ovlrub">⏳</span> <input type="number" placeholder="-∞"${attr("value", timeFromVal)} class="slider-inp svelte-1ovlrub"/> <span class="slider-sep svelte-1ovlrub">–</span> <input type="number" placeholder="∞"${attr("value", timeToVal)} class="slider-inp svelte-1ovlrub"/> <button class="slider-btn reset svelte-1ovlrub">reset</button> <button class="slider-btn apply svelte-1ovlrub">apply</button></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		if (store_get($$store_subs ??= {}, "$trustSliderVisible", trustSliderVisible)) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div class="slider-bar svelte-1ovlrub" style="bottom:42px;"><span class="slider-icon svelte-1ovlrub">🛡</span> <input type="range" min="-20" max="20"${attr("value", store_get($$store_subs ??= {}, "$trustFilterValue", trustFilterValue))} class="slider-range svelte-1ovlrub"/> <span class="slider-val svelte-1ovlrub">${escape_html(store_get($$store_subs ??= {}, "$trustFilterValue", trustFilterValue) === -20 ? "off" : (store_get($$store_subs ??= {}, "$trustFilterValue", trustFilterValue) / 10).toFixed(1))}</span></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/lib/components/sync/PeerList.svelte
function PeerList($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		var $$store_subs;
		let items = [];
		let timer;
		onDestroy(() => clearInterval(timer));
		if (items.length > 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div id="peer-list" class="visible svelte-stytfc"><h4 class="svelte-stytfc">Peers</h4> <!--[-->`);
			const each_array = ensure_array_like(items);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let item = each_array[$$index];
				$$renderer.push(`<div class="peer-row svelte-stytfc"><span${attr_class("peer-dot svelte-stytfc", void 0, {
					"online": item.online,
					"offline": !item.online
				})}></span> ${escape_html(item.name)}</div>`);
			}
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
		if ($$store_subs) unsubscribe_stores($$store_subs);
	});
}
//#endregion
//#region src/lib/components/ui/HistoryPanel.svelte
function HistoryPanel($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let items = [];
		function formatTime(ts) {
			return new Date(ts).toLocaleTimeString();
		}
		let timer;
		onDestroy(() => clearInterval(timer));
		if (items.length > 0) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<div id="history-panel" class="svelte-1nnkml"><h4 class="svelte-1nnkml">${escape_html(t("history") || "History")}</h4> <!--[-->`);
			const each_array = ensure_array_like(items);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let item = each_array[$$index];
				$$renderer.push(`<div class="hist-item svelte-1nnkml">${escape_html(item.action)}: ${escape_html(item.detail)} <br/><span class="hist-time svelte-1nnkml">${escape_html(formatTime(item.time))}</span></div>`);
			}
			$$renderer.push(`<!--]--></div>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
//#endregion
//#region src/lib/components/ui/ToastContainer.svelte
function ToastContainer($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let toasts = [];
		$$renderer.push(`<div class="toast-container svelte-16oeye1"><!--[-->`);
		const each_array = ensure_array_like(toasts);
		for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
			let toast = each_array[$$index];
			$$renderer.push(`<div class="toast svelte-16oeye1"${attr_style(`background:${stringify(toast.color)}`)}><span>${escape_html(toast.msg)}</span> `);
			if (toast.undoAction) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<button class="toast-undo svelte-16oeye1">Undo</button>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></div>`);
		}
		$$renderer.push(`<!--]--></div>`);
	});
}
//#endregion
//#region src/routes/+page.svelte
function _page($$renderer) {
	MapContainer($$renderer, {});
	$$renderer.push(`<!----> `);
	if (!window._isEmbed) {
		$$renderer.push("<!--[0-->");
		TopBar($$renderer, {});
	} else $$renderer.push("<!--[-1-->");
	$$renderer.push(`<!--]--> `);
	if (!window._pickMode) {
		$$renderer.push("<!--[0-->");
		Drawer($$renderer, {});
		$$renderer.push(`<!----> `);
		PeerList($$renderer, {});
		$$renderer.push(`<!----> `);
		HistoryPanel($$renderer, {});
		$$renderer.push(`<!---->`);
	} else $$renderer.push("<!--[-1-->");
	$$renderer.push(`<!--]--> `);
	ToastContainer($$renderer, {});
	$$renderer.push(`<!---->`);
}
//#endregion
export { _page as default };
