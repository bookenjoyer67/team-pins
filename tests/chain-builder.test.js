/**
 * chain-builder.test.js — Narrative chain builder pure-logic tests
 *
 * Phase 2: Narrative Chain Builder
 * Tests the data-construction and validation logic used by the builder
 * (no DOM, no Leaflet, no IndexedDB needed).
 */

import { describe, it, expect } from "vitest";

// Pure data-construction function (mirrors what the builder's save handler does)
function buildChainObject(opts) {
  const {
    name, description, tagsInput, pinIds, narratives,
    communityId, authorPubkey, authorDisplayName,
  } = opts;
  return {
    chain_id: null, // filled by generate_uuid at save time
    community_id: communityId,
    name,
    description: description || "",
    cover_pin_id: null,
    author_pubkey: authorPubkey || "",
    author_display_name: authorDisplayName || "",
    tags: (tagsInput || "").split(",").map(s => s.trim()).filter(Boolean),
    pin_entries: (pinIds || []).map(pid => ({
      pin_id: pid,
      narrative: (narratives && narratives[pid]) || "",
      audio_ciphertext: null,
      audio_nonce: null,
      audio_type: null,
    })),
    pin_ids: pinIds || [],
    created_at: null,
    updated_at: null,
  };
}

// Validation
function validateChain({ name, pinIds }) {
  const errors = [];
  if (!name || !name.trim()) errors.push("Name is required");
  if (!pinIds || pinIds.length < 2) errors.push("At least 2 pins required");
  return errors;
}

describe("Chain Builder: data construction", () => {
  it("builds chain object with name, ordered pins, and narratives", () => {
    const result = buildChainObject({
      name: "Walking Tour",
      description: "A tour of historic sites",
      tagsInput: "history, walking",
      pinIds: ["pin-1", "pin-2", "pin-3"],
      narratives: {
        "pin-1": "Start here at the old church",
        "pin-2": "Then the town hall was built",
        "pin-3": "Finally, the waterfront",
      },
      communityId: "comm-abc",
      authorPubkey: "aa".repeat(32),
      authorDisplayName: "Alice",
    });

    expect(result.name).toBe("Walking Tour");
    expect(result.description).toBe("A tour of historic sites");
    expect(result.tags).toEqual(["history", "walking"]);
    expect(result.community_id).toBe("comm-abc");
    expect(result.author_pubkey).toBe("aa".repeat(32));
    expect(result.author_display_name).toBe("Alice");
    expect(result.pin_ids).toEqual(["pin-1", "pin-2", "pin-3"]);
    expect(result.cover_pin_id).toBeNull();
  });

  it("pin_entries preserves pin order exactly", () => {
    const result = buildChainObject({
      name: "Test",
      pinIds: ["c", "a", "b"],
      narratives: { "a": "A", "b": "B", "c": "C" },
      communityId: "x",
    });

    expect(result.pin_entries).toHaveLength(3);
    expect(result.pin_entries[0].pin_id).toBe("c");
    expect(result.pin_entries[0].narrative).toBe("C");
    expect(result.pin_entries[1].pin_id).toBe("a");
    expect(result.pin_entries[1].narrative).toBe("A");
    expect(result.pin_entries[2].pin_id).toBe("b");
    expect(result.pin_entries[2].narrative).toBe("B");
  });

  it("missing narratives default to empty string", () => {
    const result = buildChainObject({
      name: "Test",
      pinIds: ["pin-1", "pin-2"],
      narratives: { "pin-1": "Has narrative" },
      communityId: "x",
    });

    expect(result.pin_entries[0].narrative).toBe("Has narrative");
    expect(result.pin_entries[1].narrative).toBe("");
  });

  it("tags split from comma-separated input, trimming whitespace", () => {
    const result = buildChainObject({
      name: "Test",
      tagsInput: " history , walking-tour ,  food  ",
      pinIds: ["a", "b"],
      communityId: "x",
    });

    expect(result.tags).toEqual(["history", "walking-tour", "food"]);
  });

  it("empty tags input produces empty array", () => {
    const result = buildChainObject({
      name: "Test",
      tagsInput: "",
      pinIds: ["a", "b"],
      communityId: "x",
    });
    expect(result.tags).toEqual([]);
  });

  it("tags with only commas produces empty array", () => {
    const result = buildChainObject({
      name: "Test",
      tagsInput: ", ,",
      pinIds: ["a", "b"],
      communityId: "x",
    });
    expect(result.tags).toEqual([]);
  });

  it("empty description defaults to empty string", () => {
    const result = buildChainObject({
      name: "Test",
      pinIds: ["a", "b"],
      communityId: "x",
    });
    expect(result.description).toBe("");
  });

  it("empty author fields default to empty string", () => {
    const result = buildChainObject({
      name: "Test",
      pinIds: ["a", "b"],
      communityId: "x",
    });
    expect(result.author_pubkey).toBe("");
    expect(result.author_display_name).toBe("");
  });

  it("pin_entries audio fields default to null", () => {
    const result = buildChainObject({
      name: "Test",
      pinIds: ["a"],
      communityId: "x",
    });

    expect(result.pin_entries[0].audio_ciphertext).toBeNull();
    expect(result.pin_entries[0].audio_nonce).toBeNull();
    expect(result.pin_entries[0].audio_type).toBeNull();
  });
});

describe("Chain Builder: validation", () => {
  it("rejects empty name", () => {
    const errors = validateChain({ name: "", pinIds: ["a", "b"] });
    expect(errors).toContain("Name is required");
  });

  it("rejects whitespace-only name", () => {
    const errors = validateChain({ name: "   ", pinIds: ["a", "b"] });
    expect(errors).toContain("Name is required");
  });

  it("rejects less than 2 pins", () => {
    const errors = validateChain({ name: "Test", pinIds: ["a"] });
    expect(errors).toContain("At least 2 pins required");
  });

  it("rejects empty pin array", () => {
    const errors = validateChain({ name: "Test", pinIds: [] });
    expect(errors).toContain("At least 2 pins required");
  });

  it("rejects null pinIds", () => {
    const errors = validateChain({ name: "Test", pinIds: null });
    expect(errors).toContain("At least 2 pins required");
  });

  it("passes valid chain with name and >= 2 pins", () => {
    const errors = validateChain({ name: "Valid", pinIds: ["a", "b"] });
    expect(errors).toEqual([]);
  });

  it("returns multiple errors when both name and pins invalid", () => {
    const errors = validateChain({ name: "", pinIds: [] });
    expect(errors).toHaveLength(2);
    expect(errors).toContain("Name is required");
    expect(errors).toContain("At least 2 pins required");
  });
});
