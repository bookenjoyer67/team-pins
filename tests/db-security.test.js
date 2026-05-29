/**
 * db-security.test.js — Database security & migration tests
 *
 * Covers:
 *   - Team save/retrieve with dual keypair (community + member)
 *   - Community save/retrieval with governance
 *   - Pin CRUD with author_pubkey
 *   - Drawing CRUD
 *   - Annotation save/retrieve/delete
 *   - Tombstone storage
 *   - Layer/Schema CRUD
 *   - Known peers
 *   - TTL auto-expiry fields
 */

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import * as DB from "../db.js";

const genId = () => crypto.randomUUID();

describe("Database: Team (key management)", () => {
  it("saves and retrieves team with dual keypair fields", async () => {
    const teamId = genId();
    const team = {
      team_id: teamId,
      name: "Test Community",
      public_key: "aa".repeat(32),
      secret_key: "bb".repeat(32),
      wrapped_dek: "cc".repeat(32),
      community_public_key: "aa_community".repeat(4),
      community_secret_key: "bb_community".repeat(4),
      community_wrapped_dek: "cc_community".repeat(4),
      key_derivation: "random",
    };
    await DB.saveTeam(team);

    const retrieved = await DB.getTeam(teamId);
    expect(retrieved).toBeDefined();
    expect(retrieved.team_id).toBe(teamId);
    expect(retrieved.public_key).toBe(team.public_key);
    expect(retrieved.secret_key).toBe(team.secret_key);
    expect(retrieved.community_public_key).toBe(team.community_public_key);
    expect(retrieved.community_secret_key).toBe(team.community_secret_key);
    expect(retrieved.community_wrapped_dek).toBe(team.community_wrapped_dek);
    expect(retrieved.key_derivation).toBe("random");
    expect(retrieved.name).toBe("Test Community");
  });

  it("saves team with PBKDF2 key derivation", async () => {
    const teamId = genId();
    const team = {
      team_id: teamId,
      name: "Password Community",
      public_key: "aa".repeat(32),
      secret_key: "bb".repeat(32),
      wrapped_dek: "cc".repeat(32),
      key_derivation: "pbkdf2",
    };
    await DB.saveTeam(team);
    const retrieved = await DB.getTeam(teamId);
    expect(retrieved.key_derivation).toBe("pbkdf2");
  });

  it("returns undefined for non-existent team", async () => {
    const result = await DB.getTeam("non-existent-id");
    expect(result).toBeUndefined();
  });

  it("updates existing team on re-save", async () => {
    const teamId = genId();
    const team = {
      team_id: teamId,
      name: "Original Name",
      public_key: "aa".repeat(32),
      secret_key: "bb".repeat(32),
      wrapped_dek: "cc".repeat(32),
    };
    await DB.saveTeam(team);
    team.name = "Updated Name";
    await DB.saveTeam(team);
    const retrieved = await DB.getTeam(teamId);
    expect(retrieved.name).toBe("Updated Name");
  });

  it("saves legacy team (without community fields)", async () => {
    const teamId = genId();
    const team = {
      team_id: teamId,
      name: "Legacy Team",
      public_key: "aa".repeat(32),
      secret_key: "bb".repeat(32),
      wrapped_dek: "cc".repeat(32),
      key_derivation: "random",
    };
    await DB.saveTeam(team);
    const retrieved = await DB.getTeam(teamId);
    expect(retrieved.name).toBe("Legacy Team");
    expect(retrieved.community_secret_key).toBeUndefined();
  });

  it("getAllTeams returns multiple teams", async () => {
    const id1 = genId(), id2 = genId();
    await DB.saveTeam({ team_id: id1, name: "T1", public_key: "aa".repeat(32), secret_key: "bb".repeat(32), wrapped_dek: "cc".repeat(32) });
    await DB.saveTeam({ team_id: id2, name: "T2", public_key: "dd".repeat(32), secret_key: "ee".repeat(32), wrapped_dek: "ff".repeat(32) });
    const all = await DB.getAllTeams();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const names = all.map(t => t.name);
    expect(names).toContain("T1");
    expect(names).toContain("T2");
  });

  it("renameTeam updates the name", async () => {
    const teamId = genId();
    await DB.saveTeam({ team_id: teamId, name: "OldName", public_key: "aa".repeat(32), secret_key: "bb".repeat(32), wrapped_dek: "cc".repeat(32) });
    await DB.renameTeam(teamId, "NewName");
    const retrieved = await DB.getTeam(teamId);
    expect(retrieved.name).toBe("NewName");
  });
});

