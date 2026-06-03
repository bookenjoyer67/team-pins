use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;
use std::time::Duration;

use dashmap::DashMap;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use crate::messages;

pub struct Client {
    pub tx: tokio::sync::mpsc::Sender<Message>,
    pub id: String,
    pub ip: String,
    pub pubkey: RwLock<Option<String>>,
    pub consecutive_drops: AtomicU64,
}

pub struct Room {
    pub clients: DashMap<String, Client>,
    pub pw_hash: RwLock<Option<String>>,
    pub last_act: AtomicU64,
    pub challenges: DashMap<String, (String, u64)>,
    pub dropped_messages: AtomicU64,
}

impl Room {
    pub fn new() -> Self {
        Self {
            clients: DashMap::new(),
            pw_hash: RwLock::new(None),
            last_act: AtomicU64::new(messages::unix_millis()),
            challenges: DashMap::new(),
            dropped_messages: AtomicU64::new(0),
        }
    }

    pub fn touch(&self) {
        self.last_act.store(messages::unix_millis(), Ordering::Relaxed);
    }

    pub fn elapsed_ms(&self) -> u64 {
        messages::unix_millis().saturating_sub(self.last_act.load(Ordering::Relaxed))
    }

    pub fn client_count(&self) -> usize {
        self.clients.len()
    }

    pub fn is_empty(&self) -> bool {
        self.clients.is_empty()
    }

    pub fn broadcast(&self, txt: &str, exclude: &str) {
        let msg = Message::Text(txt.to_string());
        for entry in self.clients.iter() {
            if entry.key() != exclude {
                if entry.value().tx.try_send(msg.clone()).is_err() {
                    entry.value().consecutive_drops.fetch_add(1, Ordering::Relaxed);
                    self.dropped_messages.fetch_add(1, Ordering::Relaxed);
                    warn!("[room] broadcast drop for client {} (channel full)", entry.value().id);
                } else {
                    entry.value().consecutive_drops.store(0, Ordering::Relaxed);
                }
            }
        }
    }

    #[allow(dead_code)]
    pub fn broadcast_with_info(&self, txt: &str, exclude: &str, info: &str) {
        let msg = Message::Text(txt.to_string());
        let mut sent = 0;
        let mut dropped = 0;
        for entry in self.clients.iter() {
            if entry.key() != exclude {
                if entry.value().tx.try_send(msg.clone()).is_err() {
                    dropped += 1;
                    entry.value().consecutive_drops.fetch_add(1, Ordering::Relaxed);
                } else {
                    sent += 1;
                    entry.value().consecutive_drops.store(0, Ordering::Relaxed);
                }
            }
        }
        self.dropped_messages.fetch_add(dropped, Ordering::Relaxed);
        info!("[relay] broadcast {}: sent to {} clients, {} dropped ({} total)", info, sent, dropped, self.clients.len());
    }

    pub fn send_to(&self, txt: &str, target: &str) {
        if let Some(entry) = self.clients.get(target) {
            if entry.value().tx.try_send(Message::Text(txt.to_string())).is_err() {
                entry.value().consecutive_drops.fetch_add(1, Ordering::Relaxed);
                self.dropped_messages.fetch_add(1, Ordering::Relaxed);
                warn!("[room] send_to drop for client {} (channel full)", entry.value().id);
            } else {
                entry.value().consecutive_drops.store(0, Ordering::Relaxed);
            }
        }
    }

    pub fn broadcast_to_members(
        &self,
        community: &crate::storage::CommunityConfig,
        txt: &str,
        exclude: &str,
    ) {
        let msg = Message::Text(txt.to_string());
        for entry in self.clients.iter() {
            if entry.key() != exclude {
                if let Some(ref pk) = *entry.value().pubkey.read().unwrap() {
                    if community.members.iter().any(|m| m.pubkey == *pk) {
                        if entry.value().tx.try_send(msg.clone()).is_err() {
                            entry.value().consecutive_drops.fetch_add(1, Ordering::Relaxed);
                            self.dropped_messages.fetch_add(1, Ordering::Relaxed);
                            warn!("[room] broadcast_to_members drop for client {} (channel full)", entry.value().id);
                        } else {
                            entry.value().consecutive_drops.store(0, Ordering::Relaxed);
                        }
                    }
                }
            }
        }
    }

    pub async fn broadcast_guaranteed(&self, txt: &str, exclude: &str, timeout_ms: u64) -> u64 {
        let msg = Message::Text(txt.to_string());
        let mut dropped = 0u64;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(5000); // hard cap
        for entry in self.clients.iter() {
            if entry.key() != exclude {
                if tokio::time::Instant::now() >= deadline {
                    // Total iteration exceeded cap — skip remaining clients
                    dropped += 1;
                    continue;
                }
                match tokio::time::timeout(
                    Duration::from_millis(timeout_ms),
                    entry.value().tx.send(msg.clone()),
                ).await {
                    Err(_) | Ok(Err(_)) => {
                        entry.value().consecutive_drops.fetch_add(1, Ordering::Relaxed);
                        self.dropped_messages.fetch_add(1, Ordering::Relaxed);
                        dropped += 1;
                    }
                    Ok(Ok(())) => {
                        entry.value().consecutive_drops.store(0, Ordering::Relaxed);
                    }
                }
            }
        }
        if dropped > 0 {
            warn!("[room] broadcast_guaranteed: {} dropped", dropped);
        }
        dropped
    }

