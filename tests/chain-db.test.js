/**
 * chain-db.test.js — Chain data model migration & CRUD tests
 *
 * Phase 1: Rich Chain Data Model
 * Covers:
 *   - saveChain with modern pin_entries format
 *   - Legacy chain auto-upgrade on read (pin_ids → pin_entries)
 *   - Community-filtered chain retrieval
 *   - Chain deletion (single + via deleteTeam)
 *   - pin_ids derivation from pin_entries
 */

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import * as DB from "../db.js";

const genId = () => crypto.randomUUID();

function makeModernChain(overrides = {}) {
  const chainId = overrides.chain_id || genId();
  return {
    chain_id: chainId,
    community_id: overrides.community_id || genId(),
    name: overrides.name || "Test Chain",
    description: overrides.description ?? "A narrative walking tour",
    cover_pin_id: overrides.cover_pin_id ?? null,
    author_pubkey: overrides.author_pubkey ?? "ff".repeat(32),
    author_display_name: overrides.author_display_name ?? "Alice",
    tags: overrides.tags ?? ["history", "walking-tour"],
    pin_entries: overrides.pin_entries ?? [
      { pin_id: genId(), narrative: "Start here", audio_ciphertext: null, audio_nonce: null, audio_type: null },
      { pin_id: genId(), narrative: "Then this happened", audio_ciphertext: null, audio_nonce: null, audio_type: null },
      { pin_id: genId(), narrative: "End of the story", audio_ciphertext: null, audio_nonce: null, audio_type: null },
    ],
    created_at: overrides.created_at ?? Date.now(),
    updated_at: overrides.updated_at ?? Date.now(),
  };
}

function makeLegacyChain(overrides = {}) {
  return {
    chain_id: overrides.chain_id || genId(),
    community_id: overrides.community_id || genId(),
    name: overrides.name || "Legacy Chain",
    pin_ids: overrides.pin_ids ?? [genId(), genId(), genId()],
    created_at: overrides.created_at ?? Date.now(),
  };
}

describe("Chain: save & retrieve (modern format)", () => {
  it("saves chain with pin_entries and retrieves all fields", async () => {
    const chain = makeModernChain();
    await DB.saveChain(chain);

    const retrieved = await DB.getChain(chain.chain_id);
    expect(retrieved).toBeDefined();
    expect(retrieved.chain_id).toBe(chain.chain_id);
    expect(retrieved.community_id).toBe(chain.community_id);
    expect(retrieved.name).toBe("Test Chain");
    expect(retrieved.description).toBe("A narrative walking tour");
    expect(retrieved.cover_pin_id).toBeNull();
    expect(retrieved.author_pubkey).toBe("ff".repeat(32));
    expect(retrieved.author_display_name).toBe("Alice");
    expect(retrieved.tags).toEqual(["history", "walking-tour"]);
    expect(retrieved.created_at).toBe(chain.created_at);
    expect(retrieved.updated_at).toBe(chain.updated_at);
  });

  it("derives pin_ids from pin_entries on save", async () => {
    const entries = [
      { pin_id: genId(), narrative: "", audio_ciphertext: null, audio_nonce: null, audio_type: null },
      { pin_id: genId(), narrative: "", audio_ciphertext: null, audio_nonce: null, audio_type: null },
    ];
    const chain = makeModernChain({ pin_entries: entries });
    await DB.saveChain(chain);

    const retrieved = await DB.getChain(chain.chain_id);
    expect(retrieved.pin_ids).toHaveLength(2);
    expect(retrieved.pin_ids).toEqual(entries.map(e => e.pin_id));
    expect(retrieved.pin_entries).toHaveLength(2);
    expect(retrieved.pin_entries[0].pin_id).toBe(entries[0].pin_id);
    expect(retrieved.pin_entries[1].pin_id).toBe(entries[1].pin_id);
  });

  it("creates pin_entries from pin_ids on save when pin_entries absent", async () => {
    const pids = [genId(), genId()];
    const chain = { chain_id: genId(), community_id: genId(), name: "Flat", pin_ids: pids, created_at: Date.now() };
    await DB.saveChain(chain);

    const retrieved = await DB.getChain(chain.chain_id);
    expect(retrieved.pin_entries).toHaveLength(2);
    expect(retrieved.pin_entries[0].pin_id).toBe(pids[0]);
    expect(retrieved.pin_entries[0].narrative).toBe("");
    expect(retrieved.pin_entries[1].pin_id).toBe(pids[1]);
    expect(retrieved.pin_ids).toEqual(pids);
  });
});

