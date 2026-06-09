// State — delegates to the Svelte store-backed adapter.
// Engine modules (db, sync, peer, relay, map, etc.) import from here
// and get reactive store-backed getters/setters automatically.
export { state } from './src/lib/engine/state-adapter.js';
