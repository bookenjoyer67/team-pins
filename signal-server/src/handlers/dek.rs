use tracing::info;

use super::{get_conn_pubkey, is_member, HandlerContext};

pub async fn handle_request_member_dek(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let member_pubkey = v.get("member_pubkey").and_then(|p| p.as_str()).unwrap_or("");
    if !cid_val.is_empty() && !member_pubkey.is_empty() {
        ctx.state.store.add_pending_dek_request(&cid_val, member_pubkey).await;
        info!("[relay] member_dek requested for {} in {}", member_pubkey, cid_val);
        let notif = serde_json::json!({
            "type": "member_dek_requested",
            "community_id": cid_val,
            "member_pubkey": member_pubkey,
        });
        ctx.room.broadcast(&notif.to_string(), ctx.cid);
        ctx.room.send_to(&notif.to_string(), ctx.cid);
    }
}

pub async fn handle_rewrap_member_dek(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let target_pubkey = v.get("target_pubkey").and_then(|p| p.as_str()).unwrap_or("");
    let rewrap_dek = v.get("rewrap_dek").and_then(|d| d.as_str()).unwrap_or("");
    if !cid_val.is_empty() && !target_pubkey.is_empty() && !rewrap_dek.is_empty() {
        // Verify sender is a member of the community
        if let Some(c) = ctx.state.store.get_community(&cid_val).await {
            let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
            if let Some(ref cpk) = conn_pubkey {
                if !is_member(&c, cpk) {
                    tracing::warn!("[relay] rewrap_member_dek: non-member {} attempted for {}", cpk, cid_val);
                    return;
                }
            } else {
                return;
            }
        }
        ctx.state.store.store_member_dek(&cid_val, target_pubkey, rewrap_dek).await;
        ctx.state.store.remove_pending_dek_request(&cid_val, target_pubkey).await;
        info!("[relay] member_dek stored for {} in {}", target_pubkey, cid_val);
        let resp = serde_json::json!({
            "type": "member_dek_ready",
            "community_id": cid_val,
            "member_pubkey": target_pubkey,
            "individually_wrapped_dek": rewrap_dek,
        });
        ctx.room.broadcast_guaranteed(&resp.to_string(), ctx.cid, 2000).await;
        ctx.room.send_to_guaranteed(&resp.to_string(), ctx.cid, 2000).await;
    }
}