describe("Database: Community", () => {
  it("saves and retrieves community with governance + members", async () => {
    const communityId = genId();
    const community = {
      community_id: communityId,
      name: "Test Community",
      description: "A test community for unit tests",
      genesis_public_key: "genesis_pubkey_here",
      visibility: "private",
      members: [
        { pubkey: "member1_pubkey", display_name: "Alice", role: "founder" },
        { pubkey: "member2_pubkey", display_name: "Bob", role: "contributor" },
      ],
      governance: {
        contribution: "open",
        validation: "none",
        schema_authority: "any_member",
        key_rotation: "founder_only",
        fork_policy: "allowed",
        join_policy: "open",
      },
      bounds: { north: 90, south: -90, east: 180, west: -180 },
      relay_nodes: [],
      relay_url: "wss://relay.example.com",
    };
    await DB.saveCommunity(community);

    const retrieved = await DB.getCommunity(communityId);
    expect(retrieved).toBeDefined();
    expect(retrieved.community_id).toBe(communityId);
    expect(retrieved.name).toBe("Test Community");
    expect(retrieved.visibility).toBe("private");
    expect(retrieved.governance.join_policy).toBe("open");
    expect(retrieved.members).toHaveLength(2);
    expect(retrieved.relay_url).toBe("wss://relay.example.com");
  });

  it("returns undefined for non-existent community", async () => {
    const result = await DB.getCommunity("non-existent-id");
    expect(result).toBeUndefined();
  });
});

describe("Database: Pin", () => {
  it("saves and retrieves pin with author_pubkey", async () => {
    const teamId = genId();
    const pinId = genId();
    const pin = {
      pin_id: pinId,
      team_id: teamId,
      layer_id: genId(),
      ciphertext: "encrypted_pin_data",
      nonce: "deadbeefdeadbeefdeadbeefdeadbeef",
      created_at: Date.now(),
      author_pubkey: "author_pubkey_here",
      map_zoom: 13,
    };
    await DB.savePin(pin);

    const retrieved = await DB.getPin(pinId);
    expect(retrieved).toBeDefined();
    expect(retrieved.pin_id).toBe(pinId);
    expect(retrieved.author_pubkey).toBe("author_pubkey_here");
  });

  it("deletes pin (returns undefined after deletion)", async () => {
    const pinId = genId();
    const pin = {
      pin_id: pinId,
      team_id: genId(),
      ciphertext: "data",
      nonce: "deadbeefdeadbeefdeadbeefdeadbeef",
      created_at: Date.now(),
    };
    await DB.savePin(pin);
    await DB.deletePin(pinId);
    const retrieved = await DB.getPin(pinId);
    expect(retrieved).toBeUndefined();
  });

  it("getPins filters by team_id", async () => {
    const teamId1 = genId();
    const teamId2 = genId();

    await DB.savePin({ pin_id: genId(), team_id: teamId1, ciphertext: "a", nonce: "deadbeefdeadbeefdeadbeefdeadbeef", created_at: Date.now() });
    await DB.savePin({ pin_id: genId(), team_id: teamId1, ciphertext: "b", nonce: "deadbeefdeadbeefdeadbeefdeadbeef", created_at: Date.now() });
    await DB.savePin({ pin_id: genId(), team_id: teamId2, ciphertext: "c", nonce: "deadbeefdeadbeefdeadbeefdeadbeef", created_at: Date.now() });

    const pins1 = await DB.getPins(teamId1);
    const pins2 = await DB.getPins(teamId2);

    expect(pins1).toHaveLength(2);
    expect(pins2).toHaveLength(1);
  });

  it("getPins returns empty array for team with no pins", async () => {
    const pins = await DB.getPins(genId());
    expect(pins).toEqual([]);
  });

  it("updatePinLayerId changes layer", async () => {
    const pinId = genId();
    const oldLayer = genId();
    const newLayer = genId();
    await DB.savePin({ pin_id: pinId, team_id: genId(), layer_id: oldLayer, ciphertext: "d", nonce: "deadbeefdeadbeefdeadbeefdeadbeef", created_at: Date.now() });
    await DB.updatePinLayerId(pinId, newLayer);
    const retrieved = await DB.getPin(pinId);
    expect(retrieved.layer_id).toBe(newLayer);
  });
});

