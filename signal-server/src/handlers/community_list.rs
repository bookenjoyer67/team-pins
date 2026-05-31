use tracing::info;

use super::HandlerContext;

pub async fn handle_list_communities(ctx: &HandlerContext<'_>, _v: &serde_json::Value) {
    let communities = ctx.state.store.list_communities().await;
    info!("[relay] list_communities: {} published communities", communities.len());
    let resp = serde_json::json!({
        "type": "community_list",
        "communities": communities.iter().map(|c| serde_json::json!({
            "community_id": c.community_id,
            "name": c.name,
            "description": c.description,
            "member_count": c.members.len(),
            "governance": c.governance,
            "bounds": c.bounds,
            "password_protected": c.password_hash.is_some(),
        })).collect::<Vec<_>>(),
    });
    ctx.room.send_to(&resp.to_string(), ctx.cid);
}

pub async fn handle_query_communities(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    // Require auth for community queries
    if ctx.conn_pubkey.is_none() {
        tracing::warn!("[relay] query_communities: unauthenticated client rejected");
        return;
    }
    let request_id = v.get("request_id").and_then(|r| r.as_str()).unwrap_or("");
    let bbox = v.get("bbox").and_then(|b| b.as_array());
    let search = v.get("search").and_then(|s| s.as_str()).map(|s| s.to_lowercase());
    let communities = ctx.state.store.list_communities().await;
    let mut results = Vec::new();
    for c in &communities {
        // Search filter: match name substring (case-insensitive) or topic tag match
        if let Some(ref term) = search {
            let name_match = c.name.to_lowercase().contains(term);
            let desc_match = c.description.to_lowercase().contains(term);
            if !name_match && !desc_match {
                // Check public layer topic tags
                let has_tag = if term.len() > 0 {
                    let layers = ctx.state.store.get_public_layers(&c.community_id).await;
                    layers.iter().any(|l| l.topic_tags.iter().any(|t| t.to_lowercase().contains(term)))
                } else {
                    false
                };
                if !has_tag { continue; }
            }
        }
        // Bbox filter
        if let Some(ref bnds) = c.bounds {
            if bnds.len() == 4 {
                if let Some(ref qb) = bbox {
                    if qb.len() == 4 {
                        let (s, w, n, e) = (qb[0].as_f64().unwrap_or(0.0), qb[1].as_f64().unwrap_or(0.0), qb[2].as_f64().unwrap_or(0.0), qb[3].as_f64().unwrap_or(0.0));
                        let (cs, cw, cn, ce) = (bnds[0], bnds[1], bnds[2], bnds[3]);
                        if e < cw || ce < w || n < cs || cn < s { continue; }
                    }
                }
            }
        }
        let pin_count = ctx.state.store.count_pins(&c.community_id).await;
        let drawing_count = ctx.state.store.count_drawings(&c.community_id).await;
        let has_public = ctx.state.store.has_public_layers(&c.community_id).await;
        results.push(serde_json::json!({
            "community_id": c.community_id,
            "name": c.name,
            "description": c.description,
            "member_count": c.members.len(),
            "pin_count": pin_count,
            "drawing_count": drawing_count,
            "has_public_layers": has_public,
            "governance": c.governance,
            "bounds": c.bounds,
            "password_protected": c.password_hash.is_some(),
        }));
    }
    let resp = serde_json::json!({
        "type": "communities_nearby",
        "request_id": request_id,
        "results": results,
    });
    ctx.room.send_to(&resp.to_string(), ctx.cid);
}