describe("Chain: legacy migration", () => {
  it("legacy chain (pin_ids only) auto-upgrades via getChain", async () => {
    const legacy = makeLegacyChain();
    // Save raw legacy via put to bypass saveChain normalization
    await DB.saveChain(legacy);

    const retrieved = await DB.getChain(legacy.chain_id);
    expect(retrieved.pin_entries).toBeDefined();
    expect(retrieved.pin_entries).toHaveLength(legacy.pin_ids.length);
    expect(retrieved.pin_entries[0].pin_id).toBe(legacy.pin_ids[0]);
    expect(retrieved.pin_entries[0].narrative).toBe("");
    expect(retrieved.description).toBe("");
    expect(retrieved.cover_pin_id).toBeNull();
    expect(retrieved.author_pubkey).toBe("");
    expect(retrieved.author_display_name).toBe("");
    expect(retrieved.tags).toEqual([]);
    expect(retrieved.updated_at).toBeDefined();
    expect(retrieved.pin_ids).toEqual(legacy.pin_ids);
  });

  it("legacy chain auto-upgrades via getChainsByCommunity", async () => {
    const cid = genId();
    const legacy1 = makeLegacyChain({ community_id: cid });
    const legacy2 = makeLegacyChain({ community_id: cid });
    await DB.saveChain(legacy1);
    await DB.saveChain(legacy2);

    const chains = await DB.getChainsByCommunity(cid);
    expect(chains).toHaveLength(2);
    for (const c of chains) {
      expect(c.pin_entries).toBeDefined();
      expect(c.pin_entries.length).toBe(c.pin_ids.length);
      expect(c.pin_entries.map(e => e.pin_id)).toEqual(c.pin_ids);
      expect(c.description).toBe("");
      expect(c.tags).toEqual([]);
    }
  });

  it("upgrade preserves pin_ids order exactly", async () => {
    const pids = ["pin-c", "pin-a", "pin-b"]; // deliberate non-alphabetical order
    const legacy = makeLegacyChain({ pin_ids: pids });
    await DB.saveChain(legacy);

    const retrieved = await DB.getChain(legacy.chain_id);
    expect(retrieved.pin_ids).toEqual(pids);
    expect(retrieved.pin_entries.map(e => e.pin_id)).toEqual(pids);
  });
});

describe("Chain: community filtering", () => {
  it("getChainsByCommunity returns chains for correct community only", async () => {
    const cid1 = genId();
    const cid2 = genId();

    await DB.saveChain(makeModernChain({ community_id: cid1, name: "Chain A" }));
    await DB.saveChain(makeModernChain({ community_id: cid1, name: "Chain B" }));
    await DB.saveChain(makeModernChain({ community_id: cid2, name: "Chain C" }));

    const chains1 = await DB.getChainsByCommunity(cid1);
    expect(chains1).toHaveLength(2);
    expect(chains1.map(c => c.name).sort()).toEqual(["Chain A", "Chain B"]);

    const chains2 = await DB.getChainsByCommunity(cid2);
    expect(chains2).toHaveLength(1);
    expect(chains2[0].name).toBe("Chain C");
  });

  it("getChainsByCommunity returns empty array for community with no chains", async () => {
    const chains = await DB.getChainsByCommunity(genId());
    expect(chains).toEqual([]);
  });
});

describe("Chain: deletion", () => {
  it("deleteChain removes record, getChain returns undefined", async () => {
    const chain = makeModernChain();
    await DB.saveChain(chain);

    const before = await DB.getChain(chain.chain_id);
    expect(before).toBeDefined();

    await DB.deleteChain(chain.chain_id);
    const after = await DB.getChain(chain.chain_id);
    expect(after).toBeUndefined();
  });

  it("deleteTeam also deletes associated chains", async () => {
    const teamId = genId();
    // Save a team and community first (prerequisites for deleteTeam tx)
    await DB.saveTeam({
      team_id: teamId,
      name: "TestTeam",
      public_key: "aa".repeat(32),
      secret_key: "bb".repeat(32),
      wrapped_dek: "cc".repeat(32),
      key_derivation: "random",
    });
    await DB.saveCommunity({
      community_id: teamId,
      name: "TestTeam Comm",
      description: "",
      genesis_public_key: "",
      members: [{ pubkey: "aa".repeat(32), display_name: "Founder", role: "founder", joined_at: Date.now(), vouched_by: null }],
      governance: { contribution: "open", validation: "none", schema_authority: "any_member", key_rotation: "founder_only", fork_policy: "allowed", join_policy: "open" },
      bounds: null,
      relay_nodes: [],
    });

    const chain = makeModernChain({ community_id: teamId });
    await DB.saveChain(chain);

    const before = await DB.getChain(chain.chain_id);
    expect(before).toBeDefined();

    await DB.deleteTeam(teamId);

    const after = await DB.getChain(chain.chain_id);
    expect(after).toBeUndefined();
  });
});
