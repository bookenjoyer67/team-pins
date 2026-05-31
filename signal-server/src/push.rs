use std::collections::HashMap;
use std::sync::OnceLock;

use tokio::sync::RwLock;
use tracing::{info, warn};
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo,
    VapidSignatureBuilder, WebPushClient, WebPushMessageBuilder,
};

use crate::config::PushConfig;
use crate::messages;
use crate::room::Room;
use crate::state::AppState;

static CLIENT: OnceLock<HyperWebPushClient> = OnceLock::new();
static DEBOUNCER: OnceLock<RwLock<HashMap<String, u64>>> = OnceLock::new();

pub fn init(config: &PushConfig) -> Result<(), String> {
    if !config.enabled {
        return Ok(());
    }
    if config.vapid_private_key_pem.is_none() || config.vapid_subject.is_none() {
        return Err("push enabled but vapid_private_key_pem or vapid_subject not set".into());
    }
    let client = HyperWebPushClient::new();
    CLIENT.set(client).map_err(|_| "push already initialized".to_string())?;
    DEBOUNCER.set(RwLock::new(HashMap::new())).ok();
    info!("Push notifications initialized");
    Ok(())
}

/// Get the VAPID public key from config.
pub fn get_vapid_public_key(config: &PushConfig) -> Option<String> {
    if !config.enabled { return None; }
    config.vapid_public_key.clone()
}

fn base64url_encode_bytes(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 { out.push(TABLE[((n >> 6) & 63) as usize] as char); }
        if chunk.len() > 2 { out.push(TABLE[(n & 63) as usize] as char); }
    }
    out
}

/// Ensure VAPID keys exist. If not configured, auto-generate and save.
/// Sets config.vapid_private_key_pem and config.vapid_public_key in-place.
pub async fn ensure_vapid_keys(config: &mut PushConfig) -> Result<(), String> {
    if !config.enabled { return Ok(()); }

    // Already configured — nothing to do
    if config.vapid_private_key_pem.is_some() && config.vapid_public_key.is_some() {
        return Ok(());
    }

    // Try to load from vapid_keys.json
    let path = std::path::Path::new("vapid_keys.json");
    if let Ok(data) = std::fs::read_to_string(path) {
        if let Ok(stored) = serde_json::from_str::<serde_json::Value>(&data) {
            if let (Some(pem), Some(pubkey)) = (
                stored.get("private_key_pem").and_then(|v| v.as_str()),
                stored.get("public_key").and_then(|v| v.as_str()),
            ) {
                config.vapid_private_key_pem = Some(pem.to_string());
                config.vapid_public_key = Some(pubkey.to_string());
                info!("Push: loaded VAPID keys from {}", path.display());
                return Ok(());
            }
        }
    }

    // Auto-generate
    use p256::SecretKey;
    use rand_core::OsRng;

    let secret = SecretKey::random(&mut OsRng);
    let public = secret.public_key();

    // Get public key bytes via EncodedPoint
    let point = p256::EncodedPoint::from(&public);
    let pubkey_str = base64url_encode_bytes(point.as_bytes());

    // Encode private key as PKCS#8 PEM
    let pkcs8_der = p256::elliptic_curve::pkcs8::EncodePrivateKey::to_pkcs8_der(&secret)
        .map_err(|e| format!("VAPID key encode: {}", e))?;
    let b64 = {
        let raw = pkcs8_der.as_bytes();
        const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut s = String::new();
        for chunk in raw.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
            let n = (b0 << 16) | (b1 << 8) | b2;
            s.push(B64[((n >> 18) & 63) as usize] as char);
            s.push(B64[((n >> 12) & 63) as usize] as char);
            if chunk.len() > 1 { s.push(B64[((n >> 6) & 63) as usize] as char); }
            if chunk.len() > 2 { s.push(B64[(n & 63) as usize] as char); }
        }
        s
    };
    let mut pem = String::from("-----BEGIN PRIVATE KEY-----\n");
    for (i, c) in b64.chars().enumerate() {
        pem.push(c);
        if i + 1 % 64 == 0 { pem.push('\n'); }
    }
    if !b64.is_empty() && b64.len() % 64 != 0 { pem.push('\n'); }
    pem.push_str("-----END PRIVATE KEY-----\n");

    let json = serde_json::json!({
        "private_key_pem": pem,
        "public_key": pubkey_str,
    });

    std::fs::write(path, serde_json::to_string_pretty(&json).unwrap_or_default())
        .map_err(|e| format!("cannot write vapid_keys.json: {}", e))?;

    config.vapid_private_key_pem = Some(pem);
    config.vapid_public_key = Some(pubkey_str);

    info!("Push: auto-generated VAPID keys → {}", path.display());
    Ok(())
}

/// Check if a pubkey is currently connected to the community-relay room.
fn is_online(room: &Room, pubkey: &str) -> bool {
    room.clients.iter().any(|entry| {
        entry.value().pubkey.read().unwrap().as_deref() == Some(pubkey)
    })
}

