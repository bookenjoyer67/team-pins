use tracing::{info, warn};

use crate::auth;
use crate::messages;

use super::{
    get_conn_pubkey, get_join_policy, get_member_role, is_member,
    verify_creation_attestation, HandlerContext,
};

pub async fn handle_push_delta(ctx: &HandlerContext<'_>, v: &serde_json::Value) {
    let community_id = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or_else(messages::unix_millis);
    let conn_pubkey = get_conn_pubkey(ctx.room, ctx.cid);

    // Validate all field limits upfront — reject entire delta if any exceeds
    let s = &ctx.state.config.storage;
    let max_pins = s.max_pins_per_push;
    if max_pins > 0 && v.get("pins").and_then(|p| p.as_array()).map_or(0, |a| a.len()) > max_pins {
        ctx.room.send_to(
            &serde_json::json!({"type":"error","reason":format!("too many pins (max {})", max_pins)}).to_string(),
            ctx.cid,
        );
        return;
    }
    let max_anns = s.max_annotations_per_push;
    if max_anns > 0 && v.get("annotations").and_then(|a| a.as_array()).map_or(0, |a| a.len()) > max_anns {
        ctx.room.send_to(
            &serde_json::json!({"type":"error","reason":format!("too many annotations (max {})", max_anns)}).to_string(),
            ctx.cid,
        );
        return;
    }
    let max_dwgs = s.max_drawings_per_push;
    if max_dwgs > 0 && v.get("drawings").and_then(|d| d.as_array()).map_or(0, |a| a.len()) > max_dwgs {
        ctx.room.send_to(
            &serde_json::json!({"type":"error","reason":format!("too many drawings (max {})", max_dwgs)}).to_string(),
            ctx.cid,
        );
        return;
    }
    let max_tombs = s.max_tombstones_per_push;
    if max_tombs > 0 && v.get("tombstones").and_then(|t| t.as_array()).map_or(0, |a| a.len()) > max_tombs {
        return;
    }
    let max_dpi = s.max_deleted_pin_ids_per_push;
    if max_dpi > 0 && v.get("deleted_pin_ids").and_then(|d| d.as_array()).map_or(0, |a| a.len()) > max_dpi {
        return;
    }
    let max_ddi = s.max_deleted_drawing_ids_per_push;
    if max_ddi > 0 && v.get("deleted_drawing_ids").and_then(|d| d.as_array()).map_or(0, |a| a.len()) > max_ddi {
        return;
    }
    let max_c = s.max_chains_per_push;
    if max_c > 0 && v.get("chains").and_then(|c| c.as_array()).map_or(0, |a| a.len()) > max_c {
        return;
    }
    let max_dci = s.max_deleted_chain_ids_per_push;
    if max_dci > 0 && v.get("deleted_chain_ids").and_then(|d| d.as_array()).map_or(0, |a| a.len()) > max_dci {
        return;
    }

    // Auth: get community config for policy checks
    let c_opt = ctx.state.store.get_community(&community_id).await;
    let join_policy = c_opt.as_ref()
        .map(|c| get_join_policy(&c.governance))
        .unwrap_or("open".to_string());

    let mut pin_count = 0;
    let mut ann_count = 0;
    if let Some(pins) = v.get("pins").and_then(|p| p.as_array()) {
        for pin in pins {
            let pin_id = pin.get("pin_id").and_then(|p| p.as_str()).unwrap_or("");
            let author = pin.get("author_pubkey").and_then(|a| a.as_str()).unwrap_or("");
            let posted_anon = pin.get("posted_anonymously").and_then(|p| p.as_bool()).unwrap_or(false);

            // Auth: verify creation attestation
            if !posted_anon && !author.is_empty() {
                if !verify_creation_attestation(&pin, pin_id) {
                    warn!("[relay] push_delta: invalid creation attestation for pin {}", pin_id);
                    continue;
                }
                // Auth: unauthenticated clients must be rejected for non-open communities
                if conn_pubkey.is_none() {
                    if join_policy != "open" {
                        warn!("[relay] push_delta: unauthenticated client blocked from pushing to non-open community {}", community_id);
                        continue;
                    }
                }
                // Auth: author_pubkey must match connection pubkey
                if let Some(ref cpk) = conn_pubkey {
                    if cpk != author {
                        let existing = ctx.state.store.get_pin(&community_id, pin_id).await;
                        if existing.as_ref().map_or(true, |e| e.author_pubkey != author) {
                            warn!("[relay] push_delta: author mismatch for pin {} (conn={} author={})",
                                pin_id, cpk, author);
                            continue;
                        }
                    }
                }
                // Auth: check membership for invite/token policies
                if join_policy != "open" {
                    if let Some(ref c) = c_opt {
                        if !c.members.is_empty() && !is_member(c, author) {
                            warn!("[relay] push_delta: non-member write attempt for {} by {}", community_id, author);
                            continue;
                        }
                    }
                }
                // Auth: check role — readers cannot write
                if let Some(ref c) = c_opt {
                    if let Some(role) = get_member_role(c, author) {
                        if role == "reader" {
                            warn!("[relay] push_delta: reader {} blocked from writing pin {}", author, pin_id);
                            continue;
                        }
                    }
                }
            }

            ctx.state.store.store_pin(crate::storage::StoredPin {
                pin_id: pin_id.to_string(),
                community_id: community_id.clone(),
                ciphertext: pin.get("ciphertext").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                nonce: pin.get("nonce").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                created_at: ts,
                author_pubkey: author.to_string(),
                media: pin.get("media").cloned(),
                posted_anonymously: posted_anon,
                ttl_expires_at: pin.get("ttl_expires_at").and_then(|t| t.as_u64()),
                ttl_base_at: pin.get("ttl_base_at").and_then(|t| t.as_u64()),
                vote_count_up: pin.get("vote_count_up").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                vote_count_down: pin.get("vote_count_down").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                layer_id: pin.get("layer_id").and_then(|l| l.as_str()).map(|s| s.to_string()),
                emoji: pin.get("emoji").and_then(|e| e.as_str()).map(|s| s.to_string()),
            }).await;
            pin_count += 1;
        }
    }
    if let Some(anns) = v.get("annotations").and_then(|a| a.as_array()) {
        for ann in anns {
            let author = ann.get("author_pubkey").and_then(|a| a.as_str()).unwrap_or("");
            if join_policy != "open" {
                if author.is_empty() {
                    warn!("[relay] push_delta: unauthenticated annotation blocked for non-open community {}", community_id);
                    continue;
                }
                if let Some(ref c) = c_opt {
                    if !c.members.is_empty() && !is_member(c, author) {
                        continue;
                    }
                }
            }
            if !author.is_empty() {
                if let Some(ref c) = c_opt {
                    if let Some(role) = get_member_role(c, author) {
                        if role == "reader" { continue; }
                    }
                }
                // Auth: author_pubkey must match connection pubkey for annotations
                if let Some(ref cpk) = conn_pubkey {
                    if cpk != author {
                        let existing = ctx.state.store.get_annotation(
                            ann.get("annotation_id").and_then(|a| a.as_str()).unwrap_or("")
                        ).await;
                        if existing.as_ref().map_or(true, |e| e.author_pubkey != author) {
                            warn!("[relay] push_delta: author mismatch for annotation (conn={} author={})", cpk, author);
                            continue;
                        }
                    }
                }
            }
            ctx.state.store.store_annotation(crate::storage::StoredAnnotation {
                annotation_id: ann.get("annotation_id").and_then(|a| a.as_str()).unwrap_or("").to_string(),
                pin_id: ann.get("pin_id").and_then(|p| p.as_str()).unwrap_or("").to_string(),
                community_id: community_id.clone(),
                ciphertext: ann.get("ciphertext").and_then(|c| c.as_str()).unwrap_or("").to_string(),
                nonce: ann.get("nonce").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                author_pubkey: author.to_string(),
                created_at: ts,
                updated_at: ts,
                votes: ann.get("votes").cloned().unwrap_or(serde_json::Value::Array(vec![])),
            }).await;
            ann_count += 1;
        }
    }
    let mut dwg_count = 0u32;
    if let Some(drawings) = v.get("drawings").and_then(|d| d.as_array()) {
        for dwg in drawings {
            let author = dwg.get("author_pubkey").and_then(|a| a.as_str()).unwrap_or("");
            if join_policy != "open" {
                if author.is_empty() {
                    warn!("[relay] push_delta: unauthenticated drawing blocked for non-open community {}", community_id);
                    continue;
                }
                if let Some(ref c) = c_opt {
                    if !c.members.is_empty() && !is_member(c, author) {
                        continue;
                    }
                }
            }
            if !author.is_empty() {
                if let Some(ref c) = c_opt {
                    if let Some(role) = get_member_role(c, author) {
                        if role == "reader" { continue; }
                    }
                }
                // Auth: author_pubkey must match connection pubkey for drawings
                if let Some(ref cpk) = conn_pubkey {
                    if cpk != author {
                        if ctx.state.store.get_drawing_author(&community_id,
                            dwg.get("drawing_id").and_then(|d| d.as_str()).unwrap_or("")
                        ).await.as_ref().map_or(true, |a| a != author) {
                            warn!("[relay] push_delta: author mismatch for drawing (conn={} author={})", cpk, author);
                            continue;
                        }
                    }
                }
            }
            ctx.state.store.store_drawing(crate::storage::StoredDrawing {
                drawing_id: dwg.get("drawing_id").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                community_id: community_id.clone(),
                ciphertext: dwg.get("encrypted_geojson")
                    .or_else(|| dwg.get("ciphertext"))
                    .and_then(|c| c.as_str()).unwrap_or("").to_string(),
                nonce: dwg.get("nonce").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                author_pubkey: author.to_string(),
                created_at: ts,
            }).await;
            dwg_count += 1;
        }
    }
    let mut tomb_count = 0;
    let mut del_count = 0;
    // Resolve the connection's role once for delete auth
    let conn_role = conn_pubkey.as_ref().and_then(|cpk| {
        c_opt.as_ref().and_then(|c| get_member_role(c, cpk))
    });
    if let Some(tombs) = v.get("tombstones").and_then(|t| t.as_array()) {
        for t in tombs {
            let by_pubkey = t.get("by_pubkey").and_then(|b| b.as_str()).unwrap_or("");
            if !by_pubkey.is_empty() {
                // Auth: verify tombstone signature
                let sig = t.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                let target_id = t.get("target_id").and_then(|t| t.as_str()).unwrap_or("");
                if !sig.is_empty() && !target_id.is_empty() {
                    let tomb_ts = t.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(ts);
                    let raw_payload = format!("{}|{}|{}", target_id,
                        t.get("tombstone_id").and_then(|t| t.as_str()).unwrap_or(""), tomb_ts);
                    let payload_hex = hex::encode(raw_payload.as_bytes());
                    if !auth::verify_signature(&payload_hex, sig, by_pubkey).unwrap_or(false) {
                        warn!("[relay] tombstone: invalid signature from {}", by_pubkey);
                        continue;
                    }
                } else {
                    // tombstone with no sig or target - reject all empty
                    if sig.is_empty() || target_id.is_empty() || by_pubkey.is_empty() {
                        continue;
                    }
                }
                // Auth: check role
                if let Some(ref c) = c_opt {
                    if let Some(role) = get_member_role(c, by_pubkey) {
                        if role == "reader" { continue; }
                    }
                }
            } else {
                // reject tombstones with no by_pubkey
                continue;
            }
            ctx.state.store.store_tombstone(crate::storage::StoredTombstone {
                tombstone_id: t.get("tombstone_id").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                target_id: t.get("target_id").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                community_id: community_id.clone(),
                by_pubkey: t.get("by_pubkey").and_then(|b| b.as_str()).unwrap_or("").to_string(),
                timestamp: ts,
                signature: t.get("signature").and_then(|s| s.as_str()).unwrap_or("").to_string(),
            }).await;
            tomb_count += 1;
        }
    }
    if let Some(del_pins) = v.get("deleted_pin_ids").and_then(|d| d.as_array()) {
        for pid in del_pins {
            if let Some(id) = pid.as_str() {
                // Auth: readers cannot delete; contributors can only delete own
                let allow = match conn_role.as_deref() {
                    Some("reader") => false,
                    Some("contributor") => {
                        ctx.state.store.get_pin_author(&community_id, id).await
                            .map_or(false, |author| conn_pubkey.as_ref().map_or(false, |cpk| *cpk == author))
                    }
                    _ => true, // maintainer, founder, or no role (open community)
                };
                if allow {
                    ctx.state.store.delete_pin(&community_id, id).await;
                    del_count += 1;
                } else {
                    warn!("[relay] delete denied for pin {}: role={:?}", id, conn_role);
                }
            }
        }
    }
    if let Some(del_dwgs) = v.get("deleted_drawing_ids").and_then(|d| d.as_array()) {
        for did in del_dwgs {
            if let Some(id) = did.as_str() {
                let allow = match conn_role.as_deref() {
                    Some("reader") => false,
                    Some("contributor") => {
                        ctx.state.store.get_drawing_author(&community_id, id).await
                            .map_or(false, |author| conn_pubkey.as_ref().map_or(false, |cpk| *cpk == author))
                    }
                    _ => true,
                };
                if allow {
                    ctx.state.store.delete_drawing(&community_id, id).await;
                } else {
                    warn!("[relay] delete denied for drawing {}: role={:?}", id, conn_role);
                }
            }
        }
    }
    info!("[relay] delta stored for {}: {} pins, {} anns, {} dwgs, {} tombstones, {} deleted",
        community_id, pin_count, ann_count, dwg_count, tomb_count, del_count);
    // Forward layer updates to subscribers
    if let Some(ref c) = c_opt {
        let public_layers = ctx.state.store.get_public_layers(&community_id).await;
        for pl in &public_layers {
            let subs = ctx.state.store.get_subscribers_for_layer(&community_id, &pl.layer_id).await;
            if subs.is_empty() { continue; }
            let layer_pins: Vec<&serde_json::Value> = v.get("pins")
                .and_then(|p| p.as_array()).map(|arr| arr.iter().collect()).unwrap_or_default();
            let layer_dwgs: Vec<&serde_json::Value> = v.get("drawings")
                .and_then(|d| d.as_array()).map(|arr| arr.iter().collect()).unwrap_or_default();
            if layer_pins.is_empty() && layer_dwgs.is_empty() { continue; }
            let layer_delta = serde_json::json!({
                "type": "layer_update",
                "community_id": community_id,
                "layer_id": pl.layer_id,
                "community_name": c.name,
                "layer_name": pl.name,
                "pins": layer_pins,
                "drawings": layer_dwgs,
                "ts": ts,
            }).to_string();
            for sub in &subs {
                // Find subscriber's client connection and send
                for entry in ctx.room.clients.iter() {
                    if entry.value().pubkey.read().unwrap().as_deref() == Some(&sub.subscriber_pubkey) {
                        if entry.value().tx.try_send(
                            tokio_tungstenite::tungstenite::Message::Text(layer_delta.clone())
                        ).is_err() {
                            warn!("[relay] layer delta drop for subscriber {}", sub.subscriber_pubkey);
                        }
                    }
                }
            }
        }
    }
    ctx.room.send_to_guaranteed(
        &serde_json::json!({"type":"delta_stored"}).to_string(),
        ctx.cid,
        2000,
    ).await;
    let broadcast = serde_json::json!({
        "type": "push_delta_bc",
        "community_id": community_id,
        "ts": ts,
        "pins": v.get("pins").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "annotations": v.get("annotations").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "drawings": v.get("drawings").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "tombstones": v.get("tombstones").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "deleted_pin_ids": v.get("deleted_pin_ids").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "deleted_drawing_ids": v.get("deleted_drawing_ids").cloned().unwrap_or(serde_json::Value::Array(vec![])),
    });
    // Broadcast to members if non-open, else all
    if join_policy != "open" {
        if let Some(ref c) = c_opt {
            ctx.room.broadcast_to_members_guaranteed(c, &broadcast.to_string(), ctx.cid, 2000).await;
        } else {
            ctx.room.broadcast_guaranteed(&broadcast.to_string(), ctx.cid, 2000).await;
        }
    } else {
        ctx.room.broadcast_guaranteed(&broadcast.to_string(), ctx.cid, 2000).await;
    }

    // Push notify offline members (skip if silent flag is set — bulk sync)
    if ctx.state.config.push.enabled && !v.get("silent").and_then(|s| s.as_bool()).unwrap_or(false) {
        if let Some(ref c) = c_opt {
            let total = pin_count + dwg_count + ann_count;
            if total > 0 {
                let body = if total == 1 {
                    format!("New update in {}", c.name)
                } else {
                    format!("{} new updates in {}", total, c.name)
                };
                let tag = format!("piggpin-delta-{}", community_id);
                let url = format!("/?action=map&cid={}", community_id);
                crate::push::send_push_to_offline_members(
                    ctx.state, ctx.room, &community_id,
                    &c.name, &body, &tag, &url,
                ).await;
            }
        }
    }
}
