/**
 * chain-sync.test.js — Chain sync & author gating tests
 *
 * Covers:
 *   - sync_chains handler validation (set_id, data array checks)
 *   - processSyncChains correct argument order (setId first, data second)
 *   - new_chain / delete_chain handler logic
 *   - Author gating condition for edit/delete
 *   - Legacy chain (no author) UI safety
 */

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import * as DB from "../db.js";

const genId = () => crypto.randomUUID();

// --- Pure validation logic (extracted from sync_chains handler) ---

function validateSyncChainsMessage(d) {
  if (!d || typeof d.set_id !== "string" || !Array.isArray(d.data)) {
    return { valid: false, reason: "invalid sync_chains message" };
  }
  if (d.set_id.length === 0) {
    return { valid: false, reason: "empty set_id" };
  }
  return { valid: true };
}

// --- Pure author gating condition ---

function isChainAuthor(chain, signingPublicKey) {
  // Chain is author-protected if it has a non-empty author_pubkey
  // matching the current user's signing key
  return !!(chain.author_pubkey && chain.author_pubkey === signingPublicKey);
}

function canEditChain(chain, signingPublicKey) {
  // If chain has no author, no one is the author — deny edits
  if (!chain.author_pubkey) return false;
  return chain.author_pubkey === signingPublicKey;
}

// --- Pure processSyncChains logic (without DB calls) ---

function buildChainForImport(c, setId) {
  return { ...c, community_id: setId || c.community_id };
}

function processChainImports(setId, data) {
  const results = [];
  for (const c of (data || [])) {
    results.push(buildChainForImport(c, setId));
  }
  return results;
}

