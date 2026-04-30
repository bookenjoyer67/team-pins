// Matrix Widget API client
const PROXY_URL = "/auth";

let widgetReady = false;
let matrixUserId = null;
let matrixRoomId = null;
let onMatrixAuthed = null;

const params = new URLSearchParams(window.location.search);
const widgetId = params.get("widgetId") || "";

// Extract user_id and room_id from widgetId
// Element format: {room_id}_{urlEncodedUserId}_{timestamp}
// User ID always starts with @ → encoded as %40
if (widgetId) {
  const userStart = widgetId.indexOf("_%40");
  if (userStart !== -1) {
    matrixRoomId = widgetId.substring(0, userStart);
    const rest = widgetId.substring(userStart + 1);
    const tsIdx = rest.lastIndexOf("_");
    matrixUserId = decodeURIComponent(tsIdx !== -1 ? rest.substring(0, tsIdx) : rest);
  }
}

export function isMatrixWidget() { return params.has("widget") || !!widgetId; }
export function getMatrixRoomId() { return matrixRoomId; }

export function onMatrixReady(cb) {
  if (widgetReady) cb(matrixUserId, matrixRoomId);
  else onMatrixAuthed = cb;
}

function sendAction(action, data = {}, requestId = null) {
  if (!widgetId) return;
  window.parent.postMessage({
    api: "fromWidget", widgetId, action, data,
    requestId: requestId || String(Date.now()),
  }, "*");
}

async function authenticateViaProxy(openIdToken) {
  try {
    const resp = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scalar_token: openIdToken, user_id: matrixUserId }),
    });
    if (!resp.ok) throw new Error(`Proxy ${resp.status}`);
    const { access_token, user_id, room_id } = await resp.json();
    if (user_id) matrixUserId = user_id;
    if (room_id) matrixRoomId = room_id;
    return access_token;
  } catch (err) {
    console.error("Proxy auth failed:", err);
    return null;
  }
}

async function handleMessage(event) {
  const resp = event.data;
  if (!resp || !resp.response) return;
  console.log("widget received:", resp.action, resp.response);

  // OpenID token response — Element returns it in response field
  if (resp.response?.access_token) {
    console.log("got openid token, sending to proxy...");
    const supabaseToken = await authenticateViaProxy(resp.response.access_token);
    if (supabaseToken) {
      widgetReady = true;
      if (onMatrixAuthed) {
        onMatrixAuthed(matrixUserId, matrixRoomId, supabaseToken);
        onMatrixAuthed = null;
      }
    }
    return;
  }

  // Room ID response
  if (resp.response?.room_id) {
    matrixRoomId = resp.response.room_id;
    return;
  }
}

async function initWidget() {
  window.addEventListener("message", handleMessage);
  setTimeout(() => {
    sendAction("content_loaded");
    sendAction("get_openid", {});
    if (!matrixRoomId) sendAction("get_room_id", {});
  }, 300);
}

if (isMatrixWidget()) initWidget();
