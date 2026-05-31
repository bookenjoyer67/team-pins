use tracing::{info, warn};

use crate::auth;

use super::{auth_err, get_conn_pubkey, get_join_policy, get_member_role, HandlerContext};

pub async fn handle_pin_vote(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let pin_id = v.get("pin_id").and_then(|p| p.as_str()).unwrap_or("").to_string();
    let community_id = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let dir_val = v.get("dir").and_then(|d| d.as_i64()).unwrap_or(0);
    let dir: i8 = if dir_val == 1 { 1 } else if dir_val == -1 { -1 } else { return; };
    let pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("").to_string();
    if !pin_id.is_empty() && !pubkey.is_empty() && !community_id.is_empty() {
        let sig = v.get("signature").and_then(|s| s.as_str());
        let timestamp = v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
        match sig {
            None => {
                warn!("[relay] pin_vote denied: missing signature from {}", &pubkey);
                return;
            }
            Some(sig) => {
                let raw_payload = format!("{}|{}|{}|{}", pin_id, community_id, dir, timestamp);
                let payload_hex = hex::encode(raw_payload.as_bytes());
                if !auth::verify_signature(&payload_hex, sig, &pubkey).unwrap_or(false) {
                    warn!("[relay] pin_vote denied: invalid signature from {}", &pubkey);
                    return;
                }
            }
        }
        // Auth: verify pubkey against connection binding (required)
        let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
        if conn_pubkey.as_ref().map_or(true, |cpk| cpk != &pubkey) {
            warn!("[relay] pin_vote denied: pubkey mismatch or unauthenticated");
            ctx.room.send_to(&auth_err("pubkey mismatch"), ctx.cid);
            return;
        }
        // Auth: verify pubkey is a community member (if community exists with join_policy != "open")
        if let Some(c) = ctx.state.store.get_community(&community_id).await {
            let jp = get_join_policy(&c.governance);
            if jp != "open" && !auth::verify_membership(&c, &pubkey) {
                warn!("[relay] pin_vote denied: pubkey {} not a member", pubkey);
                return;
            }
            // Auth: readers cannot vote
            if let Some(role) = get_member_role(&c, &pubkey) {
                if role == "reader" {
                    warn!("[relay] pin_vote denied: reader {} cannot vote", &pubkey);
                    return;
                }
            }
        }
        let vote_result = ctx.state.store.record_vote(crate::storage::VoteRecord {
            pin_id: pin_id.clone(), community_id: community_id.clone(), pubkey: pubkey.clone(), dir,
        }).await;
        let (up, down, was_dup) = match vote_result {
            Some(counts) => (counts.0, counts.1, false),
            None => {
                let votes_lock = ctx.state.store.votes.read().await;
                let vote_key = format!("{}:{}", community_id, pin_id);
                let pin_votes = votes_lock.get(&vote_key).map(|v| v.as_slice()).unwrap_or(&[]);
                let up = pin_votes.iter().filter(|v| v.dir == 1).count() as u32;
                let down = pin_votes.iter().filter(|v| v.dir == -1).count() as u32;
                (up, down, true)
            }
        };
        let net_votes = up as i32 - down as i32;
        let deleted = down >= 7 && down > up;
        let ttl_expires_at = if deleted {
            0u64
        } else if let Some(c) = ctx.state.store.get_community(&community_id).await {
            let gov = c.governance;
            let base = gov.get("ttl_base_mins").and_then(|v| v.as_u64()).unwrap_or(10080) as f64;
            let vote_weight = gov.get("ttl_vote_mins").and_then(|v| v.as_u64()).unwrap_or(360) as f64;
            let min_mins = gov.get("ttl_min_mins").and_then(|v| v.as_u64()).unwrap_or(60) as f64;
            let max_mins = gov.get("ttl_max_mins").and_then(|v| v.as_u64()).unwrap_or(43200) as f64;
            let mins = (base + (net_votes as f64 * vote_weight)).clamp(min_mins, max_mins);
            let base_at = ctx.state.store.get_pin(&community_id, &pin_id).await
                .and_then(|p| p.ttl_base_at)
                .unwrap_or_else(|| std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or(std::time::Duration::from_millis(0))
                    .as_millis() as u64);
            base_at.saturating_add((mins.max(0.0).min(1_000_000_000.0) * 60_000.0) as u64)
        } else {
            0
        };
        if !was_dup {
            ctx.state.store.update_pin_ttl(&community_id, &pin_id, up, down, ttl_expires_at, deleted).await;
        }
        let bc = serde_json::json!({
            "type": "pin_vote_bc",
            "community_id": community_id,
            "pin_id": pin_id,
            "dir": dir,
            "pubkey": pubkey,
            "vote_count_up": up,
            "vote_count_down": down,
            "ttl_expires_at": ttl_expires_at,
            "deleted": deleted,
        });
        // Only broadcast to members if community restricts posting
        if let Some(c) = ctx.state.store.get_community(&community_id).await {
            let jp = get_join_policy(&c.governance);
            if jp != "open" {
                ctx.room.broadcast_to_members_guaranteed(&c, &bc.to_string(), ctx.cid, 2000).await;
            } else {
                ctx.room.broadcast_guaranteed(&bc.to_string(), ctx.cid, 2000).await;
            }
            ctx.room.send_to_guaranteed(&bc.to_string(), ctx.cid, 2000).await;
        } else {
            ctx.room.broadcast_guaranteed(&bc.to_string(), ctx.cid, 2000).await;
            ctx.room.send_to_guaranteed(&bc.to_string(), ctx.cid, 2000).await;
        }
        info!("[relay] pin_vote broadcast: up={} down={} deleted={}", up, down, deleted);
    }
}

