/* tslint:disable */
/* eslint-disable */

export class ChunkStore {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a chunk at the given index. Returns true when all chunks received.
     */
    add_chunk(key: string, index: number, total: number, data: string): boolean;
    /**
     * Assemble all chunks in order, joined as a single string.
     * Returns None if not complete.
     */
    assemble(key: string): string | undefined;
    clear(): void;
    evict_expired(): number;
    constructor(max_entries: number, ttl_ms: number);
    remove(key: string): boolean;
}

export class Store {
    free(): void;
    [Symbol.dispose](): void;
    clear(): void;
    delete(key: string): boolean;
    entries(): any[];
    evict_expired(): number;
    get(key: string): any;
    has(key: string): boolean;
    keys(): any[];
    constructor(max_entries: number, default_ttl_ms: number);
    set(key: string, value: any): void;
    set_ttl(key: string, ttl_ms: number): void;
    size(): number;
    values(): any[];
}

export function base64_decode(b64: string): Uint8Array;

export function base64_encode(data: Uint8Array): string;

export function base64url_decode(b64url: string): Uint8Array;

export function base64url_encode(data: Uint8Array): string;

/**
 * strip_empty + hex→base64 for hex-keyed fields + serialize back to JSON.
 * Replaces: JSON.stringify(packHexFields(stripEmpties(data)))
 */
export function compact_and_pack_json(json: string): string;

/**
 * Same as compact_and_pack_json + compress_gzip_max. Returns compressed bytes.
 * Replaces: compress_gzip_max(new TextEncoder().encode(JSON.stringify(packHexFields(stripEmpties(data)))))
 */
export function compact_pack_gzip_json(json: string): Uint8Array;

export function compress_gzip(data: Uint8Array): Uint8Array;

export function compress_gzip_max(data: Uint8Array): Uint8Array;

export function compress_gzip_to_base64(data: Uint8Array): string;

export function compute_geometry(geojson_json: string): string;

export function decode_hex(hex: string): Uint8Array;

export function decompress_gzip(data: Uint8Array): Uint8Array;

export function decrypt_annotation(ciphertext_hex: string, nonce_hex: string, dek: Uint8Array): any;

export function decrypt_bytes_with_password(ciphertext_hex: string, nonce_hex: string, salt_hex: string, password: string): Uint8Array;

export function decrypt_geojson(ciphertext_hex: string, nonce_hex: string, dek: Uint8Array): string;

export function decrypt_pin_data(ciphertext_hex: string, nonce_hex: string, dek: Uint8Array): any;

export function decrypt_raw_bytes(ciphertext_hex: string, nonce_hex: string, dek: Uint8Array): Uint8Array;

export function decrypt_with_password(ciphertext_hex: string, nonce_hex: string, salt_hex: string, password: string): string;

export function deserialize_container(binary: Uint8Array): string;

export function detect_freehand_shape(points_json: string): string;

export function encode_hex(bytes: Uint8Array): string;

export function encrypt_annotation(text: string, author_name: string, annotation_type: string, ttl: bigint | null | undefined, dek: Uint8Array): any;

export function encrypt_bytes_with_password(data: Uint8Array, password: string): any;

export function encrypt_geojson(geojson_str: string, dek: Uint8Array): any;

export function encrypt_pin_data(title: string, note: string, lat: number, lng: number, color: string, dek: Uint8Array): any;

export function encrypt_raw_bytes(plain: Uint8Array, dek: Uint8Array): any;

export function encrypt_with_password(plain: string, password: string): any;

export function generate_dek(): Uint8Array;

export function generate_qr_svg(data: string): string;

export function generate_signing_keypair(): any;

export function generate_user_keypair(): any;

export function generate_user_keypair_from_password(password: string, community_id: string): any;

export function generate_uuid(): string;

export function hw_model_name(model: number): string;

export function mesh_chunk_encode(data: Uint8Array): string;

/**
 * Get the 32-character hex address for an identity.
 */
export function reticulum_address(identity_hex: string): string;

/**
 * Generate a new Reticulum Identity from random key material.
 * Returns hex-encoded identity string.
 */
export function reticulum_generate_identity(): string;

/**
 * Hash arbitrary data, producing a hex-encoded SHA-256 hash.
 */
export function reticulum_hash_data(data: Uint8Array): string;

