use tracing::{info, warn};

use crate::storage::MemberRecord;

use super::{auth_err, get_conn_pubkey, is_founder, HandlerContext};

pub async fn handle_publish_community(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
    let mut allowed = false;
    if let Some(ref pk) = conn_pubkey {
        if let Some(c) = ctx.state.store.get_community(&cid_val).await {
            if is_founder(&c, pk) { allowed = true; }
        }
    }
    if !allowed {
        warn!("[relay] publish_community denied: not founder");
        ctx.room.send_to(&auth_err("founder only"), ctx.cid);
        return;
    }
    ctx.state.store.set_published(&cid_val, true).await;
    info!("[relay] community published: {}", cid_val);
    ctx.room.send_to(
        &serde_json::json!({"type":"community_published","community_id":cid_val}).to_string(),
        ctx.cid,
    );
}

pub async fn handle_unpublish_community(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
    let mut allowed = false;
    if let Some(ref pk) = conn_pubkey {
        if let Some(c) = ctx.state.store.get_community(&cid_val).await {
            if is_founder(&c, pk) { allowed = true; }
        }
    }
    if !allowed {
        warn!("[relay] unpublish_community denied: not founder");
        ctx.room.send_to(&auth_err("founder only"), ctx.cid);
        return;
    }
    ctx.state.store.set_published(&cid_val, false).await;
    info!("[relay] community unpublished: {}", cid_val);
    ctx.room.send_to(
        &serde_json::json!({"type":"community_unpublished","community_id":cid_val}).to_string(),
        ctx.cid,
    );
}

pub async fn handle_register_community(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    if cid_val.is_empty() { return; }
    let is_re_registration = ctx.state.store.get_community(cid_val).await.is_some();
    if !is_re_registration {
        let mut rl = ctx.state.rl.lock().await;
        if !rl.check_community_reg(ctx.ip) {
            warn!("[relay] community registration rate-limited for {}", ctx.ip);
            return;
        }
    }
    let name = v.get("name").and_then(|c| c.as_str()).unwrap_or("").to_string();
    if name.len() > 128 { return; }
    let genesis = v.get("genesis_public_key").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let members = v.get("members").and_then(|m| m.as_array()).map(|arr| {
        arr.iter().filter_map(|m| {
            Some(crate::storage::MemberRecord {
                pubkey: m.get("pubkey")?.as_str()?.to_string(),
                display_name: m.get("display_name")?.as_str()?.to_string(),
                role: m.get("role")?.as_str()?.to_string(),
            })
        }).collect::<Vec<_>>()
    }).unwrap_or_default();
    if members.len() > 1000 { return; }
    let cid_owned = cid_val.to_string();
    let published = v.get("published").and_then(|p| p.as_bool()).unwrap_or(false);
    let visibility = v.get("visibility").and_then(|p| p.as_str()).unwrap_or("public").to_string();
    let public_key = v.get("public_key").and_then(|p| p.as_str()).unwrap_or("").to_string();
    let wrapped_dek = v.get("wrapped_dek").and_then(|w| w.as_str()).unwrap_or("").to_string();
    let key_derivation = v.get("key_derivation").and_then(|k| k.as_str()).unwrap_or("random").to_string();
    let description = v.get("description").and_then(|d| d.as_str()).unwrap_or("").to_string();
    if description.len() > 4096 { return; }
    let owner_pubkey = v.get("owner_pubkey").and_then(|o| o.as_str()).unwrap_or("").to_string();
    let owner_name = v.get("owner_name").and_then(|o| o.as_str()).unwrap_or("").to_string();
    let bounds = v.get("bounds").and_then(|b| b.as_array()).map(|arr| {
        arr.iter().filter_map(|v| v.as_f64()).collect::<Vec<f64>>()
    });
    let password_hash = v.get("password_hash").and_then(|p| p.as_str()).map(|s| s.to_string());
    let join_wrapped_dek = v.get("join_wrapped_dek").and_then(|j| j.as_str()).map(|s| s.to_string());
    ctx.state.store.register_community(crate::storage::CommunityConfig {
        community_id: cid_owned.clone(), name: name.clone(),
        genesis_public_key: genesis,
        public_key, secret_key: String::new(), wrapped_dek, key_derivation,
        published, visibility,
        description,
        owner_pubkey: owner_pubkey.clone(),
        members,
        governance: v.get("governance").cloned().unwrap_or(serde_json::Value::Null),
        bounds,
        password_hash,
        join_wrapped_dek,
        used_token_nonces: vec![],
    }).await;
    info!("[relay] community registered: {} (published: {})", name, published);
    ctx.room.send_to_guaranteed(
        &serde_json::json!({"type":"community_registered","community_id":cid_owned}).to_string(),
        ctx.cid,
        2000,
    ).await;
    ctx.room.broadcast_guaranteed(&serde_json::json!({
        "type": "community_peer_joined",
        "community_id": cid_owned,
        "pubkey": owner_pubkey,
        "name": owner_name,
        "governance": v.get("governance").cloned().unwrap_or(serde_json::Value::Null),
    }).to_string(), ctx.cid, 2000).await;
}

