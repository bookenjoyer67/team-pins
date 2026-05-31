use tracing::{info, warn};

use crate::auth;
use crate::messages;

use super::{auth_err, HandlerContext};

pub async fn handle_auth_response(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
    let challenge_hex = v.get("challenge").and_then(|c| c.as_str()).unwrap_or("");
    let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
    let challenge_ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);
    if !pubkey.is_empty() && !challenge_hex.is_empty() && !sig.is_empty() {
        let stored = ctx.room.challenges.remove(ctx.cid);
        let valid_challenge = stored.as_ref().map_or(false, |(_, (ch, ts))| {
            let now = messages::unix_millis();
            (now - ts) < 300_000 && ch == challenge_hex
        });
        if !valid_challenge {
            warn!("[relay] auth failed for {}: invalid/expired challenge", ctx.cid);
            ctx.room.send_to(&auth_err("invalid or expired challenge"), ctx.cid);
        } else {
            let raw_payload = format!("{}{}", challenge_hex, challenge_ts);
            let payload_hex = hex::encode(raw_payload.as_bytes());
            match auth::verify_signature(&payload_hex, sig, pubkey) {
                Ok(true) => {
                    if let Some(client) = ctx.room.clients.get_mut(ctx.cid) {
                        *client.pubkey.write().unwrap() = Some(pubkey.to_string());
                    }
                    ctx.room.send_to(
                        &serde_json::json!({"type":"auth_ok","pubkey":pubkey}).to_string(),
                        ctx.cid,
                    );
                    info!("[relay] client {} authenticated as {}", ctx.cid, &pubkey);
                }
                _ => {
                    warn!("[relay] auth failed for {}: invalid signature", ctx.cid);
                    ctx.room.send_to(&auth_err("invalid signature"), ctx.cid);
                }
            }
        }
    }
}