export function serialize_container(json: string): Uint8Array;

export function sign(payload_hex: string, secret_key_hex: string): string;

/**
 * Takes a JSON array of [lng, lat] pairs and returns simplified [lng, lat] pairs.
 */
export function simplify_freehand(path_json: string, tolerance: number): string;

export function unwrap_dek(wrapped_hex: string, secret_key_hex: string): Uint8Array;

export function verify(payload_hex: string, signature_hex: string, public_key_hex: string): boolean;

export function wrap_dek(dek: Uint8Array, public_key_hex: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly base64_decode: (a: number, b: number) => [number, number];
    readonly base64_encode: (a: number, b: number) => [number, number];
    readonly base64url_decode: (a: number, b: number) => [number, number, number, number];
    readonly base64url_encode: (a: number, b: number) => [number, number];
    readonly compact_and_pack_json: (a: number, b: number) => [number, number, number, number];
    readonly compact_pack_gzip_json: (a: number, b: number) => [number, number, number, number];
    readonly compress_gzip: (a: number, b: number) => [number, number];
    readonly compress_gzip_max: (a: number, b: number) => [number, number];
    readonly compress_gzip_to_base64: (a: number, b: number) => [number, number];
    readonly compute_geometry: (a: number, b: number) => [number, number];
    readonly decode_hex: (a: number, b: number) => [number, number];
    readonly decompress_gzip: (a: number, b: number) => [number, number, number, number];
    readonly decrypt_annotation: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly decrypt_bytes_with_password: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly decrypt_geojson: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly decrypt_pin_data: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly decrypt_raw_bytes: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly decrypt_with_password: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly deserialize_container: (a: number, b: number) => [number, number, number, number];
    readonly detect_freehand_shape: (a: number, b: number) => [number, number];
    readonly encode_hex: (a: number, b: number) => [number, number];
    readonly encrypt_annotation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: bigint, i: number, j: number) => [number, number, number];
    readonly encrypt_bytes_with_password: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly encrypt_geojson: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly encrypt_pin_data: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly encrypt_raw_bytes: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly encrypt_with_password: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly generate_dek: () => [number, number];
    readonly generate_qr_svg: (a: number, b: number) => [number, number];
    readonly generate_signing_keypair: () => any;
    readonly generate_user_keypair: () => any;
    readonly generate_user_keypair_from_password: (a: number, b: number, c: number, d: number) => any;
    readonly generate_uuid: () => [number, number];
    readonly hw_model_name: (a: number) => [number, number];
    readonly mesh_chunk_encode: (a: number, b: number) => [number, number];
    readonly serialize_container: (a: number, b: number) => [number, number, number, number];
    readonly sign: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly simplify_freehand: (a: number, b: number, c: number) => [number, number];
    readonly unwrap_dek: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly verify: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly wrap_dek: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly __wbg_chunkstore_free: (a: number, b: number) => void;
    readonly __wbg_store_free: (a: number, b: number) => void;
    readonly chunkstore_add_chunk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly chunkstore_assemble: (a: number, b: number, c: number) => [number, number];
    readonly chunkstore_clear: (a: number) => void;
    readonly chunkstore_evict_expired: (a: number) => number;
    readonly chunkstore_new: (a: number, b: number) => number;
    readonly chunkstore_remove: (a: number, b: number, c: number) => number;
    readonly reticulum_address: (a: number, b: number) => [number, number];
    readonly reticulum_generate_identity: () => [number, number];
    readonly reticulum_hash_data: (a: number, b: number) => [number, number];
    readonly store_clear: (a: number) => void;
    readonly store_delete: (a: number, b: number, c: number) => number;
    readonly store_entries: (a: number) => [number, number];
    readonly store_evict_expired: (a: number) => number;
    readonly store_get: (a: number, b: number, c: number) => any;
    readonly store_has: (a: number, b: number, c: number) => number;
    readonly store_keys: (a: number) => [number, number];
    readonly store_set: (a: number, b: number, c: number, d: any) => void;
    readonly store_set_ttl: (a: number, b: number, c: number, d: number) => void;
    readonly store_size: (a: number) => number;
    readonly store_values: (a: number) => [number, number];
    readonly store_new: (a: number, b: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
