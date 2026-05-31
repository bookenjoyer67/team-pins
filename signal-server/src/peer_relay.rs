use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::time::sleep;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn};

use crate::state::AppState;

pub async fn start_federation(state: Arc<AppState>) {
    let peer_urls = state.config.peer_relays.peer_urls.clone();
    if peer_urls.is_empty() {
        info!("[peer_relay] federation enabled but no peer URLs configured");
        return;
    }

    info!("[peer_relay] starting federation with {} peer(s)", peer_urls.len());

    for url in peer_urls {
        let s = state.clone();
        tokio::spawn(async move {
            connect_peer_loop(s, url).await;
        });
    }

    // Announce loop: periodically broadcast community list to all peers
    let s = state.clone();
    tokio::spawn(async move {
        let interval = s.config.peer_relays.announce_interval_secs;
        loop {
            sleep(Duration::from_secs(interval)).await;
            announce_communities(&s).await;
        }
    });
}

async fn connect_peer_loop(state: Arc<AppState>, url: String) {
    let mut backoff = Duration::from_secs(state.config.peer_relays.reconnect_delay_secs);

    loop {
        info!("[peer_relay] connecting to peer: {}", url);
        match connect_async(&url).await {
            Ok((ws_stream, _)) => {
                info!("[peer_relay] connected to peer: {}", url);
                backoff = Duration::from_secs(state.config.peer_relays.reconnect_delay_secs);

                // Clean up any previous entry before inserting new one
                {
                    let mut txs = state.peer_relay_txs.write().await;
                    txs.remove(&url);
                }

                let (mut ws_tx, ws_rx) = ws_stream.split();
                let (tx, mut rx) = mpsc::channel::<Message>(1024);

                // Register this peer
                {
                    let mut txs = state.peer_relay_txs.write().await;
                    txs.insert(url.clone(), tx);
                }

                // Send hello with our community list
                send_hello(&state, &url).await;

                // Spawn write half
let _write_state = state.clone();
let _write_url = url.clone();
                let write_handle = tokio::spawn(async move {
                    while let Some(msg) = rx.recv().await {
                        if ws_tx.send(msg).await.is_err() { break; }
                    }
                });

                // Read loop: forward incoming messages
                let _read_state = state.clone();
                let read_url = url.clone();
                let mut peer_rx = ws_rx;
                while let Some(msg) = peer_rx.next().await {
                    match msg {
                        Ok(Message::Text(txt)) => {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
                                let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                match ty {
                                    "relay_hello" => {
                                        if let Some(comms) = v.get("communities").and_then(|c| c.as_array()) {
                                            for c in comms {
                                                if let (Some(cid), Some(name)) = (c.get("community_id").and_then(|v| v.as_str()), c.get("name").and_then(|v| v.as_str())) {
                                                    info!("[peer_relay] discovered community via {}: {} ({})", &read_url, name, cid);
                                                }
                                            }
                                        }
                                    }
                                    "relay_announce" => {
                                        info!("[peer_relay] relay announce from {}", &read_url);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Ok(Message::Ping(_)) => {}
                        Ok(Message::Close(_)) => break,
                        Err(e) => { warn!("[peer_relay] read error from {}: {}", &read_url, e); break; }
                        _ => {}
                    }
                }

                // Disconnected — cancel write handle
                write_handle.abort();
                warn!("[peer_relay] disconnected from {}", url);
            }
            Err(e) => {
                warn!("[peer_relay] failed to connect to {}: {}", url, e);
            }
        }

        sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(state.config.peer_relays.max_reconnect_delay_secs));
    }
}

async fn send_hello(state: &AppState, peer_url: &str) {
    let communities = state.store.list_communities().await;
    let mut comm_data = Vec::new();
    for c in &communities {
        let has_public = state.store.has_public_layers(&c.community_id).await;
        comm_data.push(serde_json::json!({
            "community_id": c.community_id,
            "name": c.name,
            "bounds": c.bounds,
            "member_count": c.members.len(),
            "has_public_layers": has_public,
        }));
    }
    let announce = serde_json::json!({
        "type": "relay_hello",
        "relay_id": "piggpin",
        "communities": comm_data,
    }).to_string();

    let txs = state.peer_relay_txs.read().await;
    if let Some(tx) = txs.get(peer_url) {
        if tx.send(Message::Text(announce)).await.is_err() {
            warn!("[peer_relay] failed to send hello to {}", peer_url);
        }
    }
}

async fn announce_communities(state: &AppState) {
    let communities = state.store.list_communities().await;
    if communities.is_empty() { return; }

    let mut comm_data = Vec::new();
    for c in &communities {
        let has_public = state.store.has_public_layers(&c.community_id).await;
        comm_data.push(serde_json::json!({
            "community_id": c.community_id,
            "name": c.name,
            "bounds": c.bounds,
            "member_count": c.members.len(),
            "has_public_layers": has_public,
        }));
    }
    let announce = serde_json::json!({
        "type": "relay_announce",
        "relay_id": "piggpin",
        "communities": comm_data,
    }).to_string();

    let txs = state.peer_relay_txs.read().await;
    for (url, tx) in txs.iter() {
        if tx.send(Message::Text(announce.clone())).await.is_err() {
            warn!("[peer_relay] failed to send announce to {}", url);
        }
    }
}
