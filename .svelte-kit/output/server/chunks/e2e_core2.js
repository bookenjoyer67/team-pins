//#region core/pkg/e2e_core.js
var ChunkStore = class {
	__destroy_into_raw() {
		const ptr = this.__wbg_ptr;
		this.__wbg_ptr = 0;
		ChunkStoreFinalization.unregister(this);
		return ptr;
	}
	free() {
		const ptr = this.__destroy_into_raw();
		wasm.__wbg_chunkstore_free(ptr, 0);
	}
	/**
	* Add a chunk at the given index. Returns true when all chunks received.
	* @param {string} key
	* @param {number} index
	* @param {number} total
	* @param {string} data
	* @returns {boolean}
	*/
	add_chunk(key, index, total, data) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(data, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		return wasm.chunkstore_add_chunk(this.__wbg_ptr, ptr0, len0, index, total, ptr1, len1) !== 0;
	}
	/**
	* Assemble all chunks in order, joined as a single string.
	* Returns None if not complete.
	* @param {string} key
	* @returns {string | undefined}
	*/
	assemble(key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.chunkstore_assemble(this.__wbg_ptr, ptr0, len0);
		let v2;
		if (ret[0] !== 0) {
			v2 = getStringFromWasm0(ret[0], ret[1]).slice();
			wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
		}
		return v2;
	}
	clear() {
		wasm.chunkstore_clear(this.__wbg_ptr);
	}
	/**
	* @returns {number}
	*/
	evict_expired() {
		return wasm.chunkstore_evict_expired(this.__wbg_ptr) >>> 0;
	}
	/**
	* @param {number} max_entries
	* @param {number} ttl_ms
	*/
	constructor(max_entries, ttl_ms) {
		const ret = wasm.chunkstore_new(max_entries, ttl_ms);
		this.__wbg_ptr = ret;
		ChunkStoreFinalization.register(this, this.__wbg_ptr, this);
		return this;
	}
	/**
	* @param {string} key
	* @returns {boolean}
	*/
	remove(key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		return wasm.chunkstore_remove(this.__wbg_ptr, ptr0, len0) !== 0;
	}
};
if (Symbol.dispose) ChunkStore.prototype[Symbol.dispose] = ChunkStore.prototype.free;
var Store = class {
	__destroy_into_raw() {
		const ptr = this.__wbg_ptr;
		this.__wbg_ptr = 0;
		StoreFinalization.unregister(this);
		return ptr;
	}
	free() {
		const ptr = this.__destroy_into_raw();
		wasm.__wbg_store_free(ptr, 0);
	}
	clear() {
		wasm.store_clear(this.__wbg_ptr);
	}
	/**
	* @param {string} key
	* @returns {boolean}
	*/
	delete(key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		return wasm.store_delete(this.__wbg_ptr, ptr0, len0) !== 0;
	}
	/**
	* @returns {any[]}
	*/
	entries() {
		const ret = wasm.store_entries(this.__wbg_ptr);
		var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
		wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
		return v1;
	}
	/**
	* @returns {number}
	*/
	evict_expired() {
		return wasm.store_evict_expired(this.__wbg_ptr) >>> 0;
	}
	/**
	* @param {string} key
	* @returns {any}
	*/
	get(key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		return wasm.store_get(this.__wbg_ptr, ptr0, len0);
	}
	/**
	* @param {string} key
	* @returns {boolean}
	*/
	has(key) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		return wasm.store_has(this.__wbg_ptr, ptr0, len0) !== 0;
	}
	/**
	* @returns {any[]}
	*/
	keys() {
		const ret = wasm.store_keys(this.__wbg_ptr);
		var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
		wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
		return v1;
	}
	/**
	* @param {number} max_entries
	* @param {number} default_ttl_ms
	*/
	constructor(max_entries, default_ttl_ms) {
		const ret = wasm.store_new(max_entries, default_ttl_ms);
		this.__wbg_ptr = ret;
		StoreFinalization.register(this, this.__wbg_ptr, this);
		return this;
	}
	/**
	* @param {string} key
	* @param {any} value
	*/
	set(key, value) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		wasm.store_set(this.__wbg_ptr, ptr0, len0, value);
	}
	/**
	* @param {string} key
	* @param {number} ttl_ms
	*/
	set_ttl(key, ttl_ms) {
		const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		wasm.store_set_ttl(this.__wbg_ptr, ptr0, len0, ttl_ms);
	}
	/**
	* @returns {number}
	*/
	size() {
		return wasm.store_size(this.__wbg_ptr) >>> 0;
	}
	/**
	* @returns {any[]}
	*/
	values() {
		const ret = wasm.store_values(this.__wbg_ptr);
		var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
		wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
		return v1;
	}
};
if (Symbol.dispose) Store.prototype[Symbol.dispose] = Store.prototype.free;
/**
* @param {string} b64
* @returns {Uint8Array}
*/
function base64_decode(b64) {
	const ptr0 = passStringToWasm0(b64, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.base64_decode(ptr0, len0);
	var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v2;
}
/**
* @param {Uint8Array} data
* @returns {string}
*/
function base64_encode(data) {
	let deferred2_0;
	let deferred2_1;
	try {
		const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.base64_encode(ptr0, len0);
		deferred2_0 = ret[0];
		deferred2_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
	}
}
/**
* @param {string} b64url
* @returns {Uint8Array}
*/
function base64url_decode(b64url) {
	const ptr0 = passStringToWasm0(b64url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.base64url_decode(ptr0, len0);
	if (ret[3]) throw takeFromExternrefTable0(ret[2]);
	var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v2;
}
/**
* @param {Uint8Array} data
* @returns {string}
*/
function base64url_encode(data) {
	let deferred2_0;
	let deferred2_1;
	try {
		const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.base64url_encode(ptr0, len0);
		deferred2_0 = ret[0];
		deferred2_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
	}
}
/**
* strip_empty + hex→base64 for hex-keyed fields + serialize back to JSON.
* Replaces: JSON.stringify(packHexFields(stripEmpties(data)))
* @param {string} json
* @returns {string}
*/
function compact_and_pack_json(json) {
	let deferred3_0;
	let deferred3_1;
	try {
		const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.compact_and_pack_json(ptr0, len0);
		var ptr2 = ret[0];
		var len2 = ret[1];
		if (ret[3]) {
			ptr2 = 0;
			len2 = 0;
			throw takeFromExternrefTable0(ret[2]);
		}
		deferred3_0 = ptr2;
		deferred3_1 = len2;
		return getStringFromWasm0(ptr2, len2);
	} finally {
		wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
	}
}
/**
* Same as compact_and_pack_json + compress_gzip_max. Returns compressed bytes.
* Replaces: compress_gzip_max(new TextEncoder().encode(JSON.stringify(packHexFields(stripEmpties(data)))))
* @param {string} json
* @returns {Uint8Array}
*/
function compact_pack_gzip_json(json) {
	const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.compact_pack_gzip_json(ptr0, len0);
	if (ret[3]) throw takeFromExternrefTable0(ret[2]);
	var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v2;
}
/**
* @param {Uint8Array} data
* @returns {Uint8Array}
*/
function compress_gzip(data) {
	const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.compress_gzip(ptr0, len0);
	var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v2;
}
/**
* @param {Uint8Array} data
* @returns {Uint8Array}
*/
function compress_gzip_max(data) {
	const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.compress_gzip_max(ptr0, len0);
	var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v2;
}
/**
* @param {Uint8Array} data
* @returns {string}
*/
function compress_gzip_to_base64(data) {
	let deferred2_0;
	let deferred2_1;
	try {
		const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.compress_gzip_to_base64(ptr0, len0);
		deferred2_0 = ret[0];
		deferred2_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
	}
}
/**
* @param {string} hex
* @returns {Uint8Array}
*/
function decode_hex(hex) {
	const ptr0 = passStringToWasm0(hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.decode_hex(ptr0, len0);
	var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v2;
}
/**
* @param {Uint8Array} data
* @returns {Uint8Array}
*/
function decompress_gzip(data) {
	const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.decompress_gzip(ptr0, len0);
	if (ret[3]) throw takeFromExternrefTable0(ret[2]);
	var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v2;
}
/**
* @param {string} ciphertext_hex
* @param {string} nonce_hex
* @param {string} salt_hex
* @param {string} password
* @returns {Uint8Array}
*/
function decrypt_bytes_with_password(ciphertext_hex, nonce_hex, salt_hex, password) {
	const ptr0 = passStringToWasm0(ciphertext_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	const ptr2 = passStringToWasm0(salt_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len2 = WASM_VECTOR_LEN;
	const ptr3 = passStringToWasm0(password, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len3 = WASM_VECTOR_LEN;
	const ret = wasm.decrypt_bytes_with_password(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
	if (ret[3]) throw takeFromExternrefTable0(ret[2]);
	var v5 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v5;
}
/**
* @param {string} ciphertext_hex
* @param {string} nonce_hex
* @param {Uint8Array} dek
* @returns {string}
*/
function decrypt_geojson(ciphertext_hex, nonce_hex, dek) {
	let deferred5_0;
	let deferred5_1;
	try {
		const ptr0 = passStringToWasm0(ciphertext_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ptr2 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
		const len2 = WASM_VECTOR_LEN;
		const ret = wasm.decrypt_geojson(ptr0, len0, ptr1, len1, ptr2, len2);
		var ptr4 = ret[0];
		var len4 = ret[1];
		if (ret[3]) {
			ptr4 = 0;
			len4 = 0;
			throw takeFromExternrefTable0(ret[2]);
		}
		deferred5_0 = ptr4;
		deferred5_1 = len4;
		return getStringFromWasm0(ptr4, len4);
	} finally {
		wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
	}
}
/**
* @param {string} ciphertext_hex
* @param {string} nonce_hex
* @param {Uint8Array} dek
* @returns {any}
*/
function decrypt_pin_data(ciphertext_hex, nonce_hex, dek) {
	const ptr0 = passStringToWasm0(ciphertext_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	const ptr2 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
	const len2 = WASM_VECTOR_LEN;
	const ret = wasm.decrypt_pin_data(ptr0, len0, ptr1, len1, ptr2, len2);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
/**
* @param {string} ciphertext_hex
* @param {string} nonce_hex
* @param {Uint8Array} dek
* @returns {Uint8Array}
*/
function decrypt_raw_bytes(ciphertext_hex, nonce_hex, dek) {
	const ptr0 = passStringToWasm0(ciphertext_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	const ptr2 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
	const len2 = WASM_VECTOR_LEN;
	const ret = wasm.decrypt_raw_bytes(ptr0, len0, ptr1, len1, ptr2, len2);
	if (ret[3]) throw takeFromExternrefTable0(ret[2]);
	var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v4;
}
/**
* @param {string} ciphertext_hex
* @param {string} nonce_hex
* @param {string} salt_hex
* @param {string} password
* @returns {string}
*/
function decrypt_with_password(ciphertext_hex, nonce_hex, salt_hex, password) {
	let deferred6_0;
	let deferred6_1;
	try {
		const ptr0 = passStringToWasm0(ciphertext_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ptr2 = passStringToWasm0(salt_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len2 = WASM_VECTOR_LEN;
		const ptr3 = passStringToWasm0(password, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len3 = WASM_VECTOR_LEN;
		const ret = wasm.decrypt_with_password(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
		var ptr5 = ret[0];
		var len5 = ret[1];
		if (ret[3]) {
			ptr5 = 0;
			len5 = 0;
			throw takeFromExternrefTable0(ret[2]);
		}
		deferred6_0 = ptr5;
		deferred6_1 = len5;
		return getStringFromWasm0(ptr5, len5);
	} finally {
		wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
	}
}
/**
* @param {Uint8Array} binary
* @returns {string}
*/
function deserialize_container(binary) {
	let deferred3_0;
	let deferred3_1;
	try {
		const ptr0 = passArray8ToWasm0(binary, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.deserialize_container(ptr0, len0);
		var ptr2 = ret[0];
		var len2 = ret[1];
		if (ret[3]) {
			ptr2 = 0;
			len2 = 0;
			throw takeFromExternrefTable0(ret[2]);
		}
		deferred3_0 = ptr2;
		deferred3_1 = len2;
		return getStringFromWasm0(ptr2, len2);
	} finally {
		wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
	}
}
/**
* @param {Uint8Array} bytes
* @returns {string}
*/
function encode_hex(bytes) {
	let deferred2_0;
	let deferred2_1;
	try {
		const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.encode_hex(ptr0, len0);
		deferred2_0 = ret[0];
		deferred2_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
	}
}
/**
* @param {Uint8Array} data
* @param {string} password
* @returns {any}
*/
function encrypt_bytes_with_password(data, password) {
	const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(password, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	const ret = wasm.encrypt_bytes_with_password(ptr0, len0, ptr1, len1);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
/**
* @param {string} geojson_str
* @param {Uint8Array} dek
* @returns {any}
*/
function encrypt_geojson(geojson_str, dek) {
	const ptr0 = passStringToWasm0(geojson_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
	const len1 = WASM_VECTOR_LEN;
	const ret = wasm.encrypt_geojson(ptr0, len0, ptr1, len1);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
/**
* @param {string} title
* @param {string} note
* @param {number} lat
* @param {number} lng
* @param {string} color
* @param {Uint8Array} dek
* @returns {any}
*/
function encrypt_pin_data(title, note, lat, lng, color, dek) {
	const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(note, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	const ptr2 = passStringToWasm0(color, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len2 = WASM_VECTOR_LEN;
	const ptr3 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
	const len3 = WASM_VECTOR_LEN;
	const ret = wasm.encrypt_pin_data(ptr0, len0, ptr1, len1, lat, lng, ptr2, len2, ptr3, len3);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
/**
* @param {Uint8Array} plain
* @param {Uint8Array} dek
* @returns {any}
*/
function encrypt_raw_bytes(plain, dek) {
	const ptr0 = passArray8ToWasm0(plain, wasm.__wbindgen_malloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
	const len1 = WASM_VECTOR_LEN;
	const ret = wasm.encrypt_raw_bytes(ptr0, len0, ptr1, len1);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
/**
* @param {string} plain
* @param {string} password
* @returns {any}
*/
function encrypt_with_password(plain, password) {
	const ptr0 = passStringToWasm0(plain, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(password, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	const ret = wasm.encrypt_with_password(ptr0, len0, ptr1, len1);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return takeFromExternrefTable0(ret[0]);
}
/**
* @returns {Uint8Array}
*/
function generate_dek() {
	const ret = wasm.generate_dek();
	var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v1;
}
/**
* @param {string} data
* @returns {string}
*/
function generate_qr_svg(data) {
	let deferred2_0;
	let deferred2_1;
	try {
		const ptr0 = passStringToWasm0(data, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ret = wasm.generate_qr_svg(ptr0, len0);
		deferred2_0 = ret[0];
		deferred2_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
	}
}
/**
* @returns {any}
*/
function generate_signing_keypair() {
	return wasm.generate_signing_keypair();
}
/**
* @returns {any}
*/
function generate_user_keypair() {
	return wasm.generate_user_keypair();
}
/**
* @param {string} password
* @param {string} community_id
* @returns {any}
*/
function generate_user_keypair_from_password(password, community_id) {
	const ptr0 = passStringToWasm0(password, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(community_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	return wasm.generate_user_keypair_from_password(ptr0, len0, ptr1, len1);
}
/**
* @returns {string}
*/
function generate_uuid() {
	let deferred1_0;
	let deferred1_1;
	try {
		const ret = wasm.generate_uuid();
		deferred1_0 = ret[0];
		deferred1_1 = ret[1];
		return getStringFromWasm0(ret[0], ret[1]);
	} finally {
		wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
	}
}
/**
* @param {string} json
* @returns {Uint8Array}
*/
function serialize_container(json) {
	const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ret = wasm.serialize_container(ptr0, len0);
	if (ret[3]) throw takeFromExternrefTable0(ret[2]);
	var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v2;
}
/**
* @param {string} payload_hex
* @param {string} secret_key_hex
* @returns {string}
*/
function sign(payload_hex, secret_key_hex) {
	let deferred4_0;
	let deferred4_1;
	try {
		const ptr0 = passStringToWasm0(payload_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(secret_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.sign(ptr0, len0, ptr1, len1);
		var ptr3 = ret[0];
		var len3 = ret[1];
		if (ret[3]) {
			ptr3 = 0;
			len3 = 0;
			throw takeFromExternrefTable0(ret[2]);
		}
		deferred4_0 = ptr3;
		deferred4_1 = len3;
		return getStringFromWasm0(ptr3, len3);
	} finally {
		wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
	}
}
/**
* @param {string} wrapped_hex
* @param {string} secret_key_hex
* @returns {Uint8Array}
*/
function unwrap_dek(wrapped_hex, secret_key_hex) {
	const ptr0 = passStringToWasm0(wrapped_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(secret_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	const ret = wasm.unwrap_dek(ptr0, len0, ptr1, len1);
	if (ret[3]) throw takeFromExternrefTable0(ret[2]);
	var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
	wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
	return v3;
}
/**
* @param {string} payload_hex
* @param {string} signature_hex
* @param {string} public_key_hex
* @returns {boolean}
*/
function verify(payload_hex, signature_hex, public_key_hex) {
	const ptr0 = passStringToWasm0(payload_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len0 = WASM_VECTOR_LEN;
	const ptr1 = passStringToWasm0(signature_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len1 = WASM_VECTOR_LEN;
	const ptr2 = passStringToWasm0(public_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
	const len2 = WASM_VECTOR_LEN;
	const ret = wasm.verify(ptr0, len0, ptr1, len1, ptr2, len2);
	if (ret[2]) throw takeFromExternrefTable0(ret[1]);
	return ret[0] !== 0;
}
/**
* @param {Uint8Array} dek
* @param {string} public_key_hex
* @returns {string}
*/
function wrap_dek(dek, public_key_hex) {
	let deferred4_0;
	let deferred4_1;
	try {
		const ptr0 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
		const len0 = WASM_VECTOR_LEN;
		const ptr1 = passStringToWasm0(public_key_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
		const len1 = WASM_VECTOR_LEN;
		const ret = wasm.wrap_dek(ptr0, len0, ptr1, len1);
		var ptr3 = ret[0];
		var len3 = ret[1];
		if (ret[3]) {
			ptr3 = 0;
			len3 = 0;
			throw takeFromExternrefTable0(ret[2]);
		}
		deferred4_0 = ptr3;
		deferred4_1 = len3;
		return getStringFromWasm0(ptr3, len3);
	} finally {
		wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
	}
}
function __wbg_get_imports() {
	return {
		__proto__: null,
		"./e2e_core_bg.js": {
			__proto__: null,
			__wbg_Error_3639a60ed15f87e7: function(arg0, arg1) {
				return Error(getStringFromWasm0(arg0, arg1));
			},
			__wbg_String_8564e559799eccda: function(arg0, arg1) {
				const ptr1 = passStringToWasm0(String(arg1), wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg___wbindgen_bigint_get_as_i64_3af6d4ca77193a4b: function(arg0, arg1) {
				const v = arg1;
				const ret = typeof v === "bigint" ? v : void 0;
				getDataViewMemory0().setBigInt64(arg0 + 8, isLikeNone(ret) ? BigInt(0) : ret, true);
				getDataViewMemory0().setInt32(arg0 + 0, !isLikeNone(ret), true);
			},
			__wbg___wbindgen_boolean_get_c3dd5c39f1b5a12b: function(arg0) {
				const v = arg0;
				const ret = typeof v === "boolean" ? v : void 0;
				return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;
			},
			__wbg___wbindgen_debug_string_07cb72cfcc952e2b: function(arg0, arg1) {
				const ptr1 = passStringToWasm0(debugString(arg1), wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				const len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg___wbindgen_in_2617fa76397620d3: function(arg0, arg1) {
				return arg0 in arg1;
			},
			__wbg___wbindgen_is_bigint_d6a8167cac401b95: function(arg0) {
				return typeof arg0 === "bigint";
			},
			__wbg___wbindgen_is_function_2f0fd7ceb86e64c5: function(arg0) {
				return typeof arg0 === "function";
			},
			__wbg___wbindgen_is_object_5b22ff2418063a9c: function(arg0) {
				const val = arg0;
				return typeof val === "object" && val !== null;
			},
			__wbg___wbindgen_is_string_eddc07a3efad52e6: function(arg0) {
				return typeof arg0 === "string";
			},
			__wbg___wbindgen_is_undefined_244a92c34d3b6ec0: function(arg0) {
				return arg0 === void 0;
			},
			__wbg___wbindgen_jsval_eq_403eaa3610500a25: function(arg0, arg1) {
				return arg0 === arg1;
			},
			__wbg___wbindgen_jsval_loose_eq_1978f1e77b4bce62: function(arg0, arg1) {
				return arg0 == arg1;
			},
			__wbg___wbindgen_number_get_dd6d69a6079f26f1: function(arg0, arg1) {
				const obj = arg1;
				const ret = typeof obj === "number" ? obj : void 0;
				getDataViewMemory0().setFloat64(arg0 + 8, isLikeNone(ret) ? 0 : ret, true);
				getDataViewMemory0().setInt32(arg0 + 0, !isLikeNone(ret), true);
			},
			__wbg___wbindgen_string_get_965592073e5d848c: function(arg0, arg1) {
				const obj = arg1;
				const ret = typeof obj === "string" ? obj : void 0;
				var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
				var len1 = WASM_VECTOR_LEN;
				getDataViewMemory0().setInt32(arg0 + 4, len1, true);
				getDataViewMemory0().setInt32(arg0 + 0, ptr1, true);
			},
			__wbg___wbindgen_throw_9c75d47bf9e7731e: function(arg0, arg1) {
				throw new Error(getStringFromWasm0(arg0, arg1));
			},
			__wbg_call_a41d6421b30a32c5: function() {
				return handleError(function(arg0, arg1, arg2) {
					return arg0.call(arg1, arg2);
				}, arguments);
			},
			__wbg_call_add9e5a76382e668: function() {
				return handleError(function(arg0, arg1) {
					return arg0.call(arg1);
				}, arguments);
			},
			__wbg_crypto_38df2bab126b63dc: function(arg0) {
				return arg0.crypto;
			},
			__wbg_done_b1afd6201ac045e0: function(arg0) {
				return arg0.done;
			},
			__wbg_entries_bb9843ba73dc70d6: function(arg0) {
				return Object.entries(arg0);
			},
			__wbg_getRandomValues_c44a50d8cfdaebeb: function() {
				return handleError(function(arg0, arg1) {
					arg0.getRandomValues(arg1);
				}, arguments);
			},
			__wbg_getRandomValues_ef12552bf5acd2fe: function() {
				return handleError(function(arg0, arg1) {
					globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
				}, arguments);
			},
			__wbg_get_652f640b3b0b6e3e: function(arg0, arg1) {
				return arg0[arg1 >>> 0];
			},
			__wbg_get_9cfea9b7bbf12a15: function() {
				return handleError(function(arg0, arg1) {
					return Reflect.get(arg0, arg1);
				}, arguments);
			},
			__wbg_get_unchecked_be562b1421656321: function(arg0, arg1) {
				return arg0[arg1 >>> 0];
			},
			__wbg_instanceof_ArrayBuffer_eab9f28fbec23477: function(arg0) {
				let result;
				try {
					result = arg0 instanceof ArrayBuffer;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_Map_10d4edf60fcf9327: function(arg0) {
				let result;
				try {
					result = arg0 instanceof Map;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_instanceof_Uint8Array_57d77acd50e4c44d: function(arg0) {
				let result;
				try {
					result = arg0 instanceof Uint8Array;
				} catch (_) {
					result = false;
				}
				return result;
			},
			__wbg_isArray_c6c6ef8308995bcf: function(arg0) {
				return Array.isArray(arg0);
			},
			__wbg_isSafeInteger_3c56c421a5b4cce4: function(arg0) {
				return Number.isSafeInteger(arg0);
			},
			__wbg_iterator_9d68985a1d096fc2: function() {
				return Symbol.iterator;
			},
			__wbg_length_0a6ce016dc1460b0: function(arg0) {
				return arg0.length;
			},
			__wbg_length_ba3c032602efe310: function(arg0) {
				return arg0.length;
			},
			__wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
				return arg0.msCrypto;
			},
			__wbg_new_2fad8ca02fd00684: function() {
				return /* @__PURE__ */ new Object();
			},
			__wbg_new_3baa8d9866155c79: function() {
				return new Array();
			},
			__wbg_new_46ae4e4ff2a07a64: function() {
				return /* @__PURE__ */ new Map();
			},
			__wbg_new_8454eee672b2ba6e: function(arg0) {
				return new Uint8Array(arg0);
			},
			__wbg_new_with_length_9011f5da794bf5d9: function(arg0) {
				return new Uint8Array(arg0 >>> 0);
			},
			__wbg_next_261c3c48c6e309a5: function(arg0) {
				return arg0.next;
			},
			__wbg_next_aacee310bcfe6461: function() {
				return handleError(function(arg0) {
					return arg0.next();
				}, arguments);
			},
			__wbg_node_84ea875411254db1: function(arg0) {
				return arg0.node;
			},
			__wbg_now_4f457f10f864aec5: function() {
				return Date.now();
			},
			__wbg_process_44c7a14e11e9f69e: function(arg0) {
				return arg0.process;
			},
			__wbg_prototypesetcall_fd4050e806e1d519: function(arg0, arg1, arg2) {
				Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
			},
			__wbg_push_60a5366c0bb22a7d: function(arg0, arg1) {
				return arg0.push(arg1);
			},
			__wbg_randomFillSync_6c25eac9869eb53c: function() {
				return handleError(function(arg0, arg1) {
					arg0.randomFillSync(arg1);
				}, arguments);
			},
			__wbg_require_b4edbdcf3e2a1ef0: function() {
				return handleError(function() {
					return module.require;
				}, arguments);
			},
			__wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
				arg0[arg1] = arg2;
			},
			__wbg_set_82f7a370f604db70: function(arg0, arg1, arg2) {
				return arg0.set(arg1, arg2);
			},
			__wbg_set_f614f6a0608d1d1d: function(arg0, arg1, arg2) {
				arg0[arg1 >>> 0] = arg2;
			},
			__wbg_static_accessor_GLOBAL_THIS_1c7f1bd6c6941fdb: function() {
				const ret = typeof globalThis === "undefined" ? null : globalThis;
				return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
			},
			__wbg_static_accessor_GLOBAL_e039bc914f83e74e: function() {
				const ret = typeof global === "undefined" ? null : global;
				return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
			},
			__wbg_static_accessor_SELF_8bf8c48c28420ad5: function() {
				const ret = typeof self === "undefined" ? null : self;
				return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
			},
			__wbg_static_accessor_WINDOW_6aeee9b51652ee0f: function() {
				const ret = typeof window === "undefined" ? null : window;
				return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
			},
			__wbg_subarray_fbe3cef290e1fa43: function(arg0, arg1, arg2) {
				return arg0.subarray(arg1 >>> 0, arg2 >>> 0);
			},
			__wbg_value_f852716acdeb3e82: function(arg0) {
				return arg0.value;
			},
			__wbg_versions_276b2795b1c6a219: function(arg0) {
				return arg0.versions;
			},
			__wbindgen_cast_0000000000000001: function(arg0) {
				return arg0;
			},
			__wbindgen_cast_0000000000000002: function(arg0) {
				return arg0;
			},
			__wbindgen_cast_0000000000000003: function(arg0, arg1) {
				return getArrayU8FromWasm0(arg0, arg1);
			},
			__wbindgen_cast_0000000000000004: function(arg0, arg1) {
				return getStringFromWasm0(arg0, arg1);
			},
			__wbindgen_cast_0000000000000005: function(arg0) {
				return BigInt.asUintN(64, arg0);
			},
			__wbindgen_init_externref_table: function() {
				const table = wasm.__wbindgen_externrefs;
				const offset = table.grow(4);
				table.set(0, void 0);
				table.set(offset + 0, void 0);
				table.set(offset + 1, null);
				table.set(offset + 2, true);
				table.set(offset + 3, false);
			}
		}
	};
}
var ChunkStoreFinalization = typeof FinalizationRegistry === "undefined" ? {
	register: () => {},
	unregister: () => {}
} : new FinalizationRegistry((ptr) => wasm.__wbg_chunkstore_free(ptr, 1));
var StoreFinalization = typeof FinalizationRegistry === "undefined" ? {
	register: () => {},
	unregister: () => {}
} : new FinalizationRegistry((ptr) => wasm.__wbg_store_free(ptr, 1));
function addToExternrefTable0(obj) {
	const idx = wasm.__externref_table_alloc();
	wasm.__wbindgen_externrefs.set(idx, obj);
	return idx;
}
function debugString(val) {
	const type = typeof val;
	if (type == "number" || type == "boolean" || val == null) return `${val}`;
	if (type == "string") return `"${val}"`;
	if (type == "symbol") {
		const description = val.description;
		if (description == null) return "Symbol";
		else return `Symbol(${description})`;
	}
	if (type == "function") {
		const name = val.name;
		if (typeof name == "string" && name.length > 0) return `Function(${name})`;
		else return "Function";
	}
	if (Array.isArray(val)) {
		const length = val.length;
		let debug = "[";
		if (length > 0) debug += debugString(val[0]);
		for (let i = 1; i < length; i++) debug += ", " + debugString(val[i]);
		debug += "]";
		return debug;
	}
	const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
	let className;
	if (builtInMatches && builtInMatches.length > 1) className = builtInMatches[1];
	else return toString.call(val);
	if (className == "Object") try {
		return "Object(" + JSON.stringify(val) + ")";
	} catch (_) {
		return "Object";
	}
	if (val instanceof Error) return `${val.name}: ${val.message}\n${val.stack}`;
	return className;
}
function getArrayJsValueFromWasm0(ptr, len) {
	ptr = ptr >>> 0;
	const mem = getDataViewMemory0();
	const result = [];
	for (let i = ptr; i < ptr + 4 * len; i += 4) result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
	wasm.__externref_drop_slice(ptr, len);
	return result;
}
function getArrayU8FromWasm0(ptr, len) {
	ptr = ptr >>> 0;
	return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
var cachedDataViewMemory0 = null;
function getDataViewMemory0() {
	if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
	return cachedDataViewMemory0;
}
function getStringFromWasm0(ptr, len) {
	return decodeText(ptr >>> 0, len);
}
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
	if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
	return cachedUint8ArrayMemory0;
}
function handleError(f, args) {
	try {
		return f.apply(this, args);
	} catch (e) {
		const idx = addToExternrefTable0(e);
		wasm.__wbindgen_exn_store(idx);
	}
}
function isLikeNone(x) {
	return x === void 0 || x === null;
}
function passArray8ToWasm0(arg, malloc) {
	const ptr = malloc(arg.length * 1, 1) >>> 0;
	getUint8ArrayMemory0().set(arg, ptr / 1);
	WASM_VECTOR_LEN = arg.length;
	return ptr;
}
function passStringToWasm0(arg, malloc, realloc) {
	if (realloc === void 0) {
		const buf = cachedTextEncoder.encode(arg);
		const ptr = malloc(buf.length, 1) >>> 0;
		getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
		WASM_VECTOR_LEN = buf.length;
		return ptr;
	}
	let len = arg.length;
	let ptr = malloc(len, 1) >>> 0;
	const mem = getUint8ArrayMemory0();
	let offset = 0;
	for (; offset < len; offset++) {
		const code = arg.charCodeAt(offset);
		if (code > 127) break;
		mem[ptr + offset] = code;
	}
	if (offset !== len) {
		if (offset !== 0) arg = arg.slice(offset);
		ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
		const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
		const ret = cachedTextEncoder.encodeInto(arg, view);
		offset += ret.written;
		ptr = realloc(ptr, len, offset, 1) >>> 0;
	}
	WASM_VECTOR_LEN = offset;
	return ptr;
}
function takeFromExternrefTable0(idx) {
	const value = wasm.__wbindgen_externrefs.get(idx);
	wasm.__externref_table_dealloc(idx);
	return value;
}
var cachedTextDecoder = new TextDecoder("utf-8", {
	ignoreBOM: true,
	fatal: true
});
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
	numBytesDecoded += len;
	if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
		cachedTextDecoder = new TextDecoder("utf-8", {
			ignoreBOM: true,
			fatal: true
		});
		cachedTextDecoder.decode();
		numBytesDecoded = len;
	}
	return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
var cachedTextEncoder = new TextEncoder();
if (!("encodeInto" in cachedTextEncoder)) cachedTextEncoder.encodeInto = function(arg, view) {
	const buf = cachedTextEncoder.encode(arg);
	view.set(buf);
	return {
		read: arg.length,
		written: buf.length
	};
};
var WASM_VECTOR_LEN = 0, wasm;
function __wbg_finalize_init(instance, module) {
	wasm = instance.exports;
	cachedDataViewMemory0 = null;
	cachedUint8ArrayMemory0 = null;
	wasm.__wbindgen_start();
	return wasm;
}
async function __wbg_load(module, imports) {
	if (typeof Response === "function" && module instanceof Response) {
		if (typeof WebAssembly.instantiateStreaming === "function") try {
			return await WebAssembly.instantiateStreaming(module, imports);
		} catch (e) {
			if (module.ok && expectedResponseType(module.type) && module.headers.get("Content-Type") !== "application/wasm") console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
			else throw e;
		}
		const bytes = await module.arrayBuffer();
		return await WebAssembly.instantiate(bytes, imports);
	} else {
		const instance = await WebAssembly.instantiate(module, imports);
		if (instance instanceof WebAssembly.Instance) return {
			instance,
			module
		};
		else return instance;
	}
	function expectedResponseType(type) {
		switch (type) {
			case "basic":
			case "cors":
			case "default": return true;
		}
		return false;
	}
}
async function __wbg_init(module_or_path) {
	if (wasm !== void 0) return wasm;
	if (module_or_path !== void 0) if (Object.getPrototypeOf(module_or_path) === Object.prototype) ({module_or_path} = module_or_path);
	else console.warn("using deprecated parameters for the initialization function; pass a single object instead");
	if (module_or_path === void 0) module_or_path = new URL("e2e_core_bg.wasm", import.meta.url);
	const imports = __wbg_get_imports();
	if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) module_or_path = fetch(module_or_path);
	const { instance, module } = await __wbg_load(await module_or_path, imports);
	return __wbg_finalize_init(instance, module);
}
//#endregion
export { generate_user_keypair as A, encrypt_geojson as C, generate_dek as D, encrypt_with_password as E, unwrap_dek as F, verify as I, wrap_dek as L, generate_uuid as M, serialize_container as N, generate_qr_svg as O, sign as P, encrypt_bytes_with_password as S, encrypt_raw_bytes as T, decrypt_pin_data as _, base64_encode as a, deserialize_container as b, compact_and_pack_json as c, compress_gzip_max as d, compress_gzip_to_base64 as f, decrypt_geojson as g, decrypt_bytes_with_password as h, base64_decode as i, generate_user_keypair_from_password as j, generate_signing_keypair as k, compact_pack_gzip_json as l, decompress_gzip as m, Store as n, base64url_decode as o, decode_hex as p, __wbg_init as r, base64url_encode as s, ChunkStore as t, compress_gzip as u, decrypt_raw_bytes as v, encrypt_pin_data as w, encode_hex as x, decrypt_with_password as y };
