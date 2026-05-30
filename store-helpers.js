import { Store, ChunkStore } from "./core/pkg/e2e_core.js";

// ---- Map-compatible wrapper around WASM Store ----

export class BoundedMap {
    #store;

    /**
     * @param {number} maxEntries  maximum entries before FIFO eviction
     * @param {number} ttlMs       default TTL in milliseconds
     */
    constructor(maxEntries, ttlMs) {
        this.#store = new Store(maxEntries, ttlMs);
    }

    get(key) {
        const v = this.#store.get(key);
        // serde_wasm_bindgen returns Maps for JSON objects — convert to plain objects
        return deepToObject(v);
    }

    set(key, v) { this.#store.set(key, v); }
    delete(key) { return this.#store.delete(key); }
    has(key)    { return this.#store.has(key); }
    get size()  { return this.#store.size(); }
    clear()     { this.#store.clear(); }

    entries() {
        return this.#store.entries().map(([k, v]) => [k, deepToObject(v)]);
    }

    values() {
        return this.#store.values().map(v => deepToObject(v));
    }

    keys()    { return this.#store.keys(); }
    setTtl(key, ttlMs) { this.#store.set_ttl(key, ttlMs); }
    evictExpired() { return this.#store.evict_expired(); }

    [Symbol.iterator]() {
        return this.entries()[Symbol.iterator]();
    }
}

function deepToObject(v) {
    if (v === undefined || v === null || typeof v !== "object") return v;
    if (v instanceof Map) {
        const obj = {};
        for (const [k, val] of v) obj[k] = deepToObject(val);
        return obj;
    }
    if (Array.isArray(v)) return v.map(deepToObject);
    return v;
}

// ---- Unified cleanup for all WASM stores ----

const _stores = [];

/**
 * Register a store (ChunkStore, BoundedMap, or deferred wrapper) for periodic cleanup.
 */
export function registerStore(store) {
    _stores.push(store);
}

// Single global 30s cleanup interval
let _cleanupTimer = setInterval(() => {
    for (const s of _stores) {
        if (s.evictExpired) s.evictExpired();
    }
}, 30_000);

if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
        if (_cleanupTimer) {
            clearInterval(_cleanupTimer);
            _cleanupTimer = null;
        }
    });
}

// ---- Deferred wrappers (WASM may not be ready at module load time) ----

/**
 * Proxies ChunkStore methods. Creates the real WASM store on first access.
 * Auto-registers for cleanup.
 */
export class DeferredChunkStore {
    #max;
    #ttl;
    #store = null;

    constructor(max, ttl) {
        this.#max = max;
        this.#ttl = ttl;
    }

    #s() {
        if (!this.#store) {
            this.#store = new ChunkStore(this.#max, this.#ttl);
            _stores.push(this.#store);
        }
        return this.#store;
    }

    add_chunk(k, i, t, d)   { return this.#s().add_chunk(k, i, t, d); }
    assemble(k)              { return this.#s().assemble(k); }
    remove(k)                { return this.#s().remove(k); }
    evictExpired()           { return this.#s().evictExpired(); }
    clear()                  { this.#store?.clear(); }
}

/**
 * Proxies BoundedMap. Creates the real store on first access.
 * Auto-registers for cleanup.
 */
export class DeferredBoundedMap {
    #max;
    #ttl;
    #store = null;

    constructor(max, ttl) {
        this.#max = max;
        this.#ttl = ttl;
    }

    #s() {
        if (!this.#store) {
            this.#store = new BoundedMap(this.#max, this.#ttl);
            _stores.push(this.#store);
        }
        return this.#store;
    }

    get(k)       { return this.#s().get(k); }
    set(k, v)    { this.#s().set(k, v); }
    delete(k)    { return this.#s().delete(k); }
    has(k)       { return this.#s().has(k); }
    get size()   { return this.#s().size; }
    clear()      { return this.#s().clear(); }
    entries()    { return this.#s().entries(); }
    values()     { return this.#s().values(); }
    keys()       { return this.#s().keys(); }
    setTtl(k, t) { this.#s().setTtl(k, t); }
    evictExpired(){ return this.#s().evictExpired(); }

    [Symbol.iterator]() { return this.#s()[Symbol.iterator](); }
}
