use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use hex;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout, Duration, Instant};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tracing::{info, warn};

use crate::auth;

use crate::messages;
use crate::room::{self, Client, Room, CHANNEL_CAP};
use crate::state::AppState;

fn auth_err(msg: &str) -> String {
    messages::json_err(&format!("auth: {}", msg))
}

fn get_conn_pubkey(room: &Room, cid: &str) -> Option<String> {
    room.clients.get(cid).and_then(|c| c.pubkey.clone())
}

fn is_founder(community: &crate::storage::CommunityConfig, pubkey: &str) -> bool {
    community.members.iter().any(|m| m.pubkey == pubkey && m.role == "founder")
}

fn is_member(community: &crate::storage::CommunityConfig, pubkey: &str) -> bool {
    community.members.iter().any(|m| m.pubkey == pubkey)
}

fn get_member_role(community: &crate::storage::CommunityConfig, pubkey: &str) -> Option<String> {
    community.members.iter()
        .find(|m| m.pubkey == pubkey)
        .map(|m| m.role.clone())
}

fn get_join_policy(gov: &serde_json::Value) -> String {
    gov.get("join_policy").and_then(|v| v.as_str()).unwrap_or("open").to_string()
}

fn verify_creation_attestation(pin: &serde_json::Value, pin_id: &str) -> bool {
    if let Some(attestations) = pin.get("attestations").and_then(|a| a.as_array()) {
        if attestations.is_empty() {
            return true; // legacy pin with empty attestation array
        }
        for att in attestations {
            let att_type = att.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if att_type == "created" {
                let pubkey = att.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
                let sig = att.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                let timestamp = att.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
                if pubkey.is_empty() || sig.is_empty() { continue; }
                let raw_payload = format!("{}|{}|{}", pin_id, "created", timestamp);
                let payload_hex = hex::encode(raw_payload.as_bytes());
                if auth::verify_signature(&payload_hex, sig, pubkey).unwrap_or(false) {
                    return true;
                }
                // Fallback: undelimited format (backwards compat with pre-delimiter pins)
                let old_payload = format!("{}{}{}", pin_id, "created", timestamp);
                let old_payload_hex = hex::encode(old_payload.as_bytes());
                if auth::verify_signature(&old_payload_hex, sig, pubkey).unwrap_or(false) {
                    return true;
                }
                // Fallback: raw-string payload (backwards compat with oldest clients)
                if auth::verify_signature(pin_id, sig, pubkey).unwrap_or(false) {
                    return true;
                }
            }
        }
        // Attestations exist but none verified — reject
        warn!("[relay] push_delta: invalid creation attestation for pin {}", pin_id);
        return false;
    }
    // No attestation — allow for legacy/anonymous pins
    true
}

