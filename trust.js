import { state } from "./state.js";

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

const ATTESTATION_WEIGHTS = {
  created: 0.5,
  confirmed: 1.0,
  disputed: -0.8,
  flagged: -1.0,
};

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

// ---- Pin-level trust from attestations ----

export function computePinTrust(pin, viewerPubkey) {
  const attestations = pin.attestations || [];
  if (attestations.length === 0) return 0;
  let score = 0;
  for (const att of attestations) {
    const weight = ATTESTATION_WEIGHTS[att.type] || 0.5;
    const trust = getTrustWeight(viewerPubkey, att.pubkey);
    score += weight * trust;
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
