import { I as verify, x as encode_hex } from "./e2e_core2.js";
import "./state.js";
//#region trust.js
function verifyVoteSignature(pin_id, vote) {
	if (!vote.signature || !vote.pubkey || !vote.direction || !vote.timestamp) return false;
	const payload = `${pin_id}|${vote.direction}|${vote.timestamp}`;
	return verify(encode_hex(new TextEncoder().encode(payload)), vote.signature, vote.pubkey);
}
//#endregion
export { verifyVoteSignature };
