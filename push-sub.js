import * as Relay from "./relay.js";
import { toast } from "./dialogs.js";

let _vapidPublicKey = null;

export function isPushEnabled() {
  return localStorage.getItem("pins-push-enabled") === "true";
}

export function handlePushInfo(msg) {
  if (msg.vapid_public_key) {
    _vapidPublicKey = msg.vapid_public_key;
  }
  if (isPushEnabled()) {
    subscribeToPush();
  }
}

export async function initPushNotifications() {
  if (isPushEnabled() && _vapidPublicKey) {
    await subscribeToPush();
  }
}

async function subscribeToPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (!_vapidPublicKey) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Notification permission denied", "#f97316");
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      sendSubToRelay(subscription);
      return true;
    }

    const keyBytes = urlBase64ToUint8Array(_vapidPublicKey);
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes,
    });
    sendSubToRelay(subscription);
    toast("Notifications enabled", "#16a34a");
    return true;
  } catch (e) {
    console.warn("[push] subscribe failed:", e.message);
    toast("Push subscription failed", "#dc2626");
    return false;
  }
}

async function unsubscribeFromPush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();
    Relay.unregisterPushSubscription(subscription.endpoint);
    toast("Notifications disabled", "#9ca3af");
  }
}

function sendSubToRelay(subscription) {
  const key = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!key || !auth) return;
  const sent = Relay.registerPushSubscription(
    subscription.endpoint,
    arrayBufferToBase64(key),
    arrayBufferToBase64(auth)
  );
  if (!sent) console.warn("[push] relay not connected — subscription not sent");
}

export async function togglePush() {
  const wasOn = isPushEnabled();
  if (wasOn) {
    await unsubscribeFromPush();
    localStorage.setItem("pins-push-enabled", "false");
    return false;
  } else {
    const ok = await subscribeToPush();
    if (ok) {
      localStorage.setItem("pins-push-enabled", "true");
      return true;
    }
    return false;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
