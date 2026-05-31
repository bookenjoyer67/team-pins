use tracing::{info, warn};

use crate::auth;
use crate::messages;

use super::{auth_err, get_conn_pubkey, is_founder, HandlerContext};

pub async fn handle_add_member(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let member_pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
    let display_name = v.get("display_name").and_then(|n| n.as_str()).unwrap_or("");
    let role = v.get("role").and_then(|r| r.as_str()).unwrap_or("contributor");
    let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
    if cid_val.is_empty() || member_pubkey.is_empty() || sig.is_empty() { return; }
    let conn_pubkey = match get_conn_pubkey(ctx.room, ctx.cid) {
        Some(pk) => pk,
        None => { ctx.room.send_to(&auth_err("authentication required"), ctx.cid); return; }
    };
    let raw_payload = format!("{}|{}|{}|{}", cid_val, member_pubkey, role,
        v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0));
    let payload_hex = hex::encode(raw_payload.as_bytes());
    match auth::verify_signature(&payload_hex, sig, &conn_pubkey) {
        Ok(true) => {},
        _ => { ctx.room.send_to(&auth_err("invalid signature"), ctx.cid); return; }
    }
    match ctx.state.store.add_member(cid_val, crate::storage::MemberRecord {
        pubkey: member_pubkey.to_string(),
        display_name: display_name.to_string(),
        role: role.to_string(),
    }, &conn_pubkey).await {
        Ok(()) => {
            info!("[relay] member added to {}: {} ({})", cid_val, member_pubkey, role);
            let member_msg = messages::json_member_added(cid_val, member_pubkey, display_name, role);
            ctx.room.broadcast_guaranteed(&member_msg, ctx.cid, 2000).await;
            ctx.room.send_to_guaranteed(&member_msg, ctx.cid, 2000).await;
            // Push notify the new member
            if ctx.state.config.push.enabled {
                let body = format!("You've been added to {}", display_name);
                crate::push::notify_single_member(
                    ctx.state, member_pubkey,
                    "piggPin", &body, "piggpin-addmember", "/"
                ).await;
            }
        }
        Err(e) => { ctx.room.send_to(&messages::json_err(e), ctx.cid); }
    }
}

pub async fn handle_remove_member(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let target_pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
    if cid_val.is_empty() || target_pubkey.is_empty() { return; }
    let conn_pubkey = match get_conn_pubkey(ctx.room, ctx.cid) {
        Some(pk) => pk,
        None => { ctx.room.send_to(&auth_err("authentication required"), ctx.cid); return; }
    };
    let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
    let ts = v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
    if !sig.is_empty() {
        let raw_payload = format!("{}|{}|{}", cid_val, target_pubkey, ts);
        let payload_hex = hex::encode(raw_payload.as_bytes());
        if !auth::verify_signature(&payload_hex, sig, &conn_pubkey).unwrap_or(false) {
            warn!("[relay] remove_member: invalid signature from {}", conn_pubkey);
            return;
        }
    }
    match ctx.state.store.remove_member(cid_val, target_pubkey, &conn_pubkey).await {
        Ok(()) => {
            info!("[relay] member removed from {}: {}", cid_val, target_pubkey);
            let msg = messages::json_member_removed(cid_val, target_pubkey);
            ctx.room.broadcast_guaranteed(&msg, ctx.cid, 2000).await;
            ctx.room.send_to_guaranteed(&msg, ctx.cid, 2000).await;
            // Push notify the removed member
            if ctx.state.config.push.enabled {
                crate::push::notify_single_member(
                    ctx.state, target_pubkey,
                    "piggPin", "You've been removed from a map",
                    "piggpin-removemember", "/"
                ).await;
            }
        }
        Err(e) => { ctx.room.send_to(&messages::json_err(e), ctx.cid); }
    }
}

pub async fn handle_create_token(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let nonce = v.get("nonce").and_then(|n| n.as_str()).unwrap_or("");
    let role = v.get("role").and_then(|r| r.as_str()).unwrap_or("contributor");
    let expiry = v.get("expiry").and_then(|e| e.as_u64()).unwrap_or(0);
    let max_uses = std::cmp::min(v.get("max_uses").and_then(|u| u.as_u64()).unwrap_or(1), u32::MAX as u64) as u32;
    let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
    if cid_val.is_empty() || nonce.is_empty() || sig.is_empty() { return; }
    let conn_pubkey = match get_conn_pubkey(ctx.room, ctx.cid) {
        Some(pk) => pk,
        None => { ctx.room.send_to(&auth_err("authentication required"), ctx.cid); return; }
    };
    let raw_payload = format!("{}|{}|{}|{}|{}", cid_val, nonce, role, expiry, max_uses);
    let payload_hex = hex::encode(raw_payload.as_bytes());
    match auth::verify_signature(&payload_hex, sig, &conn_pubkey) {
        Ok(true) => {},
        _ => { ctx.room.send_to(&auth_err("invalid signature"), ctx.cid); return; }
    }
    match ctx.state.store.register_token(cid_val, crate::storage::InviteToken {
        nonce: nonce.to_string(),
        community_id: cid_val.to_string(),
        role: role.to_string(),
        expiry,
        max_uses,
        used_count: 0,
        created_by: conn_pubkey.clone(),
    }).await {
        Ok(()) => {
            info!("[relay] token created for {} by {}", cid_val, conn_pubkey);
            ctx.room.send_to(
                &serde_json::json!({"type":"token_created","community_id":cid_val,"nonce":nonce}).to_string(),
                ctx.cid,
            );
        }
        Err(e) => { ctx.room.send_to(&messages::json_err(e), ctx.cid); }
    }
}