pub async fn handle_delete_community(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let community = ctx.state.store.get_community(&cid_val).await;
    let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
    let authorized = match (&community, &conn_pubkey) {
        (Some(c), Some(pk)) => c.owner_pubkey == *pk || is_founder(c, pk),
        _ => false,
    };
    if !authorized {
        warn!("[relay] delete_community denied: unauthorized for {}", cid_val);
        ctx.room.send_to(
            &serde_json::json!({"type":"error","reason":"unauthorized"}).to_string(),
            ctx.cid,
        );
        return;
    }
    ctx.state.store.delete_community(&cid_val).await;
    info!("[relay] community deleted: {}", cid_val);
    let notif = serde_json::json!({"type":"community_deleted","community_id":cid_val}).to_string();
    if let Some(ref c) = community {
        ctx.room.broadcast_to_members(c, &notif, ctx.cid);
    } else {
        ctx.room.broadcast_guaranteed(&notif, ctx.cid, 2000).await;
    }
}

pub async fn handle_join_community(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let request_id = v.get("request_id").and_then(|r| r.as_str()).unwrap_or("");
    if let Some(mut c) = ctx.state.store.get_community(&cid_val).await {
        let mut denied = false;
        if let Some(ref stored_hash) = c.password_hash {
            let provided_hash = v.get("password_hash").and_then(|p| p.as_str()).unwrap_or("");
            if provided_hash != stored_hash {
                info!("[relay] join_community denied (wrong password): {} -> {}", ctx.ip, c.name);
                ctx.room.send_to(
                    &serde_json::json!({"type":"community_joined","community_id":cid_val,"error":"wrong_password","request_id":request_id}).to_string(),
                    ctx.cid,
                );
                denied = true;
            }
        }
        if !denied {
            info!("[relay] join_community: {} -> {}", ctx.ip, c.name);
            let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
            // Auto-add joining user as a member so they receive push notifications
            let mut is_mbr = conn_pubkey.as_ref().map_or(false, |pk| c.members.iter().any(|m| m.pubkey == *pk));
            if !is_mbr {
                if let Some(ref pk) = conn_pubkey {
                    let name = v.get("display_name").and_then(|n| n.as_str()).unwrap_or("");
                    ctx.state.store.ensure_member(&cid_val, pk, name, "contributor").await;
                    c.members.push(MemberRecord {
                        pubkey: pk.clone(),
                        display_name: name.to_string(),
                        role: "contributor".to_string(),
                    });
                    info!("[relay] auto-added member {} to community {}", pk, c.name);
                    is_mbr = true;
                }
            }
            let members_for_response: serde_json::Value =
                serde_json::json!(c.members.iter().map(|m| serde_json::json!({
                    "pubkey": m.pubkey,
                    "display_name": m.display_name,
                    "role": m.role,
                })).collect::<Vec<_>>());
            let public_layers = ctx.state.store.get_public_layers(&cid_val).await;
            let member_dek = if let Some(ref pk) = conn_pubkey {
                ctx.state.store.get_member_dek(&cid_val, pk).await
            } else { None };
            let resp = serde_json::json!({
                "type": "community_joined",
                "community_id": c.community_id,
                "request_id": request_id,
                "name": c.name,
                "description": c.description,
                "visibility": c.visibility,
                "public_key": c.public_key,
                "wrapped_dek": c.wrapped_dek,
                "key_derivation": c.key_derivation,
                "needs_key_exchange": c.key_derivation != "pbkdf2",
                "individually_wrapped_dek": member_dek.as_ref().map(|d| d.individually_wrapped_dek.as_str()).unwrap_or(""),
                "join_wrapped_dek": c.join_wrapped_dek.as_deref().unwrap_or(""),
                "genesis_public_key": c.genesis_public_key,
                "governance": c.governance,
                "bounds": c.bounds,
                "member_count": c.members.len(),
                "members": members_for_response,
                "public_layers": public_layers.iter().map(|l| serde_json::json!({
                    "layer_id": l.layer_id,
                    "name": l.name,
                    "layer_dek_wrapped": l.layer_dek_wrapped,
                    "topic_tags": l.topic_tags,
                })).collect::<Vec<_>>(),
                "your_membership": if is_mbr { if let Some(ref pk) = conn_pubkey {
                    c.members.iter().find(|m| m.pubkey == *pk)
                        .map(|m| serde_json::json!({"pubkey": m.pubkey, "display_name": m.display_name, "role": m.role}))
                } else { None } } else { None },
            });
            ctx.room.send_to_guaranteed(&resp.to_string(), ctx.cid, 2000).await;
        }
    }
}
