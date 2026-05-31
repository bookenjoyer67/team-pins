use tracing::info;

use crate::messages;

use super::{get_conn_pubkey, get_join_policy, is_member, HandlerContext};

pub async fn handle_sync_request(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let community_id = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    // Auth: for non-open communities, verify requester is a member
    if let Some(c) = ctx.state.store.get_community(&community_id).await {
        let jp = get_join_policy(&c.governance);
        if jp != "open" {
            let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
            if conn_pubkey.as_ref().map_or(true, |pk| !is_member(&c, pk)) {
                ctx.room.send_to(&messages::json_err("auth required"), ctx.cid);
                return;
            }
        }
    }
    let request_id = v.get("request_id").and_then(|r| r.as_str()).unwrap_or("");
    let since = v.get("since").and_then(|s| s.as_u64()).unwrap_or(0);
    let pins = ctx.state.store.get_pins(&community_id, since).await;
    let annotations = ctx.state.store.get_annotations(&community_id, since).await;
    let drawings = ctx.state.store.get_drawings(&community_id, since).await;
    let tombstones = ctx.state.store.get_tombstones(&community_id, since).await;
    let governance = ctx.state.store.get_community(&community_id).await
        .map(|c| c.governance).unwrap_or(serde_json::Value::Null);
    let resp = serde_json::json!({
        "type": "sync_delta",
        "community_id": community_id,
        "request_id": request_id,
        "since": since,
        "governance": governance,
        "pins": pins.iter().map(|p| {
            let mut j = serde_json::json!({"pin_id":p.pin_id,"ciphertext":p.ciphertext,"nonce":p.nonce,"created_at":p.created_at});
            if !p.author_pubkey.is_empty() { j["author_pubkey"] = serde_json::Value::String(p.author_pubkey.clone()); }
            if let Some(ref m) = p.media { j["media"] = m.clone(); }
            if p.posted_anonymously { j["posted_anonymously"] = serde_json::Value::Bool(true); }
            if let Some(e) = p.ttl_expires_at { j["ttl_expires_at"] = serde_json::Value::Number(e.into()); }
            if let Some(b) = p.ttl_base_at { j["ttl_base_at"] = serde_json::Value::Number(b.into()); }
            if p.vote_count_up > 0 { j["vote_count_up"] = serde_json::Value::Number(p.vote_count_up.into()); }
            if p.vote_count_down > 0 { j["vote_count_down"] = serde_json::Value::Number(p.vote_count_down.into()); }
            if let Some(ref lid) = p.layer_id { j["layer_id"] = serde_json::Value::String(lid.clone()); }
            if let Some(ref e) = p.emoji { j["emoji"] = serde_json::Value::String(e.clone()); }
            j
        }).collect::<Vec<_>>(),
        "annotations": annotations.iter().map(|a| {
            let mut j = serde_json::json!({"annotation_id":a.annotation_id,"pin_id":a.pin_id,"ciphertext":a.ciphertext,"nonce":a.nonce,"author_pubkey":a.author_pubkey,"created_at":a.created_at});
            if let Some(ref votes) = a.votes.as_array() { if !votes.is_empty() { j["votes"] = a.votes.clone(); } }
            j
        }).collect::<Vec<_>>(),
        "drawings": drawings.iter().map(|d| {
            let mut j = serde_json::json!({"drawing_id":d.drawing_id,"ciphertext":d.ciphertext,"nonce":d.nonce,"created_at":d.created_at});
            if !d.author_pubkey.is_empty() { j["author_pubkey"] = serde_json::Value::String(d.author_pubkey.clone()); }
            j
        }).collect::<Vec<_>>(),
        "tombstones": tombstones.iter().map(|t| serde_json::json!({"tombstone_id":t.tombstone_id,"target_id":t.target_id,"by_pubkey":t.by_pubkey,"timestamp":t.timestamp,"signature":t.signature})).collect::<Vec<_>>(),
    });
    info!("[relay] sync sent for {}: {} pins, {} anns, {} dwgs, {} tombstones (since {})",
        community_id, pins.len(), annotations.len(), drawings.len(), tombstones.len(), since);
    ctx.room.send_to(&resp.to_string(), ctx.cid);
}
