use tracing::{info, warn};

use crate::messages;

use super::{auth_err, get_conn_pubkey, is_founder, HandlerContext};

pub async fn handle_publish_layer(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let layer_id = v.get("layer_id").and_then(|l| l.as_str()).unwrap_or("");
    let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
    let topic_tags: Vec<String> = v.get("topic_tags").and_then(|t| t.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let layer_dek_wrapped = v.get("layer_dek_wrapped").and_then(|d| d.as_str()).unwrap_or("").to_string();
    if cid_val.is_empty() || layer_id.is_empty() || name.is_empty() { return; }
    let conn_pubkey = match get_conn_pubkey(ctx.room, ctx.cid) {
        Some(pk) => pk,
        None => { ctx.room.send_to(&auth_err("authentication required"), ctx.cid); return; }
    };
    if let Some(c) = ctx.state.store.get_community(cid_val).await {
        if !is_founder(&c, &conn_pubkey) {
            ctx.room.send_to(&auth_err("founder only"), ctx.cid); return;
        }
    }
    ctx.state.store.publish_layer(crate::storage::PublicLayer {
        layer_id: layer_id.to_string(),
        community_id: cid_val.to_string(),
        name: name.clone(),
        topic_tags,
        layer_dek_wrapped,
        published_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::from_millis(0))
            .as_millis() as u64,
        published_by: conn_pubkey.clone(),
    }).await;
    info!("[relay] layer published: {} in {}", name, cid_val);
    let bc = serde_json::json!({
        "type": "layer_published",
        "community_id": cid_val,
        "layer_id": layer_id,
        "name": name,
    });
    ctx.room.broadcast_guaranteed(&bc.to_string(), ctx.cid, 2000).await;
    ctx.room.send_to_guaranteed(&bc.to_string(), ctx.cid, 2000).await;
}

pub async fn handle_unpublish_layer(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let layer_id = v.get("layer_id").and_then(|l| l.as_str()).unwrap_or("");
    if cid_val.is_empty() || layer_id.is_empty() { return; }
    let conn_pubkey = match get_conn_pubkey(ctx.room, ctx.cid) {
        Some(pk) => pk,
        None => { ctx.room.send_to(&auth_err("authentication required"), ctx.cid); return; }
    };
    if let Some(c) = ctx.state.store.get_community(cid_val).await {
        if !is_founder(&c, &conn_pubkey) {
            ctx.room.send_to(&auth_err("founder only"), ctx.cid); return;
        }
    }
    ctx.state.store.unpublish_layer(cid_val, layer_id).await;
    info!("[relay] layer unpublished: {} from {}", layer_id, cid_val);
    let bc = serde_json::json!({
        "type": "layer_unpublished",
        "community_id": cid_val,
        "layer_id": layer_id,
    });
    ctx.room.broadcast(&bc.to_string(), ctx.cid);
    ctx.room.send_to(&bc.to_string(), ctx.cid);
}

pub async fn handle_list_public_layers(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    if cid_val.is_empty() { return; }
    let layers = ctx.state.store.get_public_layers(cid_val).await;
    let resp = serde_json::json!({
        "type": "public_layers_list",
        "community_id": cid_val,
        "layers": layers.iter().map(|l| serde_json::json!({
            "layer_id": l.layer_id,
            "name": l.name,
            "topic_tags": l.topic_tags,
            "published_at": l.published_at,
        })).collect::<Vec<_>>(),
    });
    ctx.room.send_to(&resp.to_string(), ctx.cid);
}

