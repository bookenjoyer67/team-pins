import { state } from "./state.js";
import { encode_hex, verify } from "./core/pkg/e2e_core.js";

function directPeers() {
  const pubkeys = new Set();
  for (const peer of state.peers.values()) {
    if (peer.userId && !peer.offline) pubkeys.add(peer.userId);
  }
  return pubkeys;
}

function communityMembers() {
  const pubkeys = new Set();
  const c = state.currentCommunity;
  if (c && c.members) {
    for (const m of c.members) pubkeys.add(m.pubkey);
  }
  return pubkeys;
}

export function getTrustWeight(viewerPubkey, targetPubkey) {
  if (!viewerPubkey || !targetPubkey) return 0.1;
  if (viewerPubkey === targetPubkey) return 1.0;
  if (directPeers().has(targetPubkey)) return 0.8;
  if (communityMembers().has(targetPubkey)) return 0.5;
  return 0.1;
}

export function scoreAnnotationVote(vote, viewerPubkey) {
  const trust = getTrustWeight(viewerPubkey, vote.pubkey);
  const dir = vote.direction === "up" ? 1 : -1;
  return dir * trust;
}

export function computeAnnotationScore(ann, viewerPubkey) {
  if (!ann.votes || ann.votes.length === 0) return 0;
  let sum = 0;
  for (const v of ann.votes) sum += scoreAnnotationVote(v, viewerPubkey);
  return sum;
}

export function sortByTrust(annotations, viewerPubkey, mode) {
  if (mode === "top") {
    return annotations.sort((a, b) => computeAnnotationScore(b, viewerPubkey) - computeAnnotationScore(a, viewerPubkey));
  }
  if (mode === "disputed") {
    return annotations.filter(a => computeAnnotationScore(a, viewerPubkey) < 0)
      .sort((a, b) => computeAnnotationScore(a, viewerPubkey) - computeAnnotationScore(b, viewerPubkey));
  }
  return annotations.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

export function trustScoreColor(score) {
  if (score >= 2) return "#16a34a";
  if (score >= 0.5) return "#65a30d";
  if (score >= -0.5) return "#9ca3af";
  if (score >= -2) return "#f97316";
  return "#dc2626";
}

// ─── Pin-level trust from votes ─────────────────────────────────────

export function computePinTrust(pin, viewerPubkey) {
  const votes = pin.votes || pin.attestations || [];
  if (votes.length === 0) return 0;
  let score = 0;
  for (const v of votes) {
    const dir = v.direction === "up" ? 1 : (v.type === "confirmed" ? 1 : v.type === "disputed" ? -1 : 0);
    const trust = getTrustWeight(viewerPubkey, v.pubkey);
    score += dir * trust;
  }
  return score;
}

export function pinTrustIndicator(pin, viewerPubkey) {
  const score = computePinTrust(pin, viewerPubkey);
  return {
    score,
    color: trustScoreColor(score),
    level: score >= 2 ? "trusted" : score >= 0.5 ? "neutral" : score >= -0.5 ? "low" : "disputed",
    opacity: score >= 0.5 ? 1.0 : Math.max(0.2, 0.5 + score * 0.5),
  };
}

// ─── Signature verification ─────────────────────────────────────────

export function verifyVoteSignature(pin_id, vote) {
  if (!vote.signature || !vote.pubkey || !vote.direction || !vote.timestamp) return false;
  const payload = `${pin_id}|${vote.direction}|${vote.timestamp}`;
  const hexPayload = encode_hex(new TextEncoder().encode(payload));
  return verify(hexPayload, vote.signature, vote.pubkey);
}

// ─── Migration from old attestations to new votes/flags ─────────────

export function migrateAttestationsToVotes(pin) {
  if (!pin.attestations || pin.attestations.length === 0) return;
  const votes = pin.votes || [];
  const flags = pin.flags || [];
  const seenVotes = new Set(votes.map(v => v.pubkey));
  const seenFlags = new Set(flags.map(f => f.pubkey));

  for (const att of pin.attestations) {
    if (att.type === "confirmed" && !seenVotes.has(att.pubkey)) {
      votes.push({ direction: "up", pubkey: att.pubkey, timestamp: att.timestamp, signature: att.signature || "" });
      seenVotes.add(att.pubkey);
    } else if (att.type === "disputed" && !seenVotes.has(att.pubkey)) {
      votes.push({ direction: "down", pubkey: att.pubkey, timestamp: att.timestamp, signature: att.signature || "" });
      seenVotes.add(att.pubkey);
    } else if (att.type === "flagged" && !seenFlags.has(att.pubkey)) {
      flags.push({ pubkey: att.pubkey, timestamp: att.timestamp, signature: att.signature || "" });
      seenFlags.add(att.pubkey);
    }
  }

  pin.votes = votes;
  pin.flags = flags;
  delete pin.attestations;
}
