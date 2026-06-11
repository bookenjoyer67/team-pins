import { f as compress_gzip_to_base64, h as decompress_gzip } from "./e2e_core2.js";
//#region peer.js
var defaultConfig = { iceServers: [
	{ urls: "stun:stun.freeswitch.org:3478" },
	{ urls: "stun:stun.nextcloud.com:443" },
	{
		urls: ["turns:openrelay.metered.ca:443?transport=tcp", "turns:openrelay.metered.ca:80?transport=tcp"],
		username: "openrelayproject",
		credential: "openrelayproject"
	}
] };
var connections = /* @__PURE__ */ new Map();
var customIceServers = null;
function setIceServers(servers) {
	customIceServers = servers;
}
function getConfig() {
	if (customIceServers && customIceServers.length > 0) return { iceServers: customIceServers };
	return defaultConfig;
}
var onMessage = null;
var onConnectionChange = null;
var connCounter = 0;
function setOnMessage(cb) {
	onMessage = cb;
}
function setOnConnectionChange(cb) {
	onConnectionChange = cb;
}
function isConnected() {
	return connections.size > 0;
}
function hasConnection(connId) {
	return connections.has(connId);
}
function setupDataChannel(connId, dc) {
	const conn = connections.get(connId);
	if (conn) conn.dc = dc;
	dc.onopen = () => {
		const queue = pendingIce.get(connId);
		if (queue && queue.length > 0) {
			dc.send(JSON.stringify({
				type: "_ice",
				data: queue
			}));
			pendingIce.delete(connId);
		}
		onConnectionChange?.(connId, "connected");
	};
	dc.onclose = () => {
		connections.delete(connId);
		onConnectionChange?.(connId, "disconnected");
	};
	dc.onmessage = (e) => {
		try {
			const msg = JSON.parse(e.data);
			if (msg.type === "_ice" && Array.isArray(msg.data)) {
				for (const c of msg.data) {
					const candidateStr = c?.candidate || "";
					if (/[a-f0-9\.:]+$/.test(candidateStr) && !/ (10\.|172\.1[6-9]|172\.2[0-9]|172\.3[0-1]|192\.168\.|127\.|0\.|169\.254\.|::1|f[c-d][0-9a-f]{2}|FE80|FEC0)/i.test(candidateStr)) conn?.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
				}
				return;
			}
			onMessage?.(msg, connId);
		} catch (e) {
			console.warn("[peer] bad message from", connId, e.message);
		}
	};
}
var pendingIce = /* @__PURE__ */ new Map();
function onIceCandidate(connId, e) {
	if (!e.candidate) return;
	const conn = connections.get(connId);
	if (conn && conn.dc && conn.dc.readyState === "open") conn.dc.send(JSON.stringify({
		type: "_ice",
		data: [e.candidate]
	}));
	else {
		if (!pendingIce.has(connId)) pendingIce.set(connId, []);
		pendingIce.get(connId).push(e.candidate);
	}
}
function decodeSignal(blob) {
	try {
		return JSON.parse(blob);
	} catch (_) {}
	const [type, connId, sdpB64] = blob.split("|");
	return {
		type: type === "o" ? "offer" : "answer",
		connId,
		sdp: sdpB64
	};
}
function signalSdpToDesc(signal) {
	const raw = atob(signal.sdp);
	let sdpText;
	try {
		const bytes = Uint8Array.from(raw.split("").map((c) => c.charCodeAt(0)));
		sdpText = new TextDecoder().decode(decompress_gzip(bytes));
	} catch (_) {
		sdpText = raw;
	}
	try {
		const parsed = JSON.parse(sdpText);
		if (parsed && typeof parsed === "object" && parsed.type && parsed.sdp) return parsed;
	} catch (_) {}
	return {
		type: signal.type,
		sdp: sdpText
	};
}
function compact(type, connId, sdp) {
	const b64 = compress_gzip_to_base64(new TextEncoder().encode(sdp));
	return (type === "offer" ? "o" : "a") + "|" + connId + "|" + b64;
}
function waitForEarlyIce(pc) {
	return new Promise((resolve) => {
		if (pc.iceGatheringState === "complete") {
			resolve();
			return;
		}
		const done = () => {
			clearTimeout(timer);
			pc.removeEventListener("icegatheringstatechange", check);
			resolve();
		};
		const check = () => {
			if (pc.iceGatheringState === "complete") done();
		};
		const timer = setTimeout(done, 2e3);
		pc.addEventListener("icegatheringstatechange", check);
	});
}
async function createOffer(userId, displayName, setId) {
	const connId = String(++connCounter);
	const pc = new RTCPeerConnection(getConfig());
	pc.onicecandidate = (e) => onIceCandidate(connId, e);
	const dc = pc.createDataChannel("pins");
	setupDataChannel(connId, dc);
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);
	await waitForEarlyIce(pc);
	connections.set(connId, {
		pc,
		dc,
		setId
	});
	return {
		connId,
		code: JSON.stringify({
			type: "offer",
			connId,
			sdp: btoa(JSON.stringify(pc.localDescription)),
			user_id: userId,
			display_name: displayName,
			set_id: setId
		}),
		compact: compact("offer", connId, pc.localDescription.sdp)
	};
}
async function acceptOffer(blob, userId, displayName) {
	const signal = decodeSignal(blob);
	const connId = signal.connId || String(++connCounter);
	const pc = new RTCPeerConnection(getConfig());
	pc.onicecandidate = (e) => onIceCandidate(connId, e);
	pc.ondatachannel = (e) => {
		setupDataChannel(connId, e.channel);
	};
	await pc.setRemoteDescription(signalSdpToDesc(signal));
	const answer = await pc.createAnswer();
	await pc.setLocalDescription(answer);
	await waitForEarlyIce(pc);
	connections.set(connId, {
		pc,
		dc: null,
		setId: signal.set_id || signal.setId
	});
	return {
		connId,
		setId: signal.set_id || signal.setId,
		code: JSON.stringify({
			type: "answer",
			connId,
			sdp: btoa(JSON.stringify(pc.localDescription)),
			user_id: userId,
			display_name: displayName
		}),
		compact: compact("answer", connId, pc.localDescription.sdp)
	};
}
async function finalizeConnection(connId, blob) {
	const signal = decodeSignal(blob);
	const conn = connections.get(connId);
	if (!conn) return;
	await conn.pc.setRemoteDescription(signalSdpToDesc(signal));
}
function send(msg, connId = null) {
	for (const [id, conn] of connections) {
		if (connId && id !== connId) continue;
		if (conn.dc && conn.dc.readyState === "open") conn.dc.send(JSON.stringify(msg));
	}
}
//#endregion
export { isConnected as a, setOnConnectionChange as c, hasConnection as i, setOnMessage as l, createOffer as n, send as o, finalizeConnection as r, setIceServers as s, acceptOffer as t };