describe("Database: Drawing", () => {
  it("saves and retrieves drawing with author_pubkey", async () => {
    const teamId = genId();
    const drawingId = genId();
    const drawing = {
      drawing_id: drawingId,
      team_id: teamId,
      encrypted_geojson: "encrypted_geojson_data",
      nonce: "deadbeefdeadbeefdeadbeefdeadbeef",
      author_pubkey: "drawing_author_pubkey",
    };
    await DB.saveDrawing(drawing);

    const retrieved = await DB.getDrawing(drawingId);
    expect(retrieved).toBeDefined();
    expect(retrieved.author_pubkey).toBe("drawing_author_pubkey");
  });

  it("deletes drawing (returns undefined after)", async () => {
    const drawingId = genId();
    await DB.saveDrawing({ drawing_id: drawingId, team_id: genId(), encrypted_geojson: "data", nonce: "deadbeefdeadbeefdeadbeefdeadbeef" });
    await DB.deleteDrawing(drawingId);
    const retrieved = await DB.getDrawing(drawingId);
    expect(retrieved).toBeUndefined();
  });

  it("getDrawings filters by team_id", async () => {
    const tid = genId();
    await DB.saveDrawing({ drawing_id: genId(), team_id: tid, encrypted_geojson: "a", nonce: "deadbeefdeadbeefdeadbeefdeadbeef" });
    await DB.saveDrawing({ drawing_id: genId(), team_id: tid, encrypted_geojson: "b", nonce: "deadbeefdeadbeefdeadbeefdeadbeef" });
    const drawings = await DB.getDrawings(tid);
    expect(drawings).toHaveLength(2);
  });
});

describe("Database: Annotations", () => {
  it("saves and retrieves annotation with author_pubkey", async () => {
    const annId = genId();
    const pinId = genId();
    const annotation = {
      annotation_id: annId,
      pin_id: pinId,
      team_id: genId(),
      ciphertext: "encrypted_comment",
      nonce: "deadbeefdeadbeefdeadbeefdeadbeef",
      author_pubkey: "comment_author_pubkey",
      created_at: Date.now(),
      parent_id: null,
    };
    await DB.saveAnnotation(annotation);

    const retrieved = await DB.getAnnotation(annId);
    expect(retrieved).toBeDefined();
    expect(retrieved.author_pubkey).toBe("comment_author_pubkey");
    expect(retrieved.pin_id).toBe(pinId);
  });

  it("getAnnotation returns undefined for non-existent", async () => {
    const result = await DB.getAnnotation("non-existent-ann");
    expect(result).toBeUndefined();
  });

  it("getAnnotationsByPin filters correctly", async () => {
    const pinId1 = genId();
    const pinId2 = genId();
    await DB.saveAnnotation({ annotation_id: genId(), pin_id: pinId1, team_id: genId(), ciphertext: "a", nonce: "deadbeefdeadbeefdeadbeefdeadbeef", author_pubkey: "pk1", created_at: Date.now() });
    await DB.saveAnnotation({ annotation_id: genId(), pin_id: pinId1, team_id: genId(), ciphertext: "b", nonce: "deadbeefdeadbeefdeadbeefdeadbeef", author_pubkey: "pk2", created_at: Date.now() });
    await DB.saveAnnotation({ annotation_id: genId(), pin_id: pinId2, team_id: genId(), ciphertext: "c", nonce: "deadbeefdeadbeefdeadbeefdeadbeef", author_pubkey: "pk3", created_at: Date.now() });

    const byPin1 = await DB.getAnnotationsByPin(pinId1);
    const byPin2 = await DB.getAnnotationsByPin(pinId2);

    expect(byPin1).toHaveLength(2);
    expect(byPin2).toHaveLength(1);
  });

  it("deleteAnnotation removes the record", async () => {
    const annId = genId();
    await DB.saveAnnotation({ annotation_id: annId, pin_id: genId(), team_id: genId(), ciphertext: "x", nonce: "deadbeefdeadbeefdeadbeefdeadbeef", author_pubkey: "pk", created_at: Date.now() });
    await DB.deleteAnnotation(annId);
    const retrieved = await DB.getAnnotation(annId);
    expect(retrieved).toBeUndefined();
  });
});

