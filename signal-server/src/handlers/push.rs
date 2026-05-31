use tracing::info;

use crate::messages;
use crate::storage::PushSubscription;

use super::{auth_err, get_conn_pubkey, HandlerContext};

pub async fn handle_register_push_subscription(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let endpoint = v.get("endpoint").and_then(|e| e.as_str()).unwrap_or("");
    let p256dh = v.get("p256dh").and_then(|p| p.as_str()).unwrap_or("");
    let auth = v.get("auth").and_then(|a| a.as_str()).unwrap_or("");
    if endpoint.is_empty() || p256dh.is_empty() || auth.is_empty() {
        ctx.room.send_to(
            &serde_json::json!({"type":"error","reason":"missing push subscription fields (endpoint, p256dh, auth)"}).to_string(),
            ctx.cid,
        );
        return;
    }
    let conn_pubkey = match get_conn_pubkey(ctx.room, ctx.cid) {
        Some(pk) => pk,
        None => {
            ctx.room.send_to(&auth_err("authentication required"), ctx.cid);
            return;
        }
    };

    let sub = PushSubscription {
        endpoint: endpoint.to_string(),
        p256dh: p256dh.to_string(),
        auth: auth.to_string(),
        created_at: messages::unix_millis(),
    };
    ctx.state.store.add_push_subscription(&conn_pubkey, sub).await;
    let pk_short = &conn_pubkey[..usize::min(16, conn_pubkey.len())];
    info!("[relay] push subscription registered for pubkey {} endpoint {}", pk_short, endpoint);

    ctx.room.send_to(
        &serde_json::json!({"type":"push_registered"}).to_string(),
        ctx.cid,
    );
}

pub async fn handle_unregister_push_subscription(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let endpoint = v.get("endpoint").and_then(|e| e.as_str()).unwrap_or("");
    if endpoint.is_empty() {
        ctx.room.send_to(
            &serde_json::json!({"type":"error","reason":"missing endpoint"}).to_string(),
            ctx.cid,
        );
        return;
    }
    let conn_pubkey = match get_conn_pubkey(ctx.room, ctx.cid) {
        Some(pk) => pk,
        None => {
            ctx.room.send_to(&auth_err("authentication required"), ctx.cid);
            return;
        }
    };

    ctx.state.store.remove_push_subscription(&conn_pubkey, endpoint).await;
    let pk_short = &conn_pubkey[..usize::min(16, conn_pubkey.len())];
    info!("[relay] push subscription unregistered for pubkey {}", pk_short);

    ctx.room.send_to(
        &serde_json::json!({"type":"push_unregistered"}).to_string(),
        ctx.cid,
    );
}

pub async fn handle_push_info(ctx: &HandlerContext<'_>, _v: &serde_json::Value) {
    let pubkey = crate::push::get_vapid_public_key(&ctx.state.config.push);
    let msg = serde_json::json!({
        "type": "push_info",
        "enabled": ctx.state.config.push.enabled,
        "vapid_public_key": pubkey,
    });
    ctx.room.send_to(&msg.to_string(), ctx.cid);
}