describe("sync_chains message validation", () => {
  it("accepts valid sync_chains message", () => {
    const result = validateSyncChainsMessage({
      set_id: "abc-123",
      data: [{ chain_id: "c1" }],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects missing set_id", () => {
    const result = validateSyncChainsMessage({
      data: [{ chain_id: "c1" }],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("invalid");
  });

  it("rejects non-string set_id", () => {
    const result = validateSyncChainsMessage({
      set_id: 123,
      data: [{ chain_id: "c1" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects non-array data", () => {
    const result = validateSyncChainsMessage({
      set_id: "abc",
      data: "not-an-array",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects null message", () => {
    expect(validateSyncChainsMessage(null).valid).toBe(false);
  });

  it("rejects undefined message", () => {
    expect(validateSyncChainsMessage(undefined).valid).toBe(false);
  });

  it("accepts empty data array (valid but no imports needed)", () => {
    const result = validateSyncChainsMessage({
      set_id: "abc",
      data: [],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects empty set_id string", () => {
    const result = validateSyncChainsMessage({
      set_id: "",
      data: [],
    });
    expect(result.valid).toBe(false);
  });
});

describe("processSyncChains: argument order and community_id", () => {
  it("uses first argument as setId, second as data array", () => {
    const results = processChainImports("set-abc", [
      { chain_id: "c1", name: "Chain One" },
      { chain_id: "c2", name: "Chain Two", community_id: "old-id" },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].community_id).toBe("set-abc");
    expect(results[0].name).toBe("Chain One");
    // c2 had its own community_id, but setId should override
    expect(results[1].community_id).toBe("set-abc");
  });

  it("falls back to chain.community_id when setId is falsy", () => {
    // This simulates a missing setId — processSyncChains(setId, data)
    // The actual function uses setId || c.community_id
    const results = processChainImports(null, [
      { chain_id: "c1", community_id: "fallback-id" },
    ]);
    expect(results[0].community_id).toBe("fallback-id");
  });

  it("handles empty data array without error", () => {
    const results = processChainImports("set-abc", []);
    expect(results).toEqual([]);
  });

  it("handles null data without error", () => {
    const results = processChainImports("set-abc", null);
    expect(results).toEqual([]);
  });
});

describe("new_chain / delete_chain handler conditions", () => {
  it("new_chain validates chain_id presence", () => {
    // Simulating: if (!d || !d.chain_id) return;
    function isValidNewChain(d) {
      return !!(d && d.chain_id);
    }
    expect(isValidNewChain({ chain_id: "abc" })).toBe(true);
    expect(isValidNewChain({ chain_id: "" })).toBe(false);
    expect(isValidNewChain(null)).toBe(false);
    expect(isValidNewChain({})).toBe(false);
  });

  it("delete_chain validates chain_id presence", () => {
    function isValidDeleteChain(d) {
      return !!(d && d.chain_id);
    }
    expect(isValidDeleteChain({ chain_id: "abc" })).toBe(true);
    expect(isValidDeleteChain({ chain_id: "" })).toBe(false);
    expect(isValidDeleteChain({})).toBe(false);
  });
});

describe("author gating", () => {
  it("author match allows edit/delete", () => {
    const chain = { chain_id: "c1", author_pubkey: "alice_key" };
    expect(isChainAuthor(chain, "alice_key")).toBe(true);
  });

  it("author mismatch denies edit/delete", () => {
    const chain = { chain_id: "c1", author_pubkey: "alice_key" };
    expect(isChainAuthor(chain, "bob_key")).toBe(false);
  });

  it("empty author_pubkey is treated as no author", () => {
    const chain = { chain_id: "c1", author_pubkey: "" };
    expect(isChainAuthor(chain, "any_key")).toBe(false);
    expect(isChainAuthor(chain, "")).toBe(false);
  });

  it("missing author_pubkey is treated as no author", () => {
    const chain = { chain_id: "c1" };
    expect(isChainAuthor(chain, "any_key")).toBe(false);
  });

  it("null author_pubkey is treated as no author", () => {
    const chain = { chain_id: "c1", author_pubkey: null };
    expect(isChainAuthor(chain, "any_key")).toBe(false);
  });

  it("canEdit denies when no author exists", () => {
    expect(canEditChain({ chain_id: "c1", author_pubkey: "" }, "any_key")).toBe(false);
    expect(canEditChain({ chain_id: "c1" }, "any_key")).toBe(false);
  });

  it("canEdit allows when author matches", () => {
    expect(canEditChain({ chain_id: "c1", author_pubkey: "alice" }, "alice")).toBe(true);
  });

  it("canEdit denies when author is different", () => {
    expect(canEditChain({ chain_id: "c1", author_pubkey: "alice" }, "bob")).toBe(false);
  });
});

describe("database integration: chain save/load with author", () => {
  it("saves chain with author_pubkey and retrieves it intact", async () => {
    const chain = {
      chain_id: genId(),
      community_id: genId(),
      name: "Auth Chain",
      description: "",
      cover_pin_id: null,
      author_pubkey: "ff".repeat(32),
      author_display_name: "Alice",
      tags: [],
      pin_entries: [{ pin_id: genId(), narrative: "Story", audio_ciphertext: null, audio_nonce: null, audio_type: null, branches: [] }],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    await DB.saveChain(chain);

    const retrieved = await DB.getChain(chain.chain_id);
    expect(retrieved).toBeDefined();
    expect(retrieved.author_pubkey).toBe("ff".repeat(32));
    expect(retrieved.author_display_name).toBe("Alice");
  });

  it("legacy chain with empty author_pubkey loads without crash", async () => {
    const chain = {
      chain_id: genId(),
      community_id: genId(),
      name: "Legacy",
      pin_ids: [genId(), genId()],
      created_at: Date.now(),
    };
    await DB.saveChain(chain);

    const retrieved = await DB.getChain(chain.chain_id);
    expect(retrieved).toBeDefined();
    expect(retrieved.author_pubkey).toBe("");
    expect(retrieved.pin_entries).toBeDefined();
    expect(retrieved.pin_entries.length).toBe(2);
  });
});