pub async fn handle_annotation_vote(ctx: &HandlerContext<'_>, v: &serde_json::Value, txt: &str) {
    let annotation_id = v.get("annotation_id").and_then(|a| a.as_str()).unwrap_or("").to_string();
    let community_id = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    if !annotation_id.is_empty() && !community_id.is_empty() {
        let pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
        if let Some(ref sig) = v.get("signature").and_then(|s| s.as_str()) {
            let direction = v.get("direction").and_then(|d| d.as_str()).unwrap_or("");
            let timestamp = v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
            let raw_payload = format!("{}|{}|{}", annotation_id, direction, timestamp);
            let payload_hex = hex::encode(raw_payload.as_bytes());
            if !auth::verify_signature(&payload_hex, sig, pubkey).unwrap_or(false) {
                warn!("[relay] annotation_vote: invalid signature from {}", pubkey);
                return;
            }
        } else {
            warn!("[relay] annotation_vote: missing signature");
            return;
        }
        // Verify pubkey matches connection binding (required)
        let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
        if conn_pubkey.as_ref().map_or(true, |cpk| !pubkey.is_empty() && cpk != pubkey) {
            warn!("[relay] annotation_vote denied: pubkey mismatch or unauthenticated");
            return;
        }
        if let Some(c) = ctx.state.store.get_community(community_id).await {
            let jp = get_join_policy(&c.governance);
            if jp != "open" && !pubkey.is_empty() && !auth::verify_membership(&c, pubkey) {
                warn!("[relay] annotation_vote denied: pubkey {} not a member", pubkey);
                return;
            }
            // Auth: readers cannot vote
            if let Some(role) = get_member_role(&c, pubkey) {
                if role == "reader" {
                    warn!("[relay] annotation_vote denied: reader {} cannot vote", pubkey);
                    return;
                }
            }
        }
        ctx.state.store.update_annotation_vote(&annotation_id, community_id, v.clone()).await;
        info!("[relay] annotation_vote: ann={}", &annotation_id);
        ctx.room.broadcast_guaranteed(txt, ctx.cid, 2000).await;
        ctx.room.send_to_guaranteed(txt, ctx.cid, 2000).await;
    }
}
