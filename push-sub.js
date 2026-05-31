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
  if (isPushEnabled()) {
    subscribeToPush();
  }
}

async function subscribeToPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (!_vapidPublicKey) return;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Notification permission denied", "#f97316");
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      sendSubToRelay(subscription);
      return;
    }

    const keyBytes = urlBase64ToUint8Array(_vapidPublicKey);
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes,
    });
    sendSubToRelay(subscription);
    toast("Notifications enabled", "#16a34a");
  } catch (e) {
    console.warn("[push] subscribe failed:", e.message);
    toast("Push subscription failed", "#dc2626");
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
  Relay.registerPushSubscription(
    subscription.endpoint,
    arrayBufferToBase64(key),
    arrayBufferToBase64(auth)
  );
}

export async function togglePush() {
  const on = !isPushEnabled();
  localStorage.setItem("pins-push-enabled", on ? "true" : "false");
  if (on) {
    await subscribeToPush();
  } else {
    await unsubscribeFromPush();
  }
  return on;
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