pub async fn handle(state: Arc<AppState>, stream: TcpStream, addr: SocketAddr) {
    let ip = addr.ip().to_string();

    {
        let mut rl = state.rl.lock().await;
        if !rl.check_conn(&ip) { return; }
    }

    let mut ws_stream = match timeout(Duration::from_secs(10), accept_async(stream)).await {
        Ok(Ok(ws)) => ws,
        Ok(Err(e)) => {
            warn!("WebSocket handshake failed from {}: {}", ip, e);
            return;
        }
        Err(_) => {
            warn!("WebSocket handshake timeout from {}", ip);
            return;
        }
    };

    let _ = ws_stream.send(Message::Text(messages::json_hello())).await;

    let join_msg = match timeout(Duration::from_secs(5), ws_stream.next()).await {
        Ok(Some(Ok(Message::Text(txt)))) => txt,
        Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
            info!("Client {} closed before join", ip);
            return;
        }
        Ok(Some(Err(e))) => {
            warn!("Client {} WebSocket error before join: {}", ip, e);
            return;
        }
        Err(_) => {
            warn!("Client {} join timeout", ip);
            return;
        }
        _ => {
            warn!("Client {} sent non-text before join", ip);
            return;
        }
    };

    let (mut ws_tx, ws_rx) = ws_stream.split();
    let (tx, mut rx) = mpsc::channel::<Message>(CHANNEL_CAP);

    let join_data: serde_json::Value = match serde_json::from_str(&join_msg) {
        Ok(v) => v,
        Err(_) => {
            let _ = ws_tx.send(Message::Text(messages::json_err("invalid join message"))).await;
            return;
        }
    };

    if join_data.get("type").and_then(|t| t.as_str()) != Some("join") {
        let _ = ws_tx.send(Message::Text(messages::json_err("expected join"))).await;
        return;
    }

    let room_name = join_data.get("room").and_then(|r| r.as_str()).unwrap_or("").to_string();
    let password = join_data.get("pw").and_then(|r| r.as_str()).map(|s| s.to_string());

    if room_name.is_empty() || room_name.len() > state.config.security.max_room_len {
        let _ = ws_tx.send(Message::Text(messages::json_err("invalid room"))).await;
        return;
    }

    let cid = uuid::Uuid::new_v4().to_string();

    let client_is_relay_room;
    {
        let mut rooms = state.rooms.write().await;

        if rooms.len() >= state.config.rooms.max_rooms && !rooms.contains_key(&room_name) {
            let _ = ws_tx.send(Message::Text(messages::json_err("server full"))).await;
            return;
        }

        let room = rooms.entry(room_name.clone()).or_insert_with(|| Room {
            clients: HashMap::new(),
            pw_hash: None,
            last_act: Instant::now(),
            challenges: HashMap::new(),
        });

        let max = state.config.rooms.max_clients;
        if max > 0 && room.clients.len() >= max {
            let _ = ws_tx.send(Message::Text(messages::json_err("room full"))).await;
            return;
        }

        if let Some(ref stored) = room.pw_hash {
            if password.as_deref().map_or(true, |pw| pw.is_empty() || !messages::check_password(stored, pw)) {
                let _ = ws_tx.send(Message::Text(messages::json_err("wrong password"))).await;
                return;
            }
        } else if let Some(pw) = &password {
            if !pw.is_empty() {
                if pw.len() > state.config.security.max_password_len {
                    let _ = ws_tx.send(Message::Text(messages::json_err("password too long"))).await;
                    return;
                }
                room.pw_hash = Some(messages::hash_password(pw));
            }
        } else if state.config.security.require_passwords && room_name != "community-relay" {
            let _ = ws_tx.send(Message::Text(messages::json_err("password required"))).await;
            return;
        }

        room.broadcast(&messages::json_joined(&cid), "");
        room.clients.insert(cid.clone(), Client { tx, id: cid.clone(), ip: ip.clone(), pubkey: None });
        room.last_act = Instant::now();
        client_is_relay_room = room_name == "community-relay";
    }

    // Send welcome, then auth challenge for community-relay room
    let _ = ws_tx.send(Message::Text(messages::json_welcome(&cid))).await;
    if client_is_relay_room {
        let (challenge_msg, challenge_hex, challenge_ts) = messages::json_auth_challenge();
        let _ = ws_tx.send(Message::Text(challenge_msg)).await;
        {
            let mut rooms = state.rooms.write().await;
            if let Some(room) = rooms.get_mut(&room_name) {
                room.challenges.insert(cid.clone(), (challenge_hex, challenge_ts));
            }
        }
    }

    let read_cid = cid.clone();
    let read_room = room_name.clone();
    let read_ip = ip.clone();

    let mut read_buf = ws_rx;
    let mut write_buf = ws_tx;

    loop {
        tokio::select! {
            // Outgoing queue: send to WebSocket
            msg = rx.recv() => {
                match msg {
                    Some(msg) => {
                        if write_buf.send(msg).await.is_err() { break; }
                    }
                    None => break,
                }
            }
            // Periodic ping
            _ = sleep(Duration::from_secs(30)) => {
                if write_buf.send(Message::Ping(vec![])).await.is_err() { break; }
            }
            // Incoming messages
            read = read_buf.next() => {
                match read {
                    Some(Ok(Message::Text(txt))) => {
                        if txt.len() > state.config.security.max_message_size { continue; }
                        {
                            let mut rl = state.rl.lock().await;
                            if !rl.check_msg(&read_ip) { continue; }
                        }
                        let mut rooms = state.rooms.write().await;
                        if let Some(room) = rooms.get_mut(&read_room) {
                            room.last_act = Instant::now();
                            match serde_json::from_str::<serde_json::Value>(&txt) {
                                Ok(v) if v.get("type").is_some() => {
                                    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                    if ty != "pong" && ty != "ping" {
                                        info!("[relay] received msg type: {} from room: {}", ty, read_room);
                                    }
                                    if ty == "auth_response" && read_room == "community-relay" {
                                        let pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        let challenge_hex = v.get("challenge").and_then(|c| c.as_str()).unwrap_or("");
                                        let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                                        let challenge_ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);
                                        if !pubkey.is_empty() && !challenge_hex.is_empty() && !sig.is_empty() {
                                            let stored = room.challenges.remove(&read_cid);
                                            let valid_challenge = stored.as_ref().map_or(false, |(ch, ts)| {
                                                let now = messages::unix_millis();
                                                (now - ts) < 300_000 && ch == challenge_hex
                                            });
                                            if !valid_challenge {
                                                warn!("[relay] auth failed for {}: invalid/expired challenge", &read_cid);
                                                room.send_to(&auth_err("invalid or expired challenge"), &read_cid);
                                            } else {
                                                let raw_payload = format!("{}{}", challenge_hex, challenge_ts);
                                                let payload_hex = hex::encode(raw_payload.as_bytes());
                                                match auth::verify_signature(&payload_hex, sig, pubkey) {
                                                    Ok(true) => {
                                                        if let Some(client) = room.clients.get_mut(&read_cid) {
                                                            client.pubkey = Some(pubkey.to_string());
                                                        }
                                                        room.send_to(&serde_json::json!({"type":"auth_ok","pubkey":pubkey}).to_string(), &read_cid);
                                                        info!("[relay] client {} authenticated as {}", &read_cid, &pubkey);
                                                    }
                                                    _ => {
                                                        warn!("[relay] auth failed for {}: invalid signature", &read_cid);
                                                        room.send_to(&auth_err("invalid signature"), &read_cid);
                                                    }
                                                }
                                            }
                                        }
                                    } else if ty == "mesh_uplink" && read_room == "mesh" {
                                        if let Some(payload) = v.get("payload").and_then(|p| p.as_str()) {
                                            let to = v.get("to").and_then(|t| t.as_u64());
                                            let mqtt_payload = serde_json::json!({"p": payload, "to": to}).to_string();
                                            let tx = state.mesh_uplink.read().await;
                                            if let Some(ref tx) = *tx {
                                                if tx.send(mqtt_payload).await.is_err() {
                                                    warn!("[relay] mesh_uplink TX failed, channel closed");
                                                }
                                            }
                                        }
                                        continue;
                                    } else if (ty == "mesh_uplink_position" || ty == "mesh_uplink_presence") && read_room == "mesh" {
                                        let tx = state.mesh_uplink.read().await;
                                        if let Some(ref tx) = *tx {
                                            if tx.send(v.to_string()).await.is_err() {
                                                warn!("[relay] mesh_uplink_position TX failed, channel closed");
                                            }
                                        }
                                        continue;
                                    } else if ty == "register_community" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        if cid_val.is_empty() { continue; }
                                        let is_re_registration = state.store.get_community(cid_val).await.is_some();
                                        if !is_re_registration {
                                            let mut rl = state.rl.lock().await;
                                            if !rl.check_community_reg(&read_ip) {
                                                warn!("[relay] community registration rate-limited for {}", read_ip);
                                                continue;
                                            }
                                        }
                                        let name = v.get("name").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        if name.len() > 128 { continue; }
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
                                        if members.len() > 1000 { continue; }
                                        let cid_owned = cid_val.to_string();
                                        let published = v.get("published").and_then(|p| p.as_bool()).unwrap_or(false);
                                        let public_key = v.get("public_key").and_then(|p| p.as_str()).unwrap_or("").to_string();
                                        let wrapped_dek = v.get("wrapped_dek").and_then(|w| w.as_str()).unwrap_or("").to_string();
                                        let key_derivation = v.get("key_derivation").and_then(|k| k.as_str()).unwrap_or("random").to_string();
                                        let description = v.get("description").and_then(|d| d.as_str()).unwrap_or("").to_string();
                                        if description.len() > 4096 { continue; }
                                        let owner_pubkey = v.get("owner_pubkey").and_then(|o| o.as_str()).unwrap_or("").to_string();
                                        let owner_name = v.get("owner_name").and_then(|o| o.as_str()).unwrap_or("").to_string();
                                        let bounds = v.get("bounds").and_then(|b| b.as_array()).map(|arr| {
                                            arr.iter().filter_map(|v| v.as_f64()).collect::<Vec<f64>>()
                                        });
                                        let password_hash = v.get("password_hash").and_then(|p| p.as_str()).map(|s| s.to_string());
                                        let join_wrapped_dek = v.get("join_wrapped_dek").and_then(|j| j.as_str()).map(|s| s.to_string());
                                        state.store.register_community(crate::storage::CommunityConfig {
                                            community_id: cid_owned.clone(), name: name.clone(),
                                            genesis_public_key: genesis,
                                            public_key, secret_key: String::new(), wrapped_dek, key_derivation,
                                            published, description,
                                            owner_pubkey: owner_pubkey.clone(),
                                            members,
                                            governance: v.get("governance").cloned().unwrap_or(serde_json::Value::Null),
                                            bounds,
                                            password_hash,
                                            join_wrapped_dek,
                                            used_token_nonces: vec![],
                                        }).await;
                                        info!("[relay] community registered: {} (published: {})", name, published);
                                        room.send_to(&serde_json::json!({"type":"community_registered","community_id":cid_owned}).to_string(), &read_cid);
                                        room.broadcast(&serde_json::json!({
                                            "type": "community_peer_joined",
                                            "community_id": cid_owned,
                                            "pubkey": owner_pubkey,
                                            "name": owner_name,
                                            "governance": v.get("governance").cloned().unwrap_or(serde_json::Value::Null),
                                        }).to_string(), &read_cid);
                                    } else if ty == "publish_community" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                        let mut allowed = false;
                                        if let Some(ref pk) = conn_pubkey {
                                            if let Some(c) = state.store.get_community(&cid_val).await {
                                                if is_founder(&c, pk) { allowed = true; }
                                            }
                                        }
                                        if !allowed {
                                            warn!("[relay] publish_community denied: not founder");
                                            room.send_to(&auth_err("founder only"), &read_cid);
                                            continue;
                                        }
                                        state.store.set_published(&cid_val, true).await;
                                        info!("[relay] community published: {}", cid_val);
                                        room.send_to(&serde_json::json!({"type":"community_published","community_id":cid_val}).to_string(), &read_cid);
                                    } else if ty == "unpublish_community" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                        let mut allowed = false;
                                        if let Some(ref pk) = conn_pubkey {
                                            if let Some(c) = state.store.get_community(&cid_val).await {
                                                if is_founder(&c, pk) { allowed = true; }
                                            }
                                        }
                                        if !allowed {
                                            warn!("[relay] unpublish_community denied: not founder");
                                            room.send_to(&auth_err("founder only"), &read_cid);
                                            continue;
                                        }
                                        state.store.set_published(&cid_val, false).await;
                                        info!("[relay] community unpublished: {}", cid_val);
                                        room.send_to(&serde_json::json!({"type":"community_unpublished","community_id":cid_val}).to_string(), &read_cid);
                                    } else if ty == "delete_community" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        let community = state.store.get_community(&cid_val).await;
                                        let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                        let authorized = match (&community, &conn_pubkey) {
                                            (Some(c), Some(pk)) => c.owner_pubkey == *pk || is_founder(c, pk),
                                            _ => false,
                                        };
                                        if !authorized {
                                            warn!("[relay] delete_community denied: unauthorized for {}", cid_val);
                                            room.send_to(&serde_json::json!({"type":"error","reason":"unauthorized"}).to_string(), &read_cid);
                                            continue;
                                        }
                                        state.store.delete_community(&cid_val).await;
                                        info!("[relay] community deleted: {}", cid_val);
                                        let notif = serde_json::json!({"type":"community_deleted","community_id":cid_val}).to_string();
                                        if let Some(ref c) = community {
                                            room.broadcast_to_members(c, &notif, &read_cid);
                                        } else {
                                            room.broadcast(&notif, &read_cid);
                                        }
                                    } else if ty == "add_member" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let member_pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        let display_name = v.get("display_name").and_then(|n| n.as_str()).unwrap_or("");
                                        let role = v.get("role").and_then(|r| r.as_str()).unwrap_or("contributor");
                                        let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                                        if cid_val.is_empty() || member_pubkey.is_empty() || sig.is_empty() { continue; }
                                        let conn_pubkey = match get_conn_pubkey(room, &read_cid) {
                                            Some(pk) => pk,
                                            None => { room.send_to(&auth_err("authentication required"), &read_cid); continue; }
                                        };
                                        let raw_payload = format!("{}|{}|{}|{}", cid_val, member_pubkey, role,
                                            v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0));
                                        let payload_hex = hex::encode(raw_payload.as_bytes());
                                        match auth::verify_signature(&payload_hex, sig, &conn_pubkey) {
                                            Ok(true) => {},
                                            _ => { room.send_to(&auth_err("invalid signature"), &read_cid); continue; }
                                        }
                                        match state.store.add_member(cid_val, crate::storage::MemberRecord {
                                            pubkey: member_pubkey.to_string(),
                                            display_name: display_name.to_string(),
                                            role: role.to_string(),
                                        }, &conn_pubkey).await {
                                            Ok(()) => {
                                                info!("[relay] member added to {}: {} ({})", cid_val, member_pubkey, role);
                                                let member_msg = messages::json_member_added(cid_val, member_pubkey, display_name, role);
                                                // Broadcast to all connected clients in the room
                                                room.broadcast(&member_msg, &read_cid);
                                                room.send_to(&member_msg, &read_cid);
                                            }
                                            Err(e) => { room.send_to(&messages::json_err(e), &read_cid); }
                                        }
                                    } else if ty == "remove_member" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let target_pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        if cid_val.is_empty() || target_pubkey.is_empty() { continue; }
                                        let conn_pubkey = match get_conn_pubkey(room, &read_cid) {
                                            Some(pk) => pk,
                                            None => { room.send_to(&auth_err("authentication required"), &read_cid); continue; }
                                        };
                                        // Verify signature
                                        let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                                        let ts = v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
                                        if !sig.is_empty() {
                                            let raw_payload = format!("{}|{}|{}", cid_val, target_pubkey, ts);
                                            let payload_hex = hex::encode(raw_payload.as_bytes());
                                            if !auth::verify_signature(&payload_hex, sig, &conn_pubkey).unwrap_or(false) {
                                                warn!("[relay] remove_member: invalid signature from {}", conn_pubkey);
                                                continue;
                                            }
                                        }
                                        match state.store.remove_member(cid_val, target_pubkey, &conn_pubkey).await {
                                            Ok(()) => {
                                                info!("[relay] member removed from {}: {}", cid_val, target_pubkey);
                                                let msg = messages::json_member_removed(cid_val, target_pubkey);
                                                room.broadcast(&msg, &read_cid);
                                                room.send_to(&msg, &read_cid);
                                            }
                                            Err(e) => { room.send_to(&messages::json_err(e), &read_cid); }
                                        }
                                    } else if ty == "create_token" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let nonce = v.get("nonce").and_then(|n| n.as_str()).unwrap_or("");
                                        let role = v.get("role").and_then(|r| r.as_str()).unwrap_or("contributor");
                                        let expiry = v.get("expiry").and_then(|e| e.as_u64()).unwrap_or(0);
                                        let max_uses = std::cmp::min(v.get("max_uses").and_then(|u| u.as_u64()).unwrap_or(1), u32::MAX as u64) as u32;
                                        let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                                        if cid_val.is_empty() || nonce.is_empty() || sig.is_empty() { continue; }
                                        let conn_pubkey = match get_conn_pubkey(room, &read_cid) {
                                            Some(pk) => pk,
                                            None => { room.send_to(&auth_err("authentication required"), &read_cid); continue; }
                                        };
                                        let raw_payload = format!("{}|{}|{}|{}|{}", cid_val, nonce, role, expiry, max_uses);
                                        let payload_hex = hex::encode(raw_payload.as_bytes());
                                        match auth::verify_signature(&payload_hex, sig, &conn_pubkey) {
                                            Ok(true) => {},
                                            _ => { room.send_to(&auth_err("invalid signature"), &read_cid); continue; }
                                        }
                                        match state.store.register_token(cid_val, crate::storage::InviteToken {
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
                                                room.send_to(&serde_json::json!({"type":"token_created","community_id":cid_val,"nonce":nonce}).to_string(), &read_cid);
                                            }
                                            Err(e) => { room.send_to(&messages::json_err(e), &read_cid); }
                                        }
                                    } else if ty == "claim_membership" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let member_pubkey = v.get("member_pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        let member_name = v.get("member_name").and_then(|n| n.as_str()).unwrap_or("");
                                        let nonce = v.get("nonce").and_then(|n| n.as_str()).unwrap_or("");
                                        let cap_sig = v.get("capability_signature").and_then(|s| s.as_str()).unwrap_or("");
                                        if cid_val.is_empty() || member_pubkey.is_empty() || nonce.is_empty() || cap_sig.is_empty() { continue; }
                                        // Verify capability signature was from a founder
                                        let mut cap_verified = false;
                                        if let Some(c) = state.store.get_community(cid_val).await {
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
                                            room.send_to(&messages::json_claim_denied("invalid capability signature"), &read_cid);
                                            continue;
                                        }
                                        let cap_role: String;
                                        match state.store.claim_token(cid_val, nonce, member_pubkey).await {
                                            Ok(role) => { cap_role = role; }
                                            Err(e) => { room.send_to(&messages::json_claim_denied(e), &read_cid); continue; }
                                        }
                                        let effective_role = cap_role.clone();
                                        // Token-verified: add member without founder check
                                        match state.store.add_member_by_token(cid_val, crate::storage::MemberRecord {
                                            pubkey: member_pubkey.to_string(),
                                            display_name: member_name.to_string(),
                                            role: effective_role.clone(),
                                        }).await {
                                            Ok(()) | Err("already a member") => {
                                                info!("[relay] membership claimed for {} in {} as {}", member_pubkey, cid_val, effective_role);
                                                let member_msg = messages::json_member_added(cid_val, member_pubkey, member_name, &effective_role);
                                                room.broadcast(&member_msg, &read_cid);
                                                room.send_to(&member_msg, &read_cid);
                                                room.send_to(&serde_json::json!({
                                                    "type": "membership_claimed",
                                                    "community_id": cid_val,
                                                    "role": effective_role,
                                                }).to_string(), &read_cid);
                                            }
                                            Err(e) => { room.send_to(&messages::json_err(e), &read_cid); }
                                        }
                                    } else if ty == "update_governance" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let gov = v.get("governance").cloned().unwrap_or(serde_json::Value::Null);
                                        let sig = v.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                                        let conn_pubkey = match get_conn_pubkey(room, &read_cid) {
                                            Some(pk) => pk,
                                            None => { room.send_to(&auth_err("authentication required"), &read_cid); continue; }
                                        };
                                        let gov_str = v.get("governance").cloned().unwrap_or(serde_json::Value::Null).to_string();
                                        let raw_payload = format!("{}|{}", cid_val, gov_str);
                                        let payload_hex = hex::encode(raw_payload.as_bytes());
                                        match auth::verify_signature(&payload_hex, sig, &conn_pubkey) {
                                            Ok(true) => {},
                                            _ => { room.send_to(&auth_err("invalid signature"), &read_cid); continue; }
                                        }
                                        if let Some(c) = state.store.get_community(cid_val).await {
                                            if !is_founder(&c, &conn_pubkey) {
                                                room.send_to(&auth_err("founder only"), &read_cid);
                                                continue;
                                            }
                                        }
                                        state.store.update_governance(cid_val, gov.clone()).await;
                                        info!("[relay] governance updated for {}", cid_val);
                                        // Broadcast governance change to connected members
                                        let bc = serde_json::json!({
                                            "type": "governance_updated",
                                            "community_id": cid_val,
                                            "governance": gov,
                                        });
                                        room.broadcast(&bc.to_string(), &read_cid);
                                        room.send_to(&bc.to_string(), &read_cid);
                                    } else if ty == "pin_vote" {
                                        let pin_id = v.get("pin_id").and_then(|p| p.as_str()).unwrap_or("").to_string();
                                        let community_id = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        let dir_val = v.get("dir").and_then(|d| d.as_i64()).unwrap_or(0);
                                        let dir: i8 = if dir_val == 1 { 1 } else if dir_val == -1 { -1 } else { continue; };
                                        let pubkey = v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("").to_string();
                                        if !pin_id.is_empty() && !pubkey.is_empty() && !community_id.is_empty() {
                                            let sig = v.get("signature").and_then(|s| s.as_str());
                                            let timestamp = v.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
                                            match sig {
                                                None => {
                                                    warn!("[relay] pin_vote denied: missing signature from {}", &pubkey);
                                                    continue;
                                                }
                                                Some(sig) => {
                                                    let raw_payload = format!("{}|{}|{}|{}", pin_id, community_id, dir, timestamp);
                                                    let payload_hex = hex::encode(raw_payload.as_bytes());
                                                    if !auth::verify_signature(&payload_hex, sig, &pubkey).unwrap_or(false) {
                                                        warn!("[relay] pin_vote denied: invalid signature from {}", &pubkey);
                                                        continue;
                                                    }
                                                }
                                            }
                                            // Auth: verify pubkey against connection binding (required)
                                            let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                            if conn_pubkey.as_ref().map_or(true, |cpk| cpk != &pubkey) {
                                                warn!("[relay] pin_vote denied: pubkey mismatch or unauthenticated");
                                                room.send_to(&auth_err("pubkey mismatch"), &read_cid);
                                                continue;
                                            }
                                            // Auth: verify pubkey is a community member (if community exists with join_policy != "open")
                                            if let Some(c) = state.store.get_community(&community_id).await {
                                                let jp = get_join_policy(&c.governance);
                                                if jp != "open" && !auth::verify_membership(&c, &pubkey) {
                                                    warn!("[relay] pin_vote denied: pubkey {} not a member", pubkey);
                                                    continue;
                                                }
                                                // Auth: readers cannot vote
                                                if let Some(role) = get_member_role(&c, &pubkey) {
                                                    if role == "reader" {
                                                        warn!("[relay] pin_vote denied: reader {} cannot vote", &pubkey);
                                                        continue;
                                                    }
                                                }
                                            }
                                            let vote_result = state.store.record_vote(crate::storage::VoteRecord {
                                                pin_id: pin_id.clone(), community_id: community_id.clone(), pubkey: pubkey.clone(), dir,
                                            }).await;
                                            let (up, down, was_dup) = match vote_result {
                                                Some(counts) => (counts.0, counts.1, false),
                                                None => {
                                                    let votes_lock = state.store.votes.read().await;
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
                                            } else if let Some(c) = state.store.get_community(&community_id).await {
                                                let gov = c.governance;
                                                let base = gov.get("ttl_base_mins").and_then(|v| v.as_u64()).unwrap_or(10080) as f64;
                                                let vote_weight = gov.get("ttl_vote_mins").and_then(|v| v.as_u64()).unwrap_or(360) as f64;
                                                let min_mins = gov.get("ttl_min_mins").and_then(|v| v.as_u64()).unwrap_or(60) as f64;
                                                let max_mins = gov.get("ttl_max_mins").and_then(|v| v.as_u64()).unwrap_or(43200) as f64;
                                                let mins = (base + (net_votes as f64 * vote_weight)).clamp(min_mins, max_mins);
                                                let base_at = state.store.get_pin(&community_id, &pin_id).await
                                                    .and_then(|p| p.ttl_base_at)
                                                    .unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or(std::time::Duration::from_millis(0)).as_millis() as u64);
                                                base_at.saturating_add((mins.max(0.0).min(1_000_000_000.0) * 60_000.0) as u64)
                                            } else {
                                                0
                                            };
                                            if !was_dup {
                                                state.store.update_pin_ttl(&community_id, &pin_id, up, down, ttl_expires_at, deleted).await;
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
                                            if let Some(c) = state.store.get_community(&community_id).await {
                                                let jp = get_join_policy(&c.governance);
                                                if jp != "open" {
                                                    room.broadcast_to_members(&c, &bc.to_string(), &read_cid);
                                                } else {
                                                    room.broadcast(&bc.to_string(), &read_cid);
                                                }
                                                room.send_to(&bc.to_string(), &read_cid);
                                            } else {
                                                room.broadcast(&bc.to_string(), &read_cid);
                                                room.send_to(&bc.to_string(), &read_cid);
                                            }
                                            info!("[relay] pin_vote broadcast: up={} down={} deleted={}", up, down, deleted);
                                        }
                                    } else if ty == "annotation_vote" {
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
                                                    continue;
                                                }
                                            } else {
                                                warn!("[relay] annotation_vote: missing signature");
                                                continue;
                                            }
                                            // Verify pubkey matches connection binding (required)
                                            let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                            if conn_pubkey.as_ref().map_or(true, |cpk| !pubkey.is_empty() && cpk != pubkey) {
                                                warn!("[relay] annotation_vote denied: pubkey mismatch or unauthenticated");
                                                continue;
                                            }
                                            if let Some(c) = state.store.get_community(community_id).await {
                                                let jp = get_join_policy(&c.governance);
                                                if jp != "open" && !pubkey.is_empty() && !auth::verify_membership(&c, pubkey) {
                                                    warn!("[relay] annotation_vote denied: pubkey {} not a member", pubkey);
                                                    continue;
                                                }
                                                // Auth: readers cannot vote
                                                if let Some(role) = get_member_role(&c, pubkey) {
                                                    if role == "reader" {
                                                        warn!("[relay] annotation_vote denied: reader {} cannot vote", pubkey);
                                                        continue;
                                                    }
                                                }
                                            }
                                            state.store.update_annotation_vote(&annotation_id, community_id, v.clone()).await;
                                            info!("[relay] annotation_vote: ann={}", &annotation_id);
                                            room.broadcast(&txt, &read_cid);
                                            room.send_to(&txt, &read_cid);
                                        }
                                    } else if ty == "push_delta" {
                                        let community_id = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        let ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);
                                        let conn_pubkey = get_conn_pubkey(room, &read_cid);

                                        // Auth: get community config for policy checks
                                        let c_opt = state.store.get_community(&community_id).await;
                                        let join_policy = c_opt.as_ref().map(|c| get_join_policy(&c.governance)).unwrap_or("open".to_string());

                                        let mut pin_count = 0;
                                        let mut ann_count = 0;
                                        if let Some(pins) = v.get("pins").and_then(|p| p.as_array()) {
                                            if pins.len() > 200 {
                                                warn!("[relay] push_delta: too many pins ({})", pins.len());
                                                room.send_to(&serde_json::json!({"type":"error","reason":"too many pins"}).to_string(), &read_cid);
                                                continue;
                                            }
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
                                                    // Auth: unauthenticated clients (conn_pubkey=None) must
                                                    // be rejected for non-open communities
                                                    if conn_pubkey.is_none() {
                                                        if join_policy != "open" {
                                                            warn!("[relay] push_delta: unauthenticated client blocked from pushing to non-open community {}", community_id);
                                                            continue;
                                                        }
                                                    }
                                                    // Auth: author_pubkey must match connection pubkey
                                                    // Relaxed: allow if pin already exists with same author (joiner sync)
                                                    if let Some(ref cpk) = conn_pubkey {
                                                        if cpk != author {
                                                            let existing = state.store.get_pin(&community_id, pin_id).await;
                                                            if existing.as_ref().map_or(true, |e| e.author_pubkey != author) {
                                                                warn!("[relay] push_delta: author mismatch for pin {} (conn={} author={})", pin_id, cpk, author);
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

                                                state.store.store_pin(crate::storage::StoredPin {
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
                                            if anns.len() > 100 { continue; }
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
                                                            let existing = state.store.get_annotation(ann.get("annotation_id").and_then(|a| a.as_str()).unwrap_or("")).await;
                                                            if existing.as_ref().map_or(true, |e| e.author_pubkey != author) {
                                                                warn!("[relay] push_delta: author mismatch for annotation (conn={} author={})", cpk, author);
                                                                continue;
                                                            }
                                                        }
                                                    }
                                                }
                                                state.store.store_annotation(crate::storage::StoredAnnotation {
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
                                            if drawings.len() > 100 { continue; }
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
                                                            if state.store.get_drawing_author(&community_id, dwg.get("drawing_id").and_then(|d| d.as_str()).unwrap_or("")).await.as_ref().map_or(true, |a| a != author) {
                                                                warn!("[relay] push_delta: author mismatch for drawing (conn={} author={})", cpk, author);
                                                                continue;
                                                            }
                                                        }
                                                    }
                                                }
                                                state.store.store_drawing(crate::storage::StoredDrawing {
                                                    drawing_id: dwg.get("drawing_id").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                                                    community_id: community_id.clone(),
                                                    ciphertext: dwg.get("encrypted_geojson").or_else(|| dwg.get("ciphertext")).and_then(|c| c.as_str()).unwrap_or("").to_string(),
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
                                            if tombs.len() > 200 { continue; }
                                            for t in tombs {
                                                let by_pubkey = t.get("by_pubkey").and_then(|b| b.as_str()).unwrap_or("");
                                                if !by_pubkey.is_empty() {
                                                    // Auth: verify tombstone signature
                                                    let sig = t.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                                                    let target_id = t.get("target_id").and_then(|t| t.as_str()).unwrap_or("");
                                                    if !sig.is_empty() && !target_id.is_empty() {
                                                        let tomb_ts = t.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(ts);
                                                        let raw_payload = format!("{}|{}|{}", target_id, t.get("tombstone_id").and_then(|t| t.as_str()).unwrap_or(""), tomb_ts);
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
                                                state.store.store_tombstone(crate::storage::StoredTombstone {
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
                                            if del_pins.len() > 500 { continue; }
                                            for pid in del_pins {
                                                if let Some(id) = pid.as_str() {
                                                    // Auth: readers cannot delete; contributors can only delete own
                                                    let allow = match conn_role.as_deref() {
                                                        Some("reader") => false,
                                                        Some("contributor") => {
                                                            state.store.get_pin_author(&community_id, id).await
                                                                .map_or(false, |author| conn_pubkey.as_ref().map_or(false, |cpk| *cpk == author))
                                                        }
                                                        _ => true, // maintainer, founder, or no role (open community)
                                                    };
                                                    if allow {
                                                        state.store.delete_pin(&community_id, id).await;
                                                        del_count += 1;
                                                    } else {
                                                        warn!("[relay] delete denied for pin {}: role={:?}", id, conn_role);
                                                    }
                                                }
                                            }
                                        }
                                        if let Some(del_dwgs) = v.get("deleted_drawing_ids").and_then(|d| d.as_array()) {
                                            if del_dwgs.len() > 500 { continue; }
                                            for did in del_dwgs {
                                                if let Some(id) = did.as_str() {
                                                    let allow = match conn_role.as_deref() {
                                                        Some("reader") => false,
                                                        Some("contributor") => {
                                                            state.store.get_drawing_author(&community_id, id).await
                                                                .map_or(false, |author| conn_pubkey.as_ref().map_or(false, |cpk| *cpk == author))
                                                        }
                                                        _ => true,
                                                    };
                                                    if allow {
                                                        state.store.delete_drawing(&community_id, id).await;
                                                    } else {
                                                        warn!("[relay] delete denied for drawing {}: role={:?}", id, conn_role);
                                                    }
                                                }
                                            }
                                        }
                                        info!("[relay] delta stored for {}: {} pins, {} anns, {} dwgs, {} tombstones, {} deleted", community_id, pin_count, ann_count, dwg_count, tomb_count, del_count);
                                        // Forward layer updates to subscribers
                                        if let Some(ref c) = c_opt {
                                            let public_layers = state.store.get_public_layers(&community_id).await;
                                            for pl in &public_layers {
                                                let subs = state.store.get_subscribers_for_layer(&community_id, &pl.layer_id).await;
                                                if subs.is_empty() { continue; }
                                                // Build a layer-specific delta for subscribers
                                                let layer_pins: Vec<&serde_json::Value> = v.get("pins").and_then(|p| p.as_array()).map(|arr| arr.iter().collect()).unwrap_or_default();
                                                let layer_dwgs: Vec<&serde_json::Value> = v.get("drawings").and_then(|d| d.as_array()).map(|arr| arr.iter().collect()).unwrap_or_default();
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
                                                    for (_client_id, client) in &room.clients {
                                                        if client.pubkey.as_deref() == Some(&sub.subscriber_pubkey) {
                                                        if client.tx.try_send(tokio_tungstenite::tungstenite::Message::Text(layer_delta.clone())).is_err() {
                                                            warn!("[relay] layer delta drop for subscriber {}", sub.subscriber_pubkey);
                                                        }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        room.send_to(&serde_json::json!({"type":"delta_stored"}).to_string(), &read_cid);
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
                                                room.broadcast_to_members(c, &broadcast.to_string(), &read_cid);
                                            } else {
                                                room.broadcast(&broadcast.to_string(), &read_cid);
                                            }
                                        } else {
                                            room.broadcast(&broadcast.to_string(), &read_cid);
                                        }
                                    } else if ty == "sync_request" {
                                        let community_id = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        // Auth: for non-open communities, verify requester is a member
                                        if let Some(c) = state.store.get_community(&community_id).await {
                                            let jp = get_join_policy(&c.governance);
                                            if jp != "open" {
                                                let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                                if conn_pubkey.as_ref().map_or(true, |pk| !is_member(&c, pk)) {
                                                    room.send_to(&messages::json_err("auth required"), &read_cid);
                                                    continue;
                                                }
                                            }
                                        }
                                        let request_id = v.get("request_id").and_then(|r| r.as_str()).unwrap_or("");
                                        let since = v.get("since").and_then(|s| s.as_u64()).unwrap_or(0);
                                        let pins = state.store.get_pins(&community_id, since).await;
                                        let annotations = state.store.get_annotations(&community_id, since).await;
                                let drawings = state.store.get_drawings(&community_id, since).await;
                                let tombstones = state.store.get_tombstones(&community_id, since).await;
                                let governance = state.store.get_community(&community_id).await.map(|c| c.governance).unwrap_or(serde_json::Value::Null);
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
                                        info!("[relay] sync sent for {}: {} pins, {} anns, {} dwgs, {} tombstones (since {})", community_id, pins.len(), annotations.len(), drawings.len(), tombstones.len(), since);
                                        room.send_to(&resp.to_string(), &read_cid);
                                    } else if ty == "list_communities" && read_room == "community-relay" {
                                        let communities = state.store.list_communities().await;
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
                                        room.send_to(&resp.to_string(), &read_cid);
                                    } else if ty == "query_communities" && read_room == "community-relay" {
                                        // Require auth for community queries
                                        if get_conn_pubkey(room, &read_cid).is_none() {
                                            warn!("[relay] query_communities: unauthenticated client rejected");
                                            continue;
                                        }
                                        let request_id = v.get("request_id").and_then(|r| r.as_str()).unwrap_or("");
                                        let bbox = v.get("bbox").and_then(|b| b.as_array());
                                        let communities = state.store.list_communities().await;
                                        let mut results = Vec::new();
                                        for c in &communities {
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
                                            let pin_count = state.store.count_pins(&c.community_id).await;
                                            let drawing_count = state.store.count_drawings(&c.community_id).await;
                                            let has_public = state.store.has_public_layers(&c.community_id).await;
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
                                        room.send_to(&resp.to_string(), &read_cid);
                                    } else if ty == "publish_layer" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let layer_id = v.get("layer_id").and_then(|l| l.as_str()).unwrap_or("");
                                        let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                                        let topic_tags: Vec<String> = v.get("topic_tags").and_then(|t| t.as_array()).map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
                                        let layer_dek_wrapped = v.get("layer_dek_wrapped").and_then(|d| d.as_str()).unwrap_or("").to_string();
                                        if cid_val.is_empty() || layer_id.is_empty() || name.is_empty() { continue; }
                                        let conn_pubkey = match get_conn_pubkey(room, &read_cid) {
                                            Some(pk) => pk,
                                            None => { room.send_to(&auth_err("authentication required"), &read_cid); continue; }
                                        };
                                        if let Some(c) = state.store.get_community(cid_val).await {
                                            if !is_founder(&c, &conn_pubkey) {
                                                room.send_to(&auth_err("founder only"), &read_cid); continue;
                                            }
                                        }
                                        state.store.publish_layer(crate::storage::PublicLayer {
                                            layer_id: layer_id.to_string(),
                                            community_id: cid_val.to_string(),
                                            name: name.clone(),
                                            topic_tags,
                                            layer_dek_wrapped,
                                            published_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or(std::time::Duration::from_millis(0)).as_millis() as u64,
                                            published_by: conn_pubkey.clone(),
                                        }).await;
                                        info!("[relay] layer published: {} in {}", name, cid_val);
                                        let bc = serde_json::json!({
                                            "type": "layer_published",
                                            "community_id": cid_val,
                                            "layer_id": layer_id,
                                            "name": name,
                                        });
                                        room.broadcast(&bc.to_string(), &read_cid);
                                        room.send_to(&bc.to_string(), &read_cid);
                                    } else if ty == "unpublish_layer" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let layer_id = v.get("layer_id").and_then(|l| l.as_str()).unwrap_or("");
                                        if cid_val.is_empty() || layer_id.is_empty() { continue; }
                                        let conn_pubkey = match get_conn_pubkey(room, &read_cid) {
                                            Some(pk) => pk,
                                            None => { room.send_to(&auth_err("authentication required"), &read_cid); continue; }
                                        };
                                        if let Some(c) = state.store.get_community(cid_val).await {
                                            if !is_founder(&c, &conn_pubkey) {
                                                room.send_to(&auth_err("founder only"), &read_cid); continue;
                                            }
                                        }
                                        state.store.unpublish_layer(cid_val, layer_id).await;
                                        info!("[relay] layer unpublished: {} from {}", layer_id, cid_val);
                                        let bc = serde_json::json!({
                                            "type": "layer_unpublished",
                                            "community_id": cid_val,
                                            "layer_id": layer_id,
                                        });
                                        room.broadcast(&bc.to_string(), &read_cid);
                                        room.send_to(&bc.to_string(), &read_cid);
                                    } else if ty == "list_public_layers" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        if cid_val.is_empty() { continue; }
                                        let layers = state.store.get_public_layers(cid_val).await;
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
                                        room.send_to(&resp.to_string(), &read_cid);
                                    } else if ty == "subscribe_layer" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let layer_id = v.get("layer_id").and_then(|l| l.as_str()).unwrap_or("");
                                        let subscriber_pubkey = v.get("subscriber_pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        if cid_val.is_empty() || layer_id.is_empty() || subscriber_pubkey.is_empty() { continue; }
                                        // Verify subscriber_pubkey matches authenticated connection
                                        let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                        if let Some(ref cpk) = conn_pubkey {
                                            if cpk != subscriber_pubkey {
                                                warn!("[relay] subscribe_layer: pubkey mismatch (conn={} sub={})", cpk, subscriber_pubkey);
                                                continue;
                                            }
                                        }
                                        // Get the layer DEK
                                        let public_layers = state.store.get_public_layers(cid_val).await;
                                        let layer = match public_layers.iter().find(|l| l.layer_id == layer_id) {
                                            Some(l) => l.clone(),
                                            None => { room.send_to(&messages::json_err("layer not found"), &read_cid); continue; }
                                        };
                                        // Check governance allows subscriptions
                                        if let Some(c) = state.store.get_community(cid_val).await {
                                            let allowed = c.governance.get("public_subscriptions").and_then(|v| v.as_str()).unwrap_or("off") == "anyone";
                                            if !allowed {
                                                room.send_to(&messages::json_err("subscriptions not allowed"), &read_cid); continue;
                                            }
                                        }
                                        // Add subscription
                                        match state.store.add_subscription(crate::storage::LayerSubscription {
                                            community_id: cid_val.to_string(),
                                            layer_id: layer_id.to_string(),
                                            subscriber_pubkey: subscriber_pubkey.to_string(),
                                            subscribed_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or(std::time::Duration::from_millis(0)).as_millis() as u64,
                                        }).await {
                                            Ok(()) => {},
                                            Err(e) => { room.send_to(&messages::json_err(e), &read_cid); continue; }
                                        }
                                        // Get initial layer data (filtered to this layer)
                                        let all_pins = state.store.get_pins(cid_val, 0).await;
                                        let pins: Vec<_> = all_pins.into_iter().filter(|p| p.layer_id.as_deref() == Some(&layer_id)).collect();
                                        let drawings = state.store.get_drawings(cid_val, 0).await;
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
                                        room.send_to(&resp.to_string(), &read_cid);
                                    } else if ty == "unsubscribe_layer" && read_room == "community-relay" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("");
                                        let layer_id = v.get("layer_id").and_then(|l| l.as_str()).unwrap_or("");
                                        let subscriber_pubkey = v.get("subscriber_pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        if cid_val.is_empty() || layer_id.is_empty() || subscriber_pubkey.is_empty() { continue; }
                                        state.store.remove_subscription(cid_val, layer_id, subscriber_pubkey).await;
                                        info!("[relay] unsubscribed {} from layer {}:{}", subscriber_pubkey, cid_val, layer_id);
                                        let resp = serde_json::json!({
                                            "type": "layer_unsubscribed",
                                            "community_id": cid_val,
                                            "layer_id": layer_id,
                                        });
                                        room.send_to(&resp.to_string(), &read_cid);
                                    } else if ty == "sync_subscribed_layers" && read_room == "community-relay" {
                                        let subscriber_pubkey = v.get("subscriber_pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        if subscriber_pubkey.is_empty() { continue; }
                                        let since = v.get("since").and_then(|s| s.as_u64()).unwrap_or(0);
                                        let subscribed = state.store.get_subscribed_layers_for_pubkey(subscriber_pubkey).await;
                                        let mut all_pins: Vec<serde_json::Value> = Vec::new();
                                        let mut all_drawings: Vec<serde_json::Value> = Vec::new();
                                        for (cid, _lid) in &subscribed {
                                            for p in state.store.get_pins(cid, since).await {
                                                all_pins.push(serde_json::json!({"pin_id":p.pin_id,"community_id":cid,"ciphertext":p.ciphertext,"nonce":p.nonce,"author_pubkey":p.author_pubkey,"created_at":p.created_at}));
                                            }
                                            for d in state.store.get_drawings(cid, since).await {
                                                all_drawings.push(serde_json::json!({"drawing_id":d.drawing_id,"community_id":cid,"ciphertext":d.ciphertext,"nonce":d.nonce,"author_pubkey":d.author_pubkey,"created_at":d.created_at}));
                                            }
                                        }
                                        let resp = serde_json::json!({
                                            "type": "subscribed_sync",
                                            "since": since,
                                            "pins": all_pins,
                                            "drawings": all_drawings,
                                        });
                                        room.send_to(&resp.to_string(), &read_cid);
                                    } else if ty == "request_member_dek" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        let member_pubkey = v.get("member_pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        if !cid_val.is_empty() && !member_pubkey.is_empty() {
                                            state.store.add_pending_dek_request(&cid_val, member_pubkey).await;
                                            info!("[relay] member_dek requested for {} in {}", member_pubkey, cid_val);
                                            // Broadcast to community so an existing member can re-wrap
                                            let notif = serde_json::json!({
                                                "type": "member_dek_requested",
                                                "community_id": cid_val,
                                                "member_pubkey": member_pubkey,
                                            });
                                            room.broadcast(&notif.to_string(), &read_cid);
                                            room.send_to(&notif.to_string(), &read_cid);
                                        }
                                    } else if ty == "rewrap_member_dek" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        let target_pubkey = v.get("target_pubkey").and_then(|p| p.as_str()).unwrap_or("");
                                        let rewrap_dek = v.get("rewrap_dek").and_then(|d| d.as_str()).unwrap_or("");
                                        if !cid_val.is_empty() && !target_pubkey.is_empty() && !rewrap_dek.is_empty() {
                                            // Verify sender is a member of the community
                                            if let Some(c) = state.store.get_community(&cid_val).await {
                                                let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                                if let Some(ref cpk) = conn_pubkey {
                                                    if !is_member(&c, cpk) {
                                                        warn!("[relay] rewrap_member_dek: non-member {} attempted for {}", cpk, cid_val);
                                                        continue;
                                                    }
                                                } else {
                                                    continue;
                                                }
                                            }
                                            state.store.store_member_dek(&cid_val, &target_pubkey, &rewrap_dek).await;
                                            state.store.remove_pending_dek_request(&cid_val, &target_pubkey).await;
                                            info!("[relay] member_dek stored for {} in {}", target_pubkey, cid_val);
                                            let resp = serde_json::json!({
                                                "type": "member_dek_ready",
                                                "community_id": cid_val,
                                                "member_pubkey": target_pubkey,
                                                "individually_wrapped_dek": rewrap_dek,
                                            });
                                            room.broadcast(&resp.to_string(), &read_cid);
                                            room.send_to(&resp.to_string(), &read_cid);
                                        }
                                    } else if ty == "join_community" {
                                        let cid_val = v.get("community_id").and_then(|c| c.as_str()).unwrap_or("").to_string();
                                        let request_id = v.get("request_id").and_then(|r| r.as_str()).unwrap_or("");
                                        if let Some(c) = state.store.get_community(&cid_val).await {
                                            let mut denied = false;
                                            if let Some(ref stored_hash) = c.password_hash {
                                                let provided_hash = v.get("password_hash").and_then(|p| p.as_str()).unwrap_or("");
                                                if provided_hash != stored_hash {
                                                    info!("[relay] join_community denied (wrong password): {} -> {}",&read_ip, c.name);
                                                    room.send_to(&serde_json::json!({"type":"community_joined","community_id":cid_val,"error":"wrong_password","request_id":request_id}).to_string(), &read_cid);
                                                    denied = true;
                                                }
                                            }
                                            if !denied {
                                                info!("[relay] join_community: {} -> {}", &read_ip, c.name);
                                                let conn_pubkey = get_conn_pubkey(room, &read_cid);
                                                let is_member = conn_pubkey.as_ref().map_or(false, |pk| c.members.iter().any(|m| m.pubkey == *pk));
                                                let members_for_response: serde_json::Value =
                                                    serde_json::json!(c.members.iter().map(|m| serde_json::json!({
                                                        "pubkey": m.pubkey,
                                                        "display_name": m.display_name,
                                                        "role": m.role,
                                                    })).collect::<Vec<_>>());
                                                let public_layers = state.store.get_public_layers(&cid_val).await;
                                                // Check if requester already has an individually-wrapped DEK
                                                let member_dek = if let Some(ref pk) = conn_pubkey {
                                                    state.store.get_member_dek(&cid_val, pk).await
                                                } else { None };
                                                let resp = serde_json::json!({
                                                    "type": "community_joined",
                                                    "community_id": c.community_id,
                                                    "request_id": request_id,
                                                    "name": c.name,
                                                    "description": c.description,
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
                                                    "your_membership": if is_member { if let Some(ref pk) = conn_pubkey {
                                                        c.members.iter().find(|m| m.pubkey == *pk)
                                                            .map(|m| serde_json::json!({"pubkey": m.pubkey, "display_name": m.display_name, "role": m.role}))
                                                    } else { None } } else { None },
                                                });
                                                room.send_to(&resp.to_string(), &read_cid);
                                            }
                                        }
                                    }
                                    let is_relay_ty = matches!(ty, "register_community" | "publish_community" | "unpublish_community" | "delete_community" | "push_delta" | "sync_request" | "list_communities" | "query_communities" | "join_community" | "pin_vote" | "annotation_vote" | "add_member" | "remove_member" | "create_token" | "claim_membership" | "update_governance" | "auth_response" | "publish_layer" | "unpublish_layer" | "list_public_layers" | "subscribe_layer" | "unsubscribe_layer" | "sync_subscribed_layers" | "request_member_dek" | "rewrap_member_dek");
                                     let is_passthrough = matches!(ty, "push_delta" | "sync_request" | "sync_response" | "relay_hello" | "relay_announce" | "mesh_uplink" | "mesh_downlink" | "gossip_capabilities" | "gossip_query" | "gossip_announce" | "pin_vote" | "annotation_vote" | "request_member_dek" | "rewrap_member_dek" | "offer" | "answer");
                                    if !is_relay_ty && is_passthrough {
                                        if let Some(target) = v.get("to").and_then(|t| t.as_str()) {
                                            room.send_to(&txt, target);
                                        } else {
                                            room.broadcast(&txt, &read_cid);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        } else {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        warn!("Client {} WebSocket error: {}", read_ip, e);
                        break;
                    }
                    None => break,
                }
            }
        }
    }

    room::remove_client(&state, &room_name, &cid).await;
}
