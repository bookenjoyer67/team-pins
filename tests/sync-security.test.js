/**
 * sync-security.test.js — P2P sync security & signature hardening
 *
 * Covers:
 *   - import_set validation (public_key, wrapped_dek length limits)
 *   - delete_pin/delete_drawing authorization (Ed25519 signatures)
 *   - tombstone authorization + signature verification
 *   - Per-member keypair model in P2P import_set handling
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  encode_hex,
  sign,
  verify,
  generate_signing_keypair,
  generate_user_keypair,
  generate_dek,
  wrap_dek,
  unwrap_dek,
  generate_uuid,
} from "../core/pkg/e2e_core.js";

// --- IMPORT_SET Validation (extracted from sync.js handleMessage) ---

function validateImportSetData(d) {
  if (!d || typeof d.public_key !== "string" || typeof d.wrapped_dek !== "string")
    return { valid: false, reason: "missing required fields" };
  if (d.public_key.length > 256) return { valid: false, reason: "public_key too long" };
  if (d.wrapped_dek.length > 512) return { valid: false, reason: "wrapped_dek too long" };
  // Per-member model: secret_key is optional for non-PBKDF2 (sync.js:322)
  if (d.secret_key && d.secret_key.length > 256)
    return { valid: false, reason: "secret_key too long" };
  return { valid: true };
}

// --- Signature payload helpers (| delimited, hex-encoded) ---

function makeSignPayload(...parts) {
  return encode_hex(new TextEncoder().encode(parts.join("|")));
}

describe("import_set data validation", () => {
  it("accepts valid import_set data", () => {
    const kp = generate_user_keypair();
    const dk = generate_dek();
    const data = {
      public_key: encode_hex(kp.public),
      wrapped_dek: wrap_dek(dk, encode_hex(kp.public)),
      set_id: generate_uuid(),
    };
    expect(validateImportSetData(data).valid).toBe(true);
  });

  it("accepts import_set without secret_key (per-member model)", () => {
    const kp = generate_user_keypair();
    const dk = generate_dek();
    const data = {
      public_key: encode_hex(kp.public),
      wrapped_dek: wrap_dek(dk, encode_hex(kp.public)),
      set_id: generate_uuid(),
    };
    expect(validateImportSetData(data).valid).toBe(true);
  });

  it("rejects import_set with oversized public_key", () => {
    const data = { public_key: "a".repeat(300), wrapped_dek: "valid" };
    const result = validateImportSetData(data);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("public_key");
  });

  it("rejects import_set with oversized wrapped_dek", () => {
    const kp = generate_user_keypair();
    const data = { public_key: encode_hex(kp.public), wrapped_dek: "b".repeat(600) };
    const result = validateImportSetData(data);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("wrapped_dek");
  });

  it("rejects import_set with oversized secret_key", () => {
    const kp = generate_user_keypair();
    const dk = generate_dek();
    const data = {
      public_key: encode_hex(kp.public),
      wrapped_dek: wrap_dek(dk, encode_hex(kp.public)),
      secret_key: "c".repeat(300),
      key_derivation: "random",
    };
    expect(validateImportSetData(data).valid).toBe(false);
  });

  it("rejects import_set with missing public_key", () => {
    expect(validateImportSetData({ wrapped_dek: "some" }).valid).toBe(false);
  });

  it("rejects import_set with missing wrapped_dek", () => {
    expect(validateImportSetData({ public_key: "some" }).valid).toBe(false);
  });

  it("rejects null/undefined/empty", () => {
    expect(validateImportSetData(null).valid).toBe(false);
    expect(validateImportSetData(undefined).valid).toBe(false);
    expect(validateImportSetData({}).valid).toBe(false);
  });
});

describe("Delete pin authorization (Ed25519 sign/verify)", () => {
  let authorKp, nonAuthorKp, pinId, ts;

  beforeAll(() => {
    authorKp = generate_signing_keypair();
    nonAuthorKp = generate_signing_keypair();
    pinId = generate_uuid().replace(/-/g, "");
    ts = Date.now();
  });

  it("author's signature on delete_pin payload verifies with author's pubkey", () => {
    const payloadHex = makeSignPayload(pinId, String(ts));
    const sig = sign(payloadHex, authorKp.secret);
    expect(verify(payloadHex, sig, authorKp.public)).toBe(true);
  });

  it("non-author's signature on delete_pin fails against original author's pubkey", () => {
    const payloadHex = makeSignPayload(pinId, String(ts));
    const sig = sign(payloadHex, nonAuthorKp.secret);
    expect(verify(payloadHex, sig, authorKp.public)).toBe(false);
  });

  it("signature verification fails with tampered payload (wrong pinId)", () => {
    const payloadHex = makeSignPayload(pinId, String(ts));
    const sig = sign(payloadHex, authorKp.secret);
    const badPayload = makeSignPayload("tampered_id", String(ts));
    expect(verify(badPayload, sig, authorKp.public)).toBe(false);
  });

  it("signature verification fails with tampered timestamp", () => {
    const payloadHex = makeSignPayload(pinId, String(ts));
    const sig = sign(payloadHex, authorKp.secret);
    const badPayload = makeSignPayload(pinId, String(Date.now() + 1));
    expect(verify(badPayload, sig, authorKp.public)).toBe(false);
  });
});

describe("Attestation payload format", () => {
  let sigKp, pinId, ts;

  beforeAll(() => {
    sigKp = generate_signing_keypair();
    pinId = generate_uuid().replace(/-/g, "");
    ts = Date.now();
  });

  it("confirmed attestation verifies", () => {
    const payloadHex = makeSignPayload(pinId, "confirmed", String(ts));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("disputed attestation verifies", () => {
    const payloadHex = makeSignPayload(pinId, "disputed", String(ts));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("flagged attestation verifies", () => {
    const payloadHex = makeSignPayload(pinId, "flagged", String(ts));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("creation attestation format verifies", () => {
    const payloadHex = makeSignPayload(pinId, "created", String(ts));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });
});

describe("Annotation vote payload format", () => {
  let sigKp, annId, ts;

  beforeAll(() => {
    sigKp = generate_signing_keypair();
    annId = generate_uuid().replace(/-/g, "");
    ts = Date.now();
  });

  it("annotation vote with direction 'upvote' verifies", () => {
    const payloadHex = makeSignPayload(annId, "upvote", String(ts));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });

  it("annotation vote with direction 'downvote' verifies", () => {
    const payloadHex = makeSignPayload(annId, "downvote", String(ts));
    const sig = sign(payloadHex, sigKp.secret);
    expect(verify(payloadHex, sig, sigKp.public)).toBe(true);
  });
});

describe("Tombstone authorization", () => {
  let authorKp, nonAuthorKp, targetId, tombId, ts;

  beforeAll(() => {
    authorKp = generate_signing_keypair();
    nonAuthorKp = generate_signing_keypair();
    targetId = generate_uuid().replace(/-/g, "");
    tombId = generate_uuid().replace(/-/g, "");
    ts = Date.now();
  });

  it("author's tombstone signature verifies against author's pubkey", () => {
    const payloadHex = makeSignPayload(targetId, tombId, String(ts));
    const sig = sign(payloadHex, authorKp.secret);
    expect(verify(payloadHex, sig, authorKp.public)).toBe(true);
  });

  it("non-author's tombstone signature fails against original author's pubkey", () => {
    const payloadHex = makeSignPayload(targetId, tombId, String(ts));
    const sig = sign(payloadHex, nonAuthorKp.secret);
    expect(verify(payloadHex, sig, authorKp.public)).toBe(false);
  });
});

describe("Per-member keypair model (P2P import_set with re-wrap)", () => {
  it("new member can generate X25519 keypair and community re-wraps DEK for them", () => {
    const communityKp = generate_user_keypair();
    const memberKp = generate_user_keypair();
    const dk = generate_dek();

    // Community wraps DEK with community key
    const communityWrapped = wrap_dek(dk, encode_hex(communityKp.public));

    // Community owner unwraps (proves DEK access)
    const unwrappedByCommunity = unwrap_dek(communityWrapped, encode_hex(communityKp.secret));
    expect(unwrappedByCommunity).toEqual(dk);

    // Community owner re-wraps for new member
    const memberWrapped = wrap_dek(dk, encode_hex(memberKp.public));

    // New member unwraps with their own X25519 secret
    const unwrappedByMember = unwrap_dek(memberWrapped, encode_hex(memberKp.secret));
    expect(unwrappedByMember).toEqual(dk);
  });
});