pub async fn handle_claim_membership(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let member_pubkey = v.get("member_pubkey").and_then(|p| p.as_str()).unwrap_or("");
    let member_name = v.get("member_name").and_then(|n| n.as_str()).unwrap_or("");
    let nonce = v.get("nonce").and_then(|n| n.as_str()).unwrap_or("");
    let cap_sig = v.get("capability_signature").and_then(|s| s.as_str()).unwrap_or("");
    if cid_val.is_empty() || member_pubkey.is_empty() || nonce.is_empty() || cap_sig.is_empty() { return; }
    // Verify capability signature was from a founder
    let mut cap_verified = false;
    if let Some(c) = ctx.state.store.get_community(cid_val).await {
        for founder in &c.members {
            if founder.role != "founder" { continue; }
            let raw_payload = format!("{}|{}|{}", cid_val, "member", nonce);
            let payload_hex = hex::encode(raw_payload.as_bytes());
            if let Ok(true) = auth::verify_signature(&payload_hex, cap_sig, &founder.pubkey) {
                cap_verified = true;
                break;
            }
        }
    }
    if !cap_verified {
        ctx.room.send_to(&messages::json_claim_denied("invalid capability signature"), ctx.cid);
        return;
    }
    let cap_role: String;
    match ctx.state.store.claim_token(cid_val, nonce, member_pubkey).await {
        Ok(role) => { cap_role = role; }
        Err(e) => { ctx.room.send_to(&messages::json_claim_denied(e), ctx.cid); return; }
    }
    let effective_role = cap_role.clone();
    match ctx.state.store.add_member_by_token(cid_val, crate::storage::MemberRecord {
        pubkey: member_pubkey.to_string(),
        display_name: member_name.to_string(),
        role: effective_role.clone(),
    }).await {
        Ok(()) | Err("already a member") => {
            info!("[relay] membership claimed for {} in {} as {}", member_pubkey, cid_val, effective_role);
            let member_msg = messages::json_member_added(cid_val, member_pubkey, member_name, &effective_role);
            ctx.room.broadcast_guaranteed(&member_msg, ctx.cid, 2000).await;
            ctx.room.send_to_guaranteed(&member_msg, ctx.cid, 2000).await;
            ctx.room.send_to_guaranteed(&serde_json::json!({
                "type": "membership_claimed",
                "community_id": cid_val,
                "role": effective_role,
            }).to_string(), ctx.cid, 2000).await;
        }
        Err(e) => { ctx.room.send_to(&messages::json_err(e), ctx.cid); }
    }
}

pub async fn handle_update_governance(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let gov = v.get("governance").cloned().unwrap_or(serde_json::Value::Null);
    let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
    let conn_pubkey = match get_conn_pubkey(ctx.room, ctx.cid) {
        Some(pk) => pk,
        None => { ctx.room.send_to(&auth_err("authentication required"), ctx.cid); return; }
    };
    let gov_str = v.get("governance").cloned().unwrap_or(serde_json::Value::Null).to_string();
    let raw_payload = format!("{}|{}", cid_val, gov_str);
    let payload_hex = hex::encode(raw_payload.as_bytes());
    match auth::verify_signature(&payload_hex, sig, &conn_pubkey) {
        Ok(true) => {},
        _ => { ctx.room.send_to(&auth_err("invalid signature"), ctx.cid); return; }
    }
    if let Some(c) = ctx.state.store.get_community(cid_val).await {
        if !is_founder(&c, &conn_pubkey) {
            ctx.room.send_to(&auth_err("founder only"), ctx.cid);
            return;
        }
    }
    ctx.state.store.update_governance(cid_val, gov.clone()).await;
    info!("[relay] governance updated for {}", cid_val);
    let bc = serde_json::json!({
        "type": "governance_updated",
        "community_id": cid_val,
        "governance": gov,
    });
    ctx.room.broadcast_guaranteed(&bc.to_string(), ctx.cid, 2000).await;
    ctx.room.send_to_guaranteed(&bc.to_string(), ctx.cid, 2000).await;
}
