/**
 * chain-branch.test.js — Branching chain data model + validation tests
 *
 * Covers:
 *   - Branch data construction with labels and next_pin_id
 *   - Incomplete branch filtering (empty label or target)
 *   - Orphan cleanup on waypoint removal
 *   - Default branches:[] for entry without branches
 */

import { describe, it, expect } from "vitest";

// Pure data helpers (match the logic used in builder save + story render)

function buildPinEntry(opts) {
  const { pinId, narrative, branches } = opts;
  return {
    pin_id: pinId,
    narrative: narrative || "",
    audio_ciphertext: null,
    audio_nonce: null,
    audio_type: null,
    branches: branches || [],
  };
}

function filterValidBranches(branches) {
  if (!branches || !Array.isArray(branches)) return [];
  return branches.filter(b => b && b.label && b.label.trim() && b.next_pin_id);
}

function stripOrphanBranches(entries, removedPinId) {
  for (const entry of entries) {
    if (entry.branches) {
      entry.branches = entry.branches.filter(b => b.next_pin_id !== removedPinId);
    }
  }
  return entries;
}

function buildBranchIndexMap(entries) {
  const map = {};
  entries.forEach((e, i) => { map[e.pin_id] = i; });
  return map;
}

describe("Branch: data construction", () => {
  it("builds pin entry with branches array", () => {
    const entry = buildPinEntry({
      pinId: "a",
      narrative: "Start",
      branches: [
        { label: "Path A", next_pin_id: "b" },
        { label: "Path B", next_pin_id: "c" },
      ],
    });
    expect(entry.pin_id).toBe("a");
    expect(entry.branches).toHaveLength(2);
    expect(entry.branches[0].label).toBe("Path A");
    expect(entry.branches[0].next_pin_id).toBe("b");
    expect(entry.branches[1].label).toBe("Path B");
    expect(entry.branches[1].next_pin_id).toBe("c");
  });

  it("defaults branches to empty array when not provided", () => {
    const entry = buildPinEntry({ pinId: "x", narrative: "Leaf" });
    expect(entry.branches).toEqual([]);
  });

  it("supports convergence: multiple entries branch to same target", () => {
    const entries = [
      buildPinEntry({ pinId: "a", branches: [{ label: "Way", next_pin_id: "c" }] }),
      buildPinEntry({ pinId: "b", branches: [{ label: "Other way", next_pin_id: "c" }] }),
      buildPinEntry({ pinId: "c" }),
    ];
    const targets = entries.flatMap(e => (e.branches || []).map(b => b.next_pin_id));
    expect(targets.filter(id => id === "c")).toHaveLength(2);
  });
});

describe("Branch: validation", () => {
  it("filters branches with empty label", () => {
    const branches = [
      { label: "Good", next_pin_id: "b" },
      { label: "", next_pin_id: "c" },
      { label: "  ", next_pin_id: "d" },
    ];
    const valid = filterValidBranches(branches);
    expect(valid).toHaveLength(1);
    expect(valid[0].label).toBe("Good");
  });

  it("filters branches with empty next_pin_id", () => {
    const branches = [
      { label: "Good", next_pin_id: "b" },
      { label: "No target", next_pin_id: "" },
      { label: "Null target", next_pin_id: null },
    ];
    const valid = filterValidBranches(branches);
    expect(valid).toHaveLength(1);
    expect(valid[0].label).toBe("Good");
  });

  it("returns empty array for null/undefined branches", () => {
    expect(filterValidBranches(null)).toEqual([]);
    expect(filterValidBranches(undefined)).toEqual([]);
  });

  it("returns empty array for empty branches array", () => {
    expect(filterValidBranches([])).toEqual([]);
  });
});

describe("Branch: orphan cleanup on waypoint removal", () => {
  it("removes branches pointing to deleted waypoint only", () => {
    const entries = [
      buildPinEntry({ pinId: "a", branches: [
        { label: "To B", next_pin_id: "b" },
        { label: "To C", next_pin_id: "c" },
      ]}),
      buildPinEntry({ pinId: "b" }),
      buildPinEntry({ pinId: "c", branches: [
        { label: "To B", next_pin_id: "b" },
      ]}),
    ];

    stripOrphanBranches(entries, "b");

    expect(entries[0].branches).toHaveLength(1);
    expect(entries[0].branches[0].next_pin_id).toBe("c");
    expect(entries[2].branches).toHaveLength(0);
  });

  it("no-op when removed pin has no branch references", () => {
    const entries = [
      buildPinEntry({ pinId: "a", branches: [{ label: "To B", next_pin_id: "b" }] }),
      buildPinEntry({ pinId: "b" }),
    ];
    stripOrphanBranches(entries, "c");
    expect(entries[0].branches).toHaveLength(1);
  });
});

describe("Branch: index map for story jumps", () => {
  it("maps pin_ids to array indices", () => {
    const entries = [
      { pin_id: "a" }, { pin_id: "b" }, { pin_id: "c" },
    ];
    const map = buildBranchIndexMap(entries);
    expect(map["a"]).toBe(0);
    expect(map["b"]).toBe(1);
    expect(map["c"]).toBe(2);
  });

  it("returns undefined for unknown pin_id", () => {
    const map = buildBranchIndexMap([{ pin_id: "a" }]);
    expect(map["nonexistent"]).toBeUndefined();
  });
});
