let wasmExports, wasmMemory;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function init(moduleOrPath) {
    if (wasmExports) return;

    if (!moduleOrPath) {
        moduleOrPath = new URL('spatial.wasm', import.meta.url);
    }

    let instance;
    if (moduleOrPath instanceof WebAssembly.Module) {
        instance = new WebAssembly.Instance(moduleOrPath, {});
    } else {
        const resp = await fetch(moduleOrPath);
        instance = (await WebAssembly.instantiate(await resp.arrayBuffer(), {})).instance;
    }

    wasmExports = instance.exports;
    wasmMemory = wasmExports.memory;
}

function ptrLen(s) {
    const bytes = encoder.encode(s);
    const ptr = wasmExports.alloc(bytes.length);
    if (ptr === 0) throw new Error("spatial: alloc failed");
    new Uint8Array(wasmMemory.buffer, ptr, bytes.length).set(bytes);
    return { ptr, len: bytes.length };
}

function readStr(ptr, len) {
    return decoder.decode(new Uint8Array(wasmMemory.buffer, ptr, len));
}

class SpatialIndex {
    constructor(capacity = 4096) {
        this.handle = wasmExports.spatial_new(capacity);
        if (this.handle === 0) throw new Error("spatial: spatial_new failed");
    }

    insert(id, lat, lng) {
        const { ptr, len } = ptrLen(id);
        wasmExports.spatial_insert(this.handle, ptr, len, lat, lng);
    }

    remove(id) {
        const { ptr, len } = ptrLen(id);
        return wasmExports.spatial_remove(this.handle, ptr, len) !== 0;
    }

    queryBbox(sw_lat, sw_lng, ne_lat, ne_lng) {
        const resultPtr = wasmExports.spatial_query_bbox(this.handle, sw_lat, sw_lng, ne_lat, ne_lng);
        if (resultPtr === 0) return [];
        const resultLen = wasmExports.spatial_query_len();
        const json = readStr(resultPtr, resultLen);
        return JSON.parse(json);
    }

    clear() {
        wasmExports.spatial_clear(this.handle);
    }

    free() {
        if (this.handle !== 0) {
            wasmExports.spatial_free(this.handle);
            this.handle = 0;
        }
    }
}

export { init, SpatialIndex };
export default init;
