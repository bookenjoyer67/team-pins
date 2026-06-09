use std::collections::HashMap;
use std::sync::OnceLock;

use futures_util::StreamExt;
use tokio::sync::RwLock;
use tracing::{info, warn};
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo,
    VapidSignatureBuilder, WebPushClient, WebPushMessageBuilder, WebPushMessage,
};

use crate::config::PushConfig;
use crate::messages;
use crate::room::Room;
use crate::state::AppState;

static CLIENT: OnceLock<HyperWebPushClient> = OnceLock::new();
static DEBOUNCER: OnceLock<RwLock<HashMap<String, u64>>> = OnceLock::new();

fn is_stale_push_error(e: &web_push::WebPushError) -> bool {
    let s = e.to_string();
    s.contains("endpoint not valid") || s.contains("endpoint not found") || s.contains("410") || s.contains("Gone")
}

pub fn init(config: &PushConfig) -> Result<(), String> {
    if !config.enabled {
        return Ok(());
    }
    if config.vapid_private_key_pem.is_none() || config.vapid_subject.is_none() {
        return Err("push enabled but vapid_private_key_pem or vapid_subject not set".into());
    }
    let pem_bytes = config.vapid_private_key_pem.as_ref().unwrap().as_bytes();
    let dummy = SubscriptionInfo::new("https://example.com", "test", "test");
    if let Err(e) = VapidSignatureBuilder::from_pem(pem_bytes, &dummy) {
        warn!("Push: VAPID private key validation warning (push will still be attempted): {}", e);
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

#[cfg(test)]
fn base64url_decode(s: &str) -> Vec<u8> {
    let mut s = s.to_string();
    // Add padding
    while s.len() % 4 != 0 { s.push('='); }
    // URL-safe to standard
    let s = s.replace('-', "+").replace('_', "/");
    // Decode each char
    const TABLE: [i8; 128] = {
        let mut t = [-1i8; 128];
        let b64 = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0u8;
        while i < 64 { t[b64[i as usize] as usize] = i as i8; i += 1; }
        t
    };
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'=' { break; }
        let b0 = TABLE[bytes[i] as usize]; i += 1;
        if b0 < 0 || i >= bytes.len() { break; }
        let b1 = TABLE[bytes[i] as usize]; i += 1;
        if b1 < 0 { break; }
        out.push(((b0 as u8) << 2) | ((b1 as u8) >> 4));
        if i < bytes.len() && bytes[i] != b'=' {
            let b2 = TABLE[bytes[i] as usize]; i += 1;
            if b2 < 0 { break; }
            out.push(((b1 as u8) << 4) | ((b2 as u8) >> 2));
            if i < bytes.len() && bytes[i] != b'=' {
                let b3 = TABLE[bytes[i] as usize]; i += 1;
                if b3 < 0 { break; }
                out.push(((b2 as u8) << 6) | (b3 as u8));
            }
        }
    }
    out
}

/// Ensure VAPID keys exist. If not configured, auto-generate and save.
/// Sets config.vapid_private_key_pem and config.vapid_public_key in-place.
pub async fn ensure_vapid_keys(config: &mut PushConfig) -> Result<(), String> {
    ensure_vapid_keys_at(config, std::path::Path::new("vapid_keys.json")).await
}

/// Same as ensure_vapid_keys but with custom file path (for testing).
pub async fn ensure_vapid_keys_at(config: &mut PushConfig, path: impl AsRef<std::path::Path>) -> Result<(), String> {
    let path = path.as_ref();
    if !config.enabled { return Ok(()); }

    // Already configured — nothing to do
    if config.vapid_private_key_pem.is_some() && config.vapid_public_key.is_some() {
        return Ok(());
    }

    // Try to load from file
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

    // Get public key bytes (uncompressed — 65 bytes, 0x04 || x || y)
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let point = public.to_encoded_point(false); // false = uncompressed
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
        if (i + 1) % 64 == 0 { pem.push('\n'); }
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

    let payload = serde_json::json!({
        "title": title,
        "body": body,
        "tag": tag,
        "url": url,
        "icon": "/icon-192.png",
    });
    let payload_bytes = serde_json::to_vec(&payload).unwrap_or_default();

    let mut send_list: Vec<(WebPushMessage, String)> = Vec::new();

    for member in &community.members {
        if send_list.len() >= state.config.push.batch_max {
            info!("[push] batch limit reached ({}), {} remaining", state.config.push.batch_max,
                community.members.len().saturating_sub(send_list.len()));
            break;
        }
        if is_online(room, &member.pubkey) {
            continue;
        }
        let subs = state.store.get_push_subscriptions(&member.pubkey).await;
        if subs.is_empty() {
            continue;
        }

        {
            let mut debouncer = DEBOUNCER.get().unwrap().write().await;
            if let Some(&last) = debouncer.get(&member.pubkey) {
                if now.saturating_sub(last) < min_interval_ms {
                    continue;
                }
            }
            debouncer.insert(member.pubkey.clone(), now);
        }

        for sub in &subs {
            if send_list.len() >= state.config.push.batch_max { break; }
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

            match builder.build() {
                Ok(m) => { send_list.push((m, sub.endpoint.clone())); }
                Err(e) => { warn!("[push] message build failed: {}", e); }
            }
        }
    }

    if send_list.is_empty() {
        return;
    }

    let total = send_list.len();
    info!("[push] sending {} notifications concurrently for community {}", total, community_id);

    futures_util::stream::iter(send_list)
        .for_each_concurrent(10, |(message, endpoint)| async move {
            match client.send(message).await {
                Ok(_) => {
                    info!("[push] sent to {}", &endpoint[..usize::min(40, endpoint.len())]);
                }
                Err(ref e) if is_stale_push_error(e) => {
                    warn!("[push] stale endpoint (410): {}", &endpoint[..usize::min(40, endpoint.len())]);
                    state.store.remove_stale_subscription(&endpoint).await;
                }
                Err(ref e) => {
                    warn!("[push] send failed to {}: {}", &endpoint[..usize::min(40, endpoint.len())], e);
                }
            }
        })
        .await;

    info!("[push] batch complete: {} notifications dispatched", total);
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

    let mut send_list: Vec<(WebPushMessage, String)> = Vec::new();

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

        match builder.build() {
            Ok(m) => { send_list.push((m, sub.endpoint.clone())); }
            Err(e) => { warn!("[push] notify build failed: {}", e); }
        }
    }

    if send_list.is_empty() {
        return;
    }

    futures_util::stream::iter(send_list)
        .for_each_concurrent(10, |(message, endpoint)| async move {
            match client.send(message).await {
                Ok(_) => {
                    info!("[push] notify sent to {}", &endpoint[..usize::min(40, endpoint.len())]);
                }
                Err(ref e) if is_stale_push_error(e) => {
                    warn!("[push] notify stale (410): {}", &endpoint[..usize::min(40, endpoint.len())]);
                    state.store.remove_stale_subscription(&endpoint).await;
                }
                Err(ref e) => {
                    warn!("[push] notify failed to {}: {}", &endpoint[..usize::min(40, endpoint.len())], e);
                }
            }
        })
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64url_encode_roundtrip() {
        let input: Vec<u8> = (0u8..=64).collect(); // 0x00 to 0x40 (65 bytes like uncompressed point)
        let encoded = base64url_encode_bytes(&input);
        let decoded = base64url_decode(&encoded);
        assert_eq!(decoded, input, "base64url encode → decode should roundtrip");
    }

    #[test]
    fn test_base64url_encode_no_padding() {
        // 65 bytes encodes to 87 chars, no padding needed for URL-safe
        let data = vec![0xFFu8; 65];
        let enc = base64url_encode_bytes(&data);
        assert!(!enc.contains('='), "URL-safe base64 should have no padding");
    }

    #[tokio::test]
    async fn test_auto_keygen_produces_uncompressed_public_key() {
        let mut config = PushConfig::default();
        config.enabled = true;
        config.vapid_subject = Some("mailto:test@localhost".into());
        let tmp = std::env::temp_dir().join("test_vapid_keys_push.json");
        let _ = std::fs::remove_file(&tmp);

        ensure_vapid_keys_at(&mut config, &tmp).await.unwrap();

        let data = std::fs::read_to_string(&tmp).unwrap();
        let stored: serde_json::Value = serde_json::from_str(&data).unwrap();
        let pubkey_b64 = stored["public_key"].as_str().unwrap();
        let bytes = base64url_decode(pubkey_b64);

        assert_eq!(bytes.len(), 65, "uncompressed P-256 public key must be 65 bytes, got {}", bytes.len());
        assert_eq!(bytes[0], 0x04, "first byte must be 0x04 (uncompressed EC point), got 0x{:02x}", bytes[0]);

        // Also verify the PEM can be loaded
        let pem = config.vapid_private_key_pem.as_ref().unwrap();
        assert!(pem.starts_with("-----BEGIN PRIVATE KEY-----"), "PEM header wrong");
        assert!(pem.contains("-----END PRIVATE KEY-----"), "PEM footer missing");

        let _ = std::fs::remove_file(&tmp);
    }

    #[tokio::test]
    async fn test_auto_keygen_skip_if_already_configured() {
        let mut config = PushConfig::default();
        config.enabled = true;
        config.vapid_private_key_pem = Some("existing".into());
        config.vapid_public_key = Some("existing".into());

        let tmp = std::env::temp_dir().join("test_skip_keys.json");
        ensure_vapid_keys_at(&mut config, &tmp).await.unwrap();
        assert_eq!(config.vapid_private_key_pem.as_deref(), Some("existing"));
        assert_eq!(config.vapid_public_key.as_deref(), Some("existing"));
    }
}