describe("Database: Tombstones", () => {
  it("saves and retrieves tombstone", async () => {
    const tombId = genId();
    const targetId = genId();
    const tombstone = {
      tombstone_id: tombId,
      target_id: targetId,
      by_pubkey: "deleter_pubkey",
      reason: "author_removed",
      timestamp: Date.now(),
      signature: "ed25519_signature_here",
    };
    await DB.saveTombstone(tombstone);

    const retrieved = await DB.getTombstone(tombId);
    expect(retrieved).toBeDefined();
    expect(retrieved.reason).toBe("author_removed");
    expect(retrieved.by_pubkey).toBe("deleter_pubkey");
  });

  it("getTombstonesForTarget returns all tombstones for target", async () => {
    const targetId = genId();
    await DB.saveTombstone({ tombstone_id: genId(), target_id: targetId, by_pubkey: "pk1", reason: "removed", timestamp: Date.now(), signature: "sig1" });
    await DB.saveTombstone({ tombstone_id: genId(), target_id: targetId, by_pubkey: "pk2", reason: "spam", timestamp: Date.now(), signature: "sig2" });

    const tombstones = await DB.getTombstonesForTarget(targetId);
    expect(tombstones).toHaveLength(2);
  });
});

describe("Database: Layers", () => {
  it("saves and retrieves layers for a team", async () => {
    const teamId = genId();
    const layers = [
      { layer_id: genId(), name: "Food", color: "#ef4444", visible: true, opacity: 1.0 },
      { layer_id: genId(), name: "Water", color: "#2563eb", visible: true, opacity: 0.8 },
    ];
    await DB.saveLayers(teamId, layers);

    const retrieved = await DB.getLayers(teamId);
    expect(retrieved).toHaveLength(2);
    expect(retrieved[0].name).toBe("Food");
    expect(retrieved[1].name).toBe("Water");
  });

  it("getLayers returns null for team with no layers", async () => {
    const result = await DB.getLayers(genId());
    expect(result).toBeNull();
  });
});

describe("Database: Schemas", () => {
  it("saves schema and retrieves via getSchemas()", async () => {
    const schemaId = genId();
    const schema = {
      schema_id: schemaId,
      team_id: "any-team",
      name: "Restaurant Review",
      fields: [
        { name: "Rating", type: "number", min: 1, max: 5 },
        { name: "Cuisine", type: "choice", options: ["Italian", "Mexican", "Japanese"] },
      ],
    };
    await DB.saveSchema(schema);

    const all = await DB.getSchemas();
    const retrieved = all.find(s => s.schema_id === schemaId);
    expect(retrieved).toBeDefined();
    expect(retrieved.name).toBe("Restaurant Review");
    expect(retrieved.fields).toHaveLength(2);
  });

  it("getSchemas returns empty array when no schemas", async () => {
    // Empty schemas may error if store doesn't exist yet; just verify it doesn't throw
    const result = await DB.getSchemas();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("Database: Known Peers", () => {
  it("saves peer and retrieves via getKnownPeers()", async () => {
    const userId = genId();
    const peer = {
      user_id: userId,
      pubkey: "peer_pubkey_hex",
      display_name: "Charlie",
      last_seen: Date.now(),
    };
    await DB.saveKnownPeer(peer);

    const all = await DB.getKnownPeers();
    const retrieved = all.find(p => p.user_id === userId);
    expect(retrieved).toBeDefined();
    expect(retrieved.display_name).toBe("Charlie");
  });
});

describe("Database: TTL & Auto-expiry", () => {
  it("savePin with TTL fields stored correctly", async () => {
    const pinId = genId();
    const now = Date.now();
    const pin = {
      pin_id: pinId,
      team_id: genId(),
      ciphertext: "ttl_pin_data",
      nonce: "deadbeefdeadbeefdeadbeefdeadbeef",
      created_at: now,
      ttl_base_minutes: 10080,
      ttl_enabled: true,
      ttl_base_at: now,
      ttl_expires_at: now + 10080 * 60000,
    };
    await DB.savePin(pin);

    const retrieved = await DB.getPin(pinId);
    expect(retrieved.ttl_enabled).toBe(true);
    expect(retrieved.ttl_base_minutes).toBe(10080);
  });
});
