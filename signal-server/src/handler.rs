use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout, Duration};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tracing::{info, warn, instrument};

use crate::handlers::{self, HandlerContext};
use crate::messages;
use crate::room::{self, Client, Room};
use crate::state::AppState;

#[instrument(skip(state, stream), fields(addr = %addr))]
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
    let channel_cap = state.config.rooms.channel_capacity.max(256);
    let (tx, mut rx) = mpsc::channel::<Message>(channel_cap);

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
        if state.rooms.len() >= state.config.rooms.max_rooms && !state.rooms.contains_key(&room_name) {
            let _ = ws_tx.send(Message::Text(messages::json_err("server full"))).await;
            return;
        }

        if !state.rooms.contains_key(&room_name) {
            state.rooms.insert(room_name.clone(), Room::new());
        }
        let room = state.rooms.get(&room_name).expect("room just inserted");

        let max = state.config.rooms.max_clients;
        if max > 0 && room.clients.len() >= max {
            let _ = ws_tx.send(Message::Text(messages::json_err("room full"))).await;
            return;
        }

        {
            let stored_pw = room.pw_hash.read().unwrap().clone();
            if let Some(ref stored) = stored_pw {
                if password.as_deref().map_or(true, |pw| pw.is_empty() || !messages::check_password(stored, pw)) {
                    let _ = ws_tx.send(Message::Text(messages::json_err("wrong password"))).await;
                    return;
                }
            }
        }

        if let Some(pw) = &password {
            if !pw.is_empty() {
                if pw.len() > state.config.security.max_password_len {
                    let _ = ws_tx.send(Message::Text(messages::json_err("password too long"))).await;
                    return;
                }
                *room.pw_hash.write().unwrap() = Some(messages::hash_password(pw));
            }
        } else if state.config.security.require_passwords && room_name != "community-relay" {
            let _ = ws_tx.send(Message::Text(messages::json_err("password required"))).await;
            return;
        }

        room.broadcast(&messages::json_joined(&cid), "");
        room.clients.insert(cid.clone(), Client {
            tx,
            id: cid.clone(),
            ip: ip.clone(),
            pubkey: std::sync::RwLock::new(None),
            consecutive_drops: AtomicU64::new(0),
        });
        room.touch();
        client_is_relay_room = room_name == "community-relay";
    }

    // Send welcome, then auth challenge for community-relay room
    let _ = ws_tx.send(Message::Text(messages::json_welcome(&cid))).await;
    if client_is_relay_room {
        let (challenge_msg, challenge_hex, challenge_ts) = messages::json_auth_challenge();
        let _ = ws_tx.send(Message::Text(challenge_msg)).await;
        if let Some(room) = state.rooms.get(&room_name) {
            room.challenges.insert(cid.clone(), (challenge_hex, challenge_ts));
        }
    }

    let read_cid = cid.clone();
    let read_room = room_name.clone();
    let read_ip = ip.clone();

    let mut read_buf = ws_rx;
    let mut write_buf = ws_tx;

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Some(msg) => {
                        if write_buf.send(msg).await.is_err() { break; }
                    }
                    None => break,
                }
            }
            _ = sleep(Duration::from_secs(30)) => {
                if write_buf.send(Message::Ping(vec![])).await.is_err() { break; }
            }
            read = read_buf.next() => {
                match read {
                    Some(Ok(Message::Text(txt))) => {
                        if txt.len() > state.config.security.max_message_size { continue; }
                        {
                            let mut rl = state.rl.lock().await;
                            if !rl.check_msg(&read_ip) { continue; }
                        }
                        if let Some(room) = state.rooms.get(&read_room) {
                            room.touch();

                            let ctx = HandlerContext::new(&state, &room, &read_cid, &read_ip, &read_room);
                            let handled = handlers::route_message(&ctx, &txt).await;

                            if !handled {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                                    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                    if handlers::is_passthrough(ty) {
                                        if let Some(target) = v.get("to").and_then(|t| t.as_str()) {
                                            room.send_to(&txt, target);
                                        } else {
                                            room.broadcast(&txt, &read_cid);
                                        }
                                    }
                                }
                            }

                            // Slow-consumer check
                            if let Some(entry) = room.clients.get(&read_cid) {
                                let drops = entry.value().consecutive_drops.swap(0, Ordering::Relaxed);
                                if drops > 50 {
                                    warn!("[relay] client {} slow consumer ({} consecutive drops), disconnecting", read_cid, drops);
                                    break;
                                }
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