/// Send a push notification to all offline members of a community.
pub async fn send_push_to_offline_members(
    state: &AppState,
    room: &Room,
    community_id: &str,
    title: &str,
    body: &str,
    tag: &str,
    url: &str,
) {
    if !state.config.push.enabled {
        return;
    }
    let client = match CLIENT.get() {
        Some(c) => c,
        None => { warn!("[push] client not initialized"); return; }
    };
    let community = match state.store.get_community(community_id).await {
        Some(c) => c,
        None => return,
    };
    let now = messages::unix_millis();
    let min_interval_ms = state.config.push.min_interval_secs * 1000;
    let pem = match state.config.push.vapid_private_key_pem.as_ref() {
        Some(p) => p.as_bytes(),
        None => { warn!("[push] VAPID key not set"); return; }
    };
    let subject = state.config.push.vapid_subject.as_deref().unwrap_or("mailto:admin@example.com");

    let mut sent = 0usize;
    for member in &community.members {
        if sent >= state.config.push.batch_max {
            info!("[push] batch limit reached ({}), {} remaining", state.config.push.batch_max,
                community.members.len().saturating_sub(sent));
            break;
        }
        // Skip online members — they get the data via WebSocket
        if is_online(room, &member.pubkey) {
            continue;
        }
        let subs = state.store.get_push_subscriptions(&member.pubkey).await;
        if subs.is_empty() {
            continue;
        }

        // Debounce: skip if pushed recently
        let mut debouncer = DEBOUNCER.get().unwrap().write().await;
        if let Some(&last) = debouncer.get(&member.pubkey) {
            if now.saturating_sub(last) < min_interval_ms {
                continue;
            }
        }

        let payload = serde_json::json!({
            "title": title,
            "body": body,
            "tag": tag,
            "url": url,
            "icon": "/icon-192.png",
        });
        let payload_bytes = serde_json::to_vec(&payload).unwrap_or_default();

        for sub in &subs {
            if sent >= state.config.push.batch_max { break; }
            let sub_info = SubscriptionInfo::new(
                sub.endpoint.as_str(),
                sub.p256dh.as_str(),
                sub.auth.as_str(),
            );

            let mut builder = WebPushMessageBuilder::new(&sub_info);
            let _ = builder.set_payload(ContentEncoding::Aes128Gcm, &payload_bytes);
            builder.set_ttl(86400);

            let vapid = match VapidSignatureBuilder::from_pem(pem, &sub_info) {
                Ok(mut sig_builder) => {
                    sig_builder.add_claim("sub", subject);
                    match sig_builder.build() {
                        Ok(sig) => sig,
                        Err(e) => { warn!("[push] VAPID signature failed: {}", e); continue; }
                    }
                }
                Err(e) => { warn!("[push] VAPID builder failed: {}", e); continue; }
            };
            builder.set_vapid_signature(vapid);

            let message = match builder.build() {
                Ok(m) => m,
                Err(e) => { warn!("[push] message build failed: {}", e); continue; }
            };

            match client.send(message).await {
                Ok(_) => {
                    sent += 1;
                    debouncer.insert(member.pubkey.clone(), now);
                    info!("[push] sent to {} ({}), total sent: {}", &member.pubkey[..usize::min(16, member.pubkey.len())], &sub.endpoint[..usize::min(40, sub.endpoint.len())], sent);
                }
                Err(ref e) if e.to_string().contains("410") || e.to_string().contains("Gone") => {
                    warn!("[push] stale endpoint (410): {}", &sub.endpoint[..usize::min(40, sub.endpoint.len())]);
                    state.store.remove_stale_subscription(&sub.endpoint).await;
                }
                Err(e) => {
                    warn!("[push] send failed to {}: {}", &sub.endpoint[..usize::min(40, sub.endpoint.len())], e);
                }
            }
        }
        drop(debouncer);
    }
}

/// Send a push notification to a single specific member pubkey (for add/remove member).
pub async fn notify_single_member(
    state: &AppState,
    pubkey: &str,
    title: &str,
    body: &str,
    tag: &str,
    url: &str,
) {
    if !state.config.push.enabled {
        return;
    }
    let client = match CLIENT.get() {
        Some(c) => c,
        None => { warn!("[push] client not initialized"); return; }
    };
    let subs = state.store.get_push_subscriptions(pubkey).await;
    if subs.is_empty() {
        return;
    }
    let pem = match state.config.push.vapid_private_key_pem.as_ref() {
        Some(p) => p.as_bytes(),
        None => { warn!("[push] VAPID key not set"); return; }
    };
    let subject = state.config.push.vapid_subject.as_deref().unwrap_or("mailto:admin@example.com");

    let payload = serde_json::json!({
        "title": title,
        "body": body,
        "tag": tag,
        "url": url,
        "icon": "/icon-192.png",
    });
    let payload_bytes = serde_json::to_vec(&payload).unwrap_or_default();

    for sub in &subs {
        let sub_info = SubscriptionInfo::new(
            sub.endpoint.as_str(),
            sub.p256dh.as_str(),
            sub.auth.as_str(),
        );
        let mut builder = WebPushMessageBuilder::new(&sub_info);
        let _ = builder.set_payload(ContentEncoding::Aes128Gcm, &payload_bytes);
        builder.set_ttl(86400);

        let vapid = match VapidSignatureBuilder::from_pem(pem, &sub_info) {
            Ok(mut sig_builder) => {
                sig_builder.add_claim("sub", subject);
                match sig_builder.build() {
                    Ok(sig) => sig,
                    Err(e) => { warn!("[push] notify VAPID sig failed: {}", e); continue; }
                }
            }
            Err(e) => { warn!("[push] notify VAPID builder failed: {}", e); continue; }
        };
        builder.set_vapid_signature(vapid);

        let message = match builder.build() {
            Ok(m) => m,
            Err(e) => { warn!("[push] notify build failed: {}", e); continue; }
        };
        match client.send(message).await {
            Ok(_) => {
                info!("[push] notify sent to {}", &sub.endpoint[..usize::min(40, sub.endpoint.len())]);
            }
            Err(ref e) if e.to_string().contains("410") || e.to_string().contains("Gone") => {
                warn!("[push] notify stale (410): {}", &sub.endpoint[..usize::min(40, sub.endpoint.len())]);
                state.store.remove_stale_subscription(&sub.endpoint).await;
            }
            Err(e) => {
                warn!("[push] notify failed: {}", e);
            }
        }
    }
}
