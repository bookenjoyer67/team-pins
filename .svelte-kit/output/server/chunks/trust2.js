import { B as verify, w as encode_hex } from "./e2e_core2.js";
import { t as state } from "./state.js";
//#region trust.js
function directPeers() {
	const pubkeys = /* @__PURE__ */ new Set();
	for (const peer of state.peers.values()) if (peer.userId && !peer.offline) pubkeys.add(peer.userId);
	return pubkeys;
}
function communityMembers() {
	const pubkeys = /* @__PURE__ */ new Set();
	const c = state.currentCommunity;
	if (c && c.members) for (const m of c.members) pubkeys.add(m.pubkey);
	return pubkeys;
}
function getTrustWeight(viewerPubkey, targetPubkey) {
	if (!viewerPubkey || !targetPubkey) return .1;
	if (viewerPubkey === targetPubkey) return 1;
	if (directPeers().has(targetPubkey)) return .8;
	if (communityMembers().has(targetPubkey)) return .5;
	return .1;
}
function scoreAnnotationVote(vote, viewerPubkey) {
	const trust = getTrustWeight(viewerPubkey, vote.pubkey);
	return (vote.direction === "up" ? 1 : -1) * trust;
}
function computeAnnotationScore(ann, viewerPubkey) {
	if (!ann.votes || ann.votes.length === 0) return 0;
	let sum = 0;
	for (const v of ann.votes) sum += scoreAnnotationVote(v, viewerPubkey);
	return sum;
}
function trustScoreColor(score) {
	if (score >= 2) return "#16a34a";
	if (score >= .5) return "#65a30d";
	if (score >= -.5) return "#9ca3af";
	if (score >= -2) return "#f97316";
	return "#dc2626";
}
function computePinTrust(pin, viewerPubkey) {
	const votes = pin.votes || pin.attestations || [];
	if (votes.length === 0) return 0;
	let score = 0;
	for (const v of votes) {
		const dir = v.direction === "up" ? 1 : v.type === "confirmed" ? 1 : v.type === "disputed" ? -1 : 0;
		const trust = getTrustWeight(viewerPubkey, v.pubkey);
		score += dir * trust;
	}
	return score;
}
function pinTrustIndicator(pin, viewerPubkey) {
	const score = computePinTrust(pin, viewerPubkey);
	return {
		score,
		color: trustScoreColor(score),
		level: score >= 2 ? "trusted" : score >= .5 ? "neutral" : score >= -.5 ? "low" : "disputed",
		opacity: score >= .5 ? 1 : Math.max(.2, .5 + score * .5)
	};
}
function verifyVoteSignature(pin_id, vote) {
	if (!vote.signature || !vote.pubkey || !vote.direction || !vote.timestamp) return false;
	const payload = `${pin_id}|${vote.direction}|${vote.timestamp}`;
	return verify(encode_hex(new TextEncoder().encode(payload)), vote.signature, vote.pubkey);
}
//#endregion
export { scoreAnnotationVote as a, pinTrustIndicator as i, computePinTrust as n, trustScoreColor as o, getTrustWeight as r, verifyVoteSignature as s, computeAnnotationScore as t };
