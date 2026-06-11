
// this file is generated — do not edit it


declare module "svelte/elements" {
	export interface HTMLAttributes<T> {
		'data-sveltekit-keepfocus'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-noscroll'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-preload-code'?:
			| true
			| ''
			| 'eager'
			| 'viewport'
			| 'hover'
			| 'tap'
			| 'off'
			| undefined
			| null;
		'data-sveltekit-preload-data'?: true | '' | 'hover' | 'tap' | 'off' | undefined | null;
		'data-sveltekit-reload'?: true | '' | 'off' | undefined | null;
		'data-sveltekit-replacestate'?: true | '' | 'off' | undefined | null;
	}
}

export {};


declare module "$app/types" {
	type MatcherParam<M> = M extends (param : string) => param is (infer U extends string) ? U : string;

	export interface AppTypes {
		RouteId(): "/";
		RouteParams(): {
			
		};
		LayoutParams(): {
			"/": Record<string, never>
		};
		Pathname(): "/";
		ResolvedPathname(): `${"" | `/${string}`}${ReturnType<AppTypes['Pathname']>}`;
		Asset(): "/bgm.mp3" | "/globe.svg" | "/icon-192.png" | "/icon-512.png" | "/leaflet/MarkerCluster.Default.css" | "/leaflet/MarkerCluster.css" | "/leaflet/images/layers-2x.png" | "/leaflet/images/layers.png" | "/leaflet/images/marker-icon-2x.png" | "/leaflet/images/marker-icon.png" | "/leaflet/images/marker-shadow.png" | "/leaflet/images/spritesheet-2x.png" | "/leaflet/images/spritesheet.png" | "/leaflet/images/spritesheet.svg" | "/leaflet/leaflet-maplibre-gl.js" | "/leaflet/leaflet.css" | "/leaflet/leaflet.draw.css" | "/leaflet/leaflet.draw.js" | "/leaflet/leaflet.js" | "/leaflet/leaflet.markercluster.js" | "/manifest.json" | "/sw.js" | string & {};
	}
}