    pub async fn send_to_guaranteed(&self, txt: &str, target: &str, timeout_ms: u64) -> bool {
        if let Some(entry) = self.clients.get(target) {
            match tokio::time::timeout(
                Duration::from_millis(timeout_ms),
                entry.value().tx.send(Message::Text(txt.to_string())),
            ).await {
                Ok(Ok(())) => {
                    entry.value().consecutive_drops.store(0, Ordering::Relaxed);
                    return true;
                }
                _ => {
                    entry.value().consecutive_drops.fetch_add(1, Ordering::Relaxed);
                    self.dropped_messages.fetch_add(1, Ordering::Relaxed);
                    warn!("[room] send_to_guaranteed drop for client {} (timeout)", entry.value().id);
                }
            }
        }
        false
    }

    pub async fn broadcast_to_members_guaranteed(
        &self,
        community: &crate::storage::CommunityConfig,
        txt: &str,
        exclude: &str,
        timeout_ms: u64,
    ) -> u64 {
        let msg = Message::Text(txt.to_string());
        let mut dropped = 0u64;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(5000);
        for entry in self.clients.iter() {
            if entry.key() != exclude {
                if tokio::time::Instant::now() >= deadline {
                    dropped += 1;
                    continue;
                }
                let is_member = match *entry.value().pubkey.read().unwrap() {
                    Some(ref pk) => community.members.iter().any(|m| m.pubkey == *pk),
                    None => false,
                };
                if is_member {
                    match tokio::time::timeout(
                        Duration::from_millis(timeout_ms),
                        entry.value().tx.send(msg.clone()),
                    ).await {
                        Err(_) | Ok(Err(_)) => {
                            entry.value().consecutive_drops.fetch_add(1, Ordering::Relaxed);
                            self.dropped_messages.fetch_add(1, Ordering::Relaxed);
                            dropped += 1;
                        }
                        Ok(Ok(())) => {
                            entry.value().consecutive_drops.store(0, Ordering::Relaxed);
                        }
                    }
                }
            }
        }
        if dropped > 0 {
            warn!("[room] broadcast_to_members_guaranteed: {} dropped", dropped);
        }
        dropped
    }
}

