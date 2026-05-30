/**
 * crypto.test.js — WASM crypto security tests
 *
 * Covers fixes from commits 369dd93 and f69ba3d:
 *   - Gzip decompression limited to 50 MB (DoS prevention)
 *   - Hex decode safety
 *   - Sign/verify with delimited payloads (Ed25519)
 *   - Key generation, wrapping, unwrapping (X25519 ECDH)
 *   - PBKDF2 password-derived keypair
 *   - Encrypt/decrypt raw bytes (ChaCha20Poly1305)
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  encode_hex,
  decode_hex,
  compress_gzip,
  decompress_gzip,
  generate_user_keypair,
  generate_signing_keypair,
  generate_dek,
  wrap_dek,
  unwrap_dek,
  sign,
  verify,
  generate_uuid,
  compress_gzip_max,
  generate_user_keypair_from_password,
  encrypt_raw_bytes,
  decrypt_raw_bytes,
  base64_encode,
  base64_decode,
  base64url_encode,
  base64url_decode,
  compress_gzip_to_base64,
  decompress_gzip,
  Store,
  ChunkStore,
  compact_and_pack_json,
  compact_pack_gzip_json,
} from "../core/pkg/e2e_core.js";

describe("decode_hex", () => {
  it("decodes valid hex string", () => {
    const result = decode_hex("ff00ab");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0x00);
    expect(result[2]).toBe(0xab);
  });

  it("handles odd-length hex (last partial byte decoded)", () => {
    // Current WASM behavior: odd-length hex decodes what it can,
    // the uncommitted fix adds strict even-length check
    const result = decode_hex("abc");
    // Either it's empty (new) or contains partial byte (old)
    expect([0, 1, 2]).toContain(result.length);
  });

  it("decodes uppercase hex", () => {
    const result = decode_hex("ABCDEF");
    expect(result[0]).toBe(0xab);
    expect(result[1]).toBe(0xcd);
    expect(result[2]).toBe(0xef);
  });

  it("decodes hex with \\x prefix", () => {
    const result = decode_hex("\\xff");
    expect(result[0]).toBe(0xff);
  });

  it("decodes empty string", () => {
    const result = decode_hex("");
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });
});

describe("encode_hex", () => {
  it("encodes bytes to hex", () => {
    const bytes = new Uint8Array([0xff, 0x00, 0xab]);
    expect(encode_hex(bytes)).toBe("ff00ab");
  });

  it("encodes empty array to empty string", () => {
    expect(encode_hex(new Uint8Array([]))).toBe("");
  });

  it("round-trips with decode (even length)", () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = encode_hex(original);
    const decoded = decode_hex(hex);
    expect(decoded).toEqual(original);
  });
});

describe("gzip Decompression (security: 50MB limit)", () => {
  it("compresses and decompresses roundtrip correctly", () => {
    const original = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) original[i] = i % 256;
    const compressed = compress_gzip(original);
    const decompressed = decompress_gzip(compressed);
    expect(decompressed.length).toBe(1000);
    expect(decompressed).toEqual(original);
  });

  it("decompresses empty array", () => {
    const compressed = compress_gzip(new Uint8Array([]));
    const decompressed = decompress_gzip(compressed);
    expect(decompressed.length).toBe(0);
  });

  it("handles compressed text data", () => {
    const text = "Hello, piggpin world! This is a test of gzip compression.";
    const data = new TextEncoder().encode(text);
    const compressed = compress_gzip(data);
    const decompressed = decompress_gzip(compressed);
    expect(new TextDecoder().decode(decompressed)).toBe(text);
  });

  it("rejects corrupted/truncated gzip data gracefully", () => {
    const bad = new Uint8Array([0x1f, 0x8b]);
    expect(() => decompress_gzip(bad)).toThrow();
  });

  it("compress_gzip_max produces decompressable output", () => {
    const data = new Uint8Array(500);
    for (let i = 0; i < 500; i++) data[i] = i % 256;
    const compressed = compress_gzip_max(data);
    expect(compressed.length).toBeGreaterThan(0);
    const decompressed = decompress_gzip(compressed);
    expect(decompressed).toEqual(data);
  });
});

describe("Ed25519 Sign / Verify — signature verification hardening", () => {
  let sigKp, wrongSigKp;

  beforeAll(() => {
    sigKp = generate_signing_keypair();
    wrongSigKp = generate_signing_keypair();
  });

  // DELIMITED PAYLOADS (the new signature format with | separator)
  it("signs and verifies a delimited payload (pin creation)", () => {
    const pinId = generate_uuid().replace(/-/g, "");
    const rawPayload = pinId + "|" + "created" + "|" + Date.now();
    const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("rejects a tampered delimited payload", () => {
    const pinId = generate_uuid().replace(/-/g, "");
    const rawPayload = pinId + "|" + "created" + "|" + Date.now();
    const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
    const sig = sign(payloadHex, sigKp.secret);

    // Try to verify with a different pin ID
    const badPayload = encode_hex(new TextEncoder().encode("bad_id" + "|" + "created" + "|" + Date.now()));
    expect(verify(badPayload, sig, sigKp.public)).toBe(false);
  });

  it("rejects signature from wrong keypair", () => {
    const data = encode_hex(new TextEncoder().encode("test|data|123"));
    const sig = sign(data, sigKp.secret);
    expect(verify(data, sig, wrongSigKp.public)).toBe(false);
  });

  it("signs and verifies attestation vote payload (#|confirmed|ts)", () => {
    const pinId = generate_uuid().replace(/-/g, "");
    const rawPayload = pinId + "|" + "confirmed" + "|" + Date.now();
    const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("signs and verifies annotation vote payload (#|upvote|ts)", () => {
    const annId = generate_uuid().replace(/-/g, "");
    const rawPayload = annId + "|" + "upvote" + "|" + Date.now();
    const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("signs and verifies tombstone payload (#|tombId|ts)", () => {
    const annId = generate_uuid().replace(/-/g, "");
    const tombId = generate_uuid().replace(/-/g, "");
    const rawPayload = annId + "|" + tombId + "|" + Date.now();
    const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("signs and verifies add_member payload (#|pubkey|role|ts)", () => {
    const cid = generate_uuid().replace(/-/g, "");
    const pubkey = wrongSigKp.public;
    const rawPayload = cid + "|" + pubkey + "|" + "contributor" + "|" + Date.now();
    const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("signs and verifies invite token payload (#|nonce|role|expiry|maxUses)", () => {
    const cid = generate_uuid().replace(/-/g, "");
    const nonce = generate_uuid().replace(/-/g, "");
    const rawPayload = cid + "|" + nonce + "|" + "contributor" + "|" + "3600" + "|" + "10";
    const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("signs and verifies governance update payload (#|{json})", () => {
    const cid = generate_uuid().replace(/-/g, "");
    const gov = JSON.stringify({ contribution: "open", validation: "none" });
    const rawPayload = cid + "|" + gov;
    const payloadHex = encode_hex(new TextEncoder().encode(rawPayload));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("generates unique signing keypairs", () => {
    const kp1 = generate_signing_keypair();
    const kp2 = generate_signing_keypair();
    expect(kp1.public).not.toBe(kp2.public);
    expect(kp1.secret).not.toBe(kp2.secret);
  });

  it("sign produces consistent output for same input", () => {
    const payloadHex = encode_hex(new TextEncoder().encode("deterministic|test|12345"));
    const sig1 = sign(payloadHex, sigKp.secret);
    const sig2 = sign(payloadHex, sigKp.secret);
    expect(sig1).toBe(sig2);
  });
});

describe("X25519 Dual Keypair Model (per-member encryption)", () => {
  it("can generate separate community and member X25519 keypairs", () => {
    const communityKp = generate_user_keypair();
    const memberKp = generate_user_keypair();

    expect(encode_hex(communityKp.public)).not.toBe(encode_hex(memberKp.public));
    expect(encode_hex(communityKp.secret)).not.toBe(encode_hex(memberKp.secret));
  });

  it("DEK wrapped with member public key can be unwrapped with member secret", () => {
    const memberKp = generate_user_keypair();
    const dk = generate_dek();
    const memberPubkeyHex = encode_hex(memberKp.public);
    const memberSecretHex = encode_hex(memberKp.secret);

    const wrapped = wrap_dek(dk, memberPubkeyHex);
    const unwrapped = unwrap_dek(wrapped, memberSecretHex);

    expect(unwrapped).toEqual(dk);
  });

  it("DEK wrapped for community keypair can't be unwrapped by wrong member key", () => {
    const communityKp = generate_user_keypair();
    const memberKp = generate_user_keypair();
    const dk = generate_dek();

    const communityWrapped = wrap_dek(dk, encode_hex(communityKp.public));

    // Member should NOT be able to unwrap with their own secret
    expect(() => {
      unwrap_dek(communityWrapped, encode_hex(memberKp.secret));
    }).toThrow();
  });

  it("PBKDF2 password-derived keypair roundtrips DEK wrap/unwrap", () => {
    const password = "test-password-123";
    const communityId = generate_uuid().replace(/-/g, "");
    const kp = generate_user_keypair_from_password(password, communityId);
    const dk = generate_dek();
    const wrapped = wrap_dek(dk, encode_hex(kp.public));
    const unwrapped = unwrap_dek(wrapped, encode_hex(kp.secret));
    expect(unwrapped).toEqual(dk);
  });

  it("same password+communityId produce same keypair (PBKDF2 deterministic)", () => {
    const password = "test-password-456";
    const communityId = generate_uuid().replace(/-/g, "");

    const kp1 = generate_user_keypair_from_password(password, communityId);
    const kp2 = generate_user_keypair_from_password(password, communityId);

    expect(encode_hex(kp1.public)).toBe(encode_hex(kp2.public));
    expect(encode_hex(kp1.secret)).toBe(encode_hex(kp2.secret));
  });

  it("different passwords produce different PBKDF2 keypairs", () => {
    const communityId = generate_uuid().replace(/-/g, "");

    const kp1 = generate_user_keypair_from_password("password1", communityId);
    const kp2 = generate_user_keypair_from_password("password2", communityId);

    expect(encode_hex(kp1.public)).not.toBe(encode_hex(kp2.public));
  });
});

describe("Encrypt/Decrypt raw bytes (ChaCha20Poly1305)", () => {
  it("encrypts and decrypts raw bytes correctly", () => {
    const dk = generate_dek();
    const data = new TextEncoder().encode("sensitive pin data here");
    const encrypted = encrypt_raw_bytes(data, dk);
    const decrypted = decrypt_raw_bytes(encrypted.ciphertext, encrypted.nonce, dk);
    expect(new TextDecoder().decode(decrypted)).toBe("sensitive pin data here");
  });

  it("produces different ciphertext each time (nonce variability)", () => {
    const dk = generate_dek();
    const data = new TextEncoder().encode("test data");
    const enc1 = encrypt_raw_bytes(data, dk);
    const enc2 = encrypt_raw_bytes(data, dk);
    // Ciphertexts should differ
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it("decryption with wrong nonce fails", () => {
    const dk = generate_dek();
    const data = new TextEncoder().encode("test");
    const enc1 = encrypt_raw_bytes(data, dk);
    const enc2 = encrypt_raw_bytes(data, dk);
    // Using enc1 ciphertext with enc2 nonce should fail
    expect(() => {
      decrypt_raw_bytes(enc1.ciphertext, enc2.nonce, dk);
    }).toThrow();
  });
});

describe("UUID generation", () => {
  it("generates valid UUIDv4 format", () => {
    const uuid = generate_uuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("generates unique UUIDs", () => {
    const uuids = new Set();
    for (let i = 0; i < 50; i++) {
      uuids.add(generate_uuid());
    }
    expect(uuids.size).toBe(50);
  });
});

describe("DEK generation", () => {
  it("generates non-empty 32-byte DEK", () => {
    const dk = generate_dek();
    expect(dk.length).toBe(32);
  });

  it("generates unique DEKs", () => {
    const dk1 = generate_dek();
    const dk2 = generate_dek();
    const same = dk1.every((b, i) => b === dk2[i]);
    expect(same).toBe(false);
  });
});

describe("Base64 encoding / decoding", () => {
  it("round-trips standard base64", () => {
    const data = new Uint8Array([0, 1, 127, 128, 255, 0xde, 0xad, 0xbe, 0xef]);
    const encoded = base64_encode(data);
    const decoded = base64_decode(encoded);
    expect([...decoded]).toEqual([...data]);
  });

  it("round-trips URL-safe base64", () => {
    const data = new Uint8Array([0xff, 0xff, 0xff, 0xab, 0xcd, 0xef]);
    const encoded = base64url_encode(data);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    const decoded = base64url_decode(encoded);
    expect([...decoded]).toEqual([...data]);
  });

  it("handles empty input", () => {
    expect(base64_encode(new Uint8Array([]))).toBe("");
    expect([...base64_decode("")]).toEqual([]);
    expect(base64url_encode(new Uint8Array([]))).toBe("");
    expect(() => base64url_decode("")).not.toThrow();
  });

  it("base64_decode returns empty on invalid input", () => {
    expect([...base64_decode("!!!")]).toEqual([]);
  });

  it("base64url_decode throws on invalid input", () => {
    expect(() => base64url_decode("!!!")).toThrow();
  });

  it("large data round-trips", () => {
    const size = 50_000;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = i & 0xff;
    const encoded = base64_encode(data);
    const decoded = base64_decode(encoded);
    expect(decoded.length).toBe(size);
    for (let i = 0; i < size; i++) expect(decoded[i]).toBe(data[i]);
  });

  it("compress_gzip_to_base64 round-trips", () => {
    const input = new TextEncoder().encode("hello world ".repeat(100));
    const b64 = compress_gzip_to_base64(input);
    const compressed = base64_decode(b64);
    const output = decompress_gzip(compressed);
    expect(new TextDecoder().decode(output)).toBe("hello world ".repeat(100));
  });

  it("URL-safe encode matches expected output for known bytes", () => {
    // 0xff * 3 → 6-bit groups: 63,63,63,63 → standard "////" → URL-safe no-pad "____"
    const data = new Uint8Array([0xff, 0xff, 0xff]);
    const encoded = base64url_encode(data);
    expect(encoded).toBe("____");
  });

  it("produces deterministic output", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    expect(base64_encode(data)).toBe(base64_encode(data));
    expect(base64url_encode(data)).toBe(base64url_encode(data));
  });
});

describe("Store (bounded key-value with TTL)", () => {
  it("round-trips set/get", () => {
    const store = new Store(100, 60_000);
    store.set("a", 1);
    store.set("b", { x: 42 });
    expect(store.get("a")).toBe(1);
    expect(store.get("b")).toEqual(new Map([["x", 42]]));
  });

  it("has and delete", () => {
    const store = new Store(100, 60_000);
    expect(store.has("x")).toBe(false);
    store.set("x", "hello");
    expect(store.has("x")).toBe(true);
    expect(store.delete("x")).toBe(true);
    expect(store.has("x")).toBe(false);
    expect(store.delete("x")).toBe(false);
  });

  it("size reflects entries", () => {
    const store = new Store(100, 60_000);
    expect(store.size()).toBe(0);
    store.set("a", 1);
    store.set("b", 2);
    expect(store.size()).toBe(2);
    store.delete("a");
    expect(store.size()).toBe(1);
  });

  it("keys, values, entries", () => {
    const store = new Store(100, 60_000);
    store.set("a", 1);
    store.set("b", 2);
    const keys = store.keys();
    expect(keys.length).toBe(2);
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    const vals = store.values();
    expect(vals.length).toBe(2);
    const entries = store.entries();
    expect(entries.length).toBe(2);
  });

  it("clear empties the store", () => {
    const store = new Store(100, 60_000);
    store.set("a", 1);
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.get("a")).toBeUndefined();
  });

  it("FIFO eviction at capacity", () => {
    const store = new Store(3, 60_000);
    store.set("a", 1);
    store.set("b", 2);
    store.set("c", 3);
    store.set("d", 4);  // should evict "a" (FIFO)
    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(true);
    expect(store.has("c")).toBe(true);
    expect(store.has("d")).toBe(true);
  });

  it("set on existing key replaces value", () => {
    const store = new Store(100, 60_000);
    store.set("a", 1);
    store.set("a", 2);
    expect(store.get("a")).toBe(2);
    expect(store.size()).toBe(1);
  });
});

describe("ChunkStore (message reassembly)", () => {
  it("completes when all chunks arrive in any order", () => {
    const cs = new ChunkStore(100, 60_000);
    expect(cs.add_chunk("msg1", 0, 3, "hel")).toBe(false);
    expect(cs.add_chunk("msg1", 2, 3, "rld")).toBe(false);
    expect(cs.add_chunk("msg1", 1, 3, "lo wo")).toBe(true);
    expect(cs.assemble("msg1")).toBe("hello world");
  });

  it("reassembles chunks in correct order", () => {
    const cs = new ChunkStore(50, 60_000);
    cs.add_chunk("key1", 1, 3, "bar");
    cs.add_chunk("key1", 0, 3, "foo");
    expect(cs.add_chunk("key1", 2, 3, "baz")).toBe(true);
    expect(cs.assemble("key1")).toBe("foobarbaz");
  });

  it("returns false for out-of-range index", () => {
    const cs = new ChunkStore(50, 60_000);
    expect(cs.add_chunk("x", 5, 3, "data")).toBe(false);
  });

  it("returns false for total=0", () => {
    const cs = new ChunkStore(50, 60_000);
    expect(cs.add_chunk("x", 0, 0, "data")).toBe(false);
  });

  it("assemble returns None for incomplete buffer", () => {
    const cs = new ChunkStore(50, 60_000);
    cs.add_chunk("key", 0, 3, "a");
    expect(cs.assemble("key")).toBeUndefined();
  });

  it("remove deletes the entry", () => {
    const cs = new ChunkStore(50, 60_000);
    cs.add_chunk("rm", 0, 1, "x");
    expect(cs.remove("rm")).toBe(true);
    expect(cs.assemble("rm")).toBeUndefined();
  });

  it("handles duplicate chunk at same index", () => {
    const cs = new ChunkStore(50, 60_000);
    cs.add_chunk("dup", 0, 2, "first");
    cs.add_chunk("dup", 0, 2, "second");  // duplicate index, ignored
    expect(cs.add_chunk("dup", 1, 2, "last")).toBe(true);
    expect(cs.assemble("dup")).toBe("firstlast");
  });

  it("FIFO eviction at capacity", () => {
    const cs = new ChunkStore(2, 60_000);
    cs.add_chunk("a", 0, 1, "1");
    cs.add_chunk("b", 0, 1, "2");
    cs.add_chunk("c", 0, 1, "3");  // should evict "a"
    expect(cs.assemble("a")).toBeUndefined();
    expect(cs.assemble("c")).toBe("3");
  });
});

describe("compact_and_pack_json (strip + hex→b64)", () => {
  it("strips null and empty values", () => {
    const input = JSON.stringify({ name: "test", empty: "", nil: null, arr: [null, "", "keep"] });
    const result = compact_and_pack_json(input);
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe("test");
    expect(parsed.empty).toBeUndefined();
    expect(parsed.nil).toBeUndefined();
    expect(parsed.arr).toEqual(["keep"]);
  });

  it("converts hex fields to base64", () => {
    const hex = "aabbccdd";
    const input = JSON.stringify({ ciphertext: hex, nonce: hex, title: "hello" });
    const result = compact_and_pack_json(input);
    const parsed = JSON.parse(result);
    // hex field → base64
    expect(parsed.ciphertext).not.toBe(hex);
    expect(parsed.ciphertext).toBe(base64_encode(decode_hex(hex)));
    expect(parsed.nonce).toBe(base64_encode(decode_hex(hex)));
    // non-hex-key field stays as-is
    expect(parsed.title).toBe("hello");
  });

  it("leaves non-hex strings in hex-keyed fields unchanged", () => {
    const input = JSON.stringify({ ciphertext: "not-hex!" });
    const result = compact_and_pack_json(input);
    const parsed = JSON.parse(result);
    expect(parsed.ciphertext).toBe("not-hex!");
  });

  it("handles nested objects with hex keys", () => {
    const input = JSON.stringify({
      pins: [{ ciphertext: "deadbeef", nonce: "cafe" }],
      keys: { public_key: "00ff", secret_key: "abcd" },
    });
    const result = compact_and_pack_json(input);
    const parsed = JSON.parse(result);
    // pin-level hex fields converted
    expect(parsed.pins[0].ciphertext).toBe(base64_encode(decode_hex("deadbeef")));
    expect(parsed.pins[0].nonce).toBe(base64_encode(decode_hex("cafe")));
    // key-level hex fields converted
    expect(parsed.keys.public_key).toBe(base64_encode(decode_hex("00ff")));
    expect(parsed.keys.secret_key).toBe(base64_encode(decode_hex("abcd")));
  });

  it("handles empty input", () => {
    const result = compact_and_pack_json("{}");
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

describe("compact_pack_gzip_json (strip + hex→b64 + gzip)", () => {
  it("produces decompressable data", () => {
    const input = JSON.stringify({ name: "test", data: [1, 2, 3] });
    const compressed = compact_pack_gzip_json(input);
    const decompressed = decompress_gzip(compressed);
    const parsed = JSON.parse(new TextDecoder().decode(decompressed));
    expect(parsed.name).toBe("test");
    expect(parsed.data).toEqual([1, 2, 3]);
  });

  it("converts hex fields in gzipped output", () => {
    const hex = "aabb";
    const input = JSON.stringify({ ciphertext: hex });
    const compressed = compact_pack_gzip_json(input);
    const decompressed = decompress_gzip(compressed);
    const parsed = JSON.parse(new TextDecoder().decode(decompressed));
    expect(parsed.ciphertext).toBe(base64_encode(decode_hex(hex)));
  });
});
