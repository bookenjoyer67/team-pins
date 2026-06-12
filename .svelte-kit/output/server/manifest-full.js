export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["bgm.mp3","globe.svg","icon-192.png","icon-512.png","leaflet/MarkerCluster.Default.css","leaflet/MarkerCluster.css","leaflet/images/layers-2x.png","leaflet/images/layers.png","leaflet/images/marker-icon-2x.png","leaflet/images/marker-icon.png","leaflet/images/marker-shadow.png","leaflet/images/spritesheet-2x.png","leaflet/images/spritesheet.png","leaflet/images/spritesheet.svg","leaflet/leaflet-maplibre-gl.js","leaflet/leaflet.css","leaflet/leaflet.draw.css","leaflet/leaflet.draw.js","leaflet/leaflet.js","leaflet/leaflet.markercluster.js","manifest.json","sw.js"]),
	mimeTypes: {".mp3":"audio/mpeg",".svg":"image/svg+xml",".png":"image/png",".css":"text/css",".js":"text/javascript",".json":"application/json"},
	_: {
		client: {start:"_app/immutable/entry/start.DOmLlPU_.js",app:"_app/immutable/entry/app.Dn9S2wdZ.js",imports:["_app/immutable/entry/start.DOmLlPU_.js","_app/immutable/chunks/D2Nm8zAw.js","_app/immutable/chunks/Bse9PeMV.js","_app/immutable/chunks/ByPWl-Qi.js","_app/immutable/entry/app.Dn9S2wdZ.js","_app/immutable/chunks/BcgnSMxp.js","_app/immutable/chunks/Bse9PeMV.js","_app/immutable/chunks/ByPWl-Qi.js","_app/immutable/chunks/DXLwiZ0H.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