pub async fn handle_subscribe_layer(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let layer_id = v.get("layer_id").and_then(|l| l.as_str()).unwrap_or("");
    let subscriber_pubkey = v.get("subscriber_pubkey").and_then(|p| p.as_str()).unwrap_or("");
    if cid_val.is_empty() || layer_id.is_empty() || subscriber_pubkey.is_empty() { return; }
    // Verify subscriber_pubkey matches authenticated connection
    let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);
    if let Some(ref cpk) = conn_pubkey {
        if cpk != subscriber_pubkey {
            warn!("[relay] subscribe_layer: pubkey mismatch (conn={} sub={})", cpk, subscriber_pubkey);
            return;
        }
    }
    // Get the layer DEK
    let public_layers = ctx.state.store.get_public_layers(cid_val).await;
    let layer = match public_layers.iter().find(|l| l.layer_id == layer_id) {
        Some(l) => l.clone(),
        None => { ctx.room.send_to(&messages::json_err("layer not found"), ctx.cid); return; }
    };
    // Check governance allows subscriptions
    if let Some(c) = ctx.state.store.get_community(cid_val).await {
        let allowed = c.governance.get("public_subscriptions")
            .and_then(|v| v.as_str()).unwrap_or("off") == "anyone";
        if !allowed {
            ctx.room.send_to(&messages::json_err("subscriptions not allowed"), ctx.cid); return;
        }
    }
    // Add subscription
    match ctx.state.store.add_subscription(crate::storage::LayerSubscription {
        community_id: cid_val.to_string(),
        layer_id: layer_id.to_string(),
        subscriber_pubkey: subscriber_pubkey.to_string(),
        subscribed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::from_millis(0))
            .as_millis() as u64,
    }).await {
        Ok(()) => {},
        Err(e) => { ctx.room.send_to(&messages::json_err(e), ctx.cid); return; }
    }
    // Get initial layer data (filtered to this layer)
    let all_pins = ctx.state.store.get_pins(cid_val, 0).await;
    let pins: Vec<_> = all_pins.into_iter()
        .filter(|p| p.layer_id.as_deref() == Some(&layer_id))
        .collect();
    let drawings = ctx.state.store.get_drawings(cid_val, 0).await;
    info!("[relay] subscribed {} to layer {}:{}", subscriber_pubkey, cid_val, layer_id);
    let resp = serde_json::json!({
        "type": "layer_subscribed",
        "community_id": cid_val,
        "layer_id": layer_id,
        "layer_name": layer.name,
        "layer_dek_wrapped": layer.layer_dek_wrapped,
        "pins": pins.iter().map(|p| {
            serde_json::json!({"pin_id":p.pin_id,"ciphertext":p.ciphertext,"nonce":p.nonce,"author_pubkey":p.author_pubkey,"created_at":p.created_at})
        }).collect::<Vec<_>>(),
        "drawings": drawings.iter().map(|d| {
            serde_json::json!({"drawing_id":d.drawing_id,"ciphertext":d.ciphertext,"nonce":d.nonce,"author_pubkey":d.author_pubkey,"created_at":d.created_at})
        }).collect::<Vec<_>>(),
    });
    ctx.room.send_to_guaranteed(&resp.to_string(), ctx.cid, 2000).await;
}

pub async fn handle_unsubscribe_layer(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
    let layer_id = v.get("layer_id").and_then(|l| l.as_str()).unwrap_or("");
    let subscriber_pubkey = v.get("subscriber_pubkey").and_then(|p| p.as_str()).unwrap_or("");
    if cid_val.is_empty() || layer_id.is_empty() || subscriber_pubkey.is_empty() { return; }
    ctx.state.store.remove_subscription(cid_val, layer_id, subscriber_pubkey).await;
    info!("[relay] unsubscribed {} from layer {}:{}", subscriber_pubkey, cid_val, layer_id);
    let resp = serde_json::json!({
        "type": "layer_unsubscribed",
        "community_id": cid_val,
        "layer_id": layer_id,
    });
    ctx.room.send_to(&resp.to_string(), ctx.cid);
}

pub async fn handle_sync_subscribed_layers(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let subscriber_pubkey = v.get("subscriber_pubkey").and_then(|p| p.as_str()).unwrap_or("");
    if subscriber_pubkey.is_empty() { return; }
    let since = v.get("since").and_then(|s| s.as_u64()).unwrap_or(0);
    let subscribed = ctx.state.store.get_subscribed_layers_for_pubkey(subscriber_pubkey).await;
    let mut all_pins: Vec<serde_json::Value> = Vec::new();
    let mut all_drawings: Vec<serde_json::Value> = Vec::new();
    for (cid, _lid) in &subscribed {
        for p in ctx.state.store.get_pins(cid, since).await {
            all_pins.push(serde_json::json!({"pin_id":p.pin_id,"community_id":cid,"ciphertext":p.ciphertext,"nonce":p.nonce,"author_pubkey":p.author_pubkey,"created_at":p.created_at}));
        }
        for d in ctx.state.store.get_drawings(cid, since).await {
            all_drawings.push(serde_json::json!({"drawing_id":d.drawing_id,"community_id":cid,"ciphertext":d.ciphertext,"nonce":d.nonce,"author_pubkey":d.author_pubkey,"created_at":d.created_at}));
        }
    }
    let resp = serde_json::json!({
        "type": "subscribed_sync",
        "since": since,
        "pins": all_pins,
        "drawings": all_drawings,
    });
    ctx.room.send_to(&resp.to_string(), ctx.cid);
}