pub async fn remove_client(state: &crate::state::AppState, room_name: &str, cid: &str) {
    let should_remove: bool;
    {
        let room = match state.rooms.get(room_name) {
            Some(r) => r,
            None => return,
        };
        if let Some((_, c)) = room.clients.remove(cid) {
            info!("{} ({}) left room {}", c.id, c.ip, room_name);
        }
        should_remove = room.clients.is_empty();
        if !should_remove {
            room.broadcast(&messages::json_left(cid), "");
            room.touch();
        }
    }
    if should_remove {
        state.rooms.remove(room_name);
        info!("Room {} deleted", room_name);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::RwLock;
    use std::time::Duration;

    use super::*;

    fn test_client(id: &str, cap: usize) -> (Client, tokio::sync::mpsc::Receiver<Message>) {
        let (tx, rx) = tokio::sync::mpsc::channel::<Message>(cap);
        let client = Client {
            tx,
            id: id.to_string(),
            ip: "127.0.0.1".to_string(),
            pubkey: RwLock::new(None),
            consecutive_drops: AtomicU64::new(0),
        };
        (client, rx)
    }

    fn make_room_with_clients(count: usize) -> (Room, Vec<tokio::sync::mpsc::Receiver<Message>>) {
        let room = Room::new();
        let mut receivers = Vec::new();
        for i in 0..count {
            let (client, rx) = test_client(&format!("c{}", i), 1024);
            receivers.push(rx);
            room.clients.insert(format!("c{}", i), client);
        }
        (room, receivers)
    }

    #[tokio::test]
    async fn test_room_new_defaults() {
        let room = Room::new();
        assert!(room.clients.is_empty());
        assert_eq!(room.dropped_messages.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn test_touch_updates_last_act() {
        let room = Room::new();
        tokio::time::sleep(Duration::from_millis(20)).await;
        let before = room.elapsed_ms();
        assert!(before > 0, "should have elapsed some time");
        tokio::time::sleep(Duration::from_millis(5)).await;
        room.touch();
        let after = room.elapsed_ms();
        assert!(after < before, "elapsed should decrease after touch: before={}, after={}", before, after);
    }

    #[tokio::test]
    async fn test_elapsed_ms_positive_after_sleep() {
        let room = Room::new();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(room.elapsed_ms() > 0);
    }

    #[tokio::test]
    async fn test_broadcast_delivers_to_all() {
        let (room, mut receivers) = make_room_with_clients(2);
        room.broadcast("hello", "");
        for rx in &mut receivers {
            let msg = rx.try_recv().unwrap();
            assert_eq!(msg.to_string(), "hello");
        }
    }

    #[tokio::test]
    async fn test_broadcast_excludes_client() {
        let (room, mut receivers) = make_room_with_clients(2);
        room.broadcast("hello", "c0");
        // c1 should receive, c0 should not
        assert!(receivers[1].try_recv().is_ok());
        assert!(receivers[0].try_recv().is_err());
    }

    #[tokio::test]
    async fn test_send_to_targets_single() {
        let (room, mut receivers) = make_room_with_clients(2);
        room.send_to("hello", "c1");
        assert!(receivers[0].try_recv().is_err());
        assert!(receivers[1].try_recv().is_ok());
    }

    #[tokio::test]
    async fn test_try_send_tracks_drops_on_full() {
        // Create a client with capacity 1, fill it
        let (tx, _rx) = tokio::sync::mpsc::channel::<Message>(1);
        tx.try_send(Message::Text("fill".into())).unwrap();
        let client = Client {
            tx: tx.clone(),
            id: "c0".into(),
            ip: "127.0.0.1".into(),
            pubkey: RwLock::new(None),
            consecutive_drops: AtomicU64::new(0),
        };
        let room = Room::new();
        room.clients.insert("c0".into(), client);
        let before = room.dropped_messages.load(Ordering::Relaxed);
        room.broadcast("drop", "");
        assert!(room.dropped_messages.load(Ordering::Relaxed) > before);
    }

    #[tokio::test]
    async fn test_broadcast_to_members_filters_non_members() {
        let room = Room::new();
        let (client, mut rx) = test_client("c0", 1024);
        *client.pubkey.write().unwrap() = Some("member_pk".into());
        room.clients.insert("c0".into(), client);

        let community = crate::storage::CommunityConfig {
            community_id: "x".into(), name: "x".into(),
            genesis_public_key: "".into(), public_key: "".into(), secret_key: "".into(),
            wrapped_dek: "".into(), key_derivation: "".into(), published: false,
            visibility: "public".into(),
            description: "".into(), owner_pubkey: "".into(),
            members: vec![crate::storage::MemberRecord {
                pubkey: "member_pk".into(), display_name: "A".into(), role: "founder".into(),
            }],
            governance: serde_json::json!({}), bounds: None,
            password_hash: None, join_wrapped_dek: None, used_token_nonces: vec![],
        };

        room.broadcast_to_members(&community, "hello", "");
        assert!(rx.try_recv().is_ok());
    }

    #[tokio::test]
    async fn test_broadcast_guaranteed_timeout_on_full() {
        let (tx, _rx) = tokio::sync::mpsc::channel::<Message>(1);
        tx.try_send(Message::Text("x".into())).unwrap();
        let client = Client {
            tx, id: "c0".into(), ip: "127.0.0.1".into(),
            pubkey: RwLock::new(None), consecutive_drops: AtomicU64::new(0),
        };
        let room = Room::new();
        room.clients.insert("c0".into(), client);
        let before = room.dropped_messages.load(Ordering::Relaxed);
        let drops = room.broadcast_guaranteed("test", "", 100).await;
        assert_eq!(drops, 1);
        assert!(room.dropped_messages.load(Ordering::Relaxed) > before);
    }

    #[tokio::test]
    async fn test_send_to_guaranteed_returns_true_on_delivery() {
        let (room, mut receivers) = make_room_with_clients(1);
        let ok = room.send_to_guaranteed("hello", "c0", 500).await;
        assert!(ok);
        assert!(receivers[0].try_recv().is_ok());
    }

    #[tokio::test]
    async fn test_send_to_guaranteed_returns_false_on_full() {
        let (tx, _rx) = tokio::sync::mpsc::channel::<Message>(1);
        tx.try_send(Message::Text("x".into())).unwrap();
        let client = Client {
            tx, id: "c0".into(), ip: "127.0.0.1".into(),
            pubkey: RwLock::new(None), consecutive_drops: AtomicU64::new(0),
        };
        let room = Room::new();
        room.clients.insert("c0".into(), client);
        let ok = room.send_to_guaranteed("test", "c0", 100).await;
        assert!(!ok);
    }

    #[tokio::test]
    async fn test_consecutive_drops_reset_on_successful_send() {
        let (room, _receivers) = make_room_with_clients(1);
        // Artificially set consecutive_drops high
        room.clients.get("c0").unwrap().value().consecutive_drops.store(10, Ordering::Relaxed);
        // Successful delivery resets it
        room.send_to_guaranteed("ok", "c0", 500).await;
        assert_eq!(room.clients.get("c0").unwrap().value().consecutive_drops.load(Ordering::Relaxed), 0);
    }
}
