use std::collections::HashMap;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use crate::messages;
use crate::state::AppState;

pub const CHANNEL_CAP: usize = 1024;

pub struct Client {
    pub tx: tokio::sync::mpsc::Sender<Message>,
    pub id: String,
    pub ip: String,
    pub pubkey: Option<String>,
}

pub struct Room {
    pub clients: HashMap<String, Client>,
    pub pw_hash: Option<String>,
    pub last_act: Instant,
    pub challenges: HashMap<String, (String, u64)>,  // cid → (challenge_hex, ts)
}

impl Room {
    pub fn broadcast(&self, txt: &str, exclude: &str) {
        let msg = Message::Text(txt.to_string());
        for (cid, c) in &self.clients {
            if cid != exclude {
                if c.tx.try_send(msg.clone()).is_err() {
                    warn!("[room] broadcast drop for client {} (channel full)", c.id);
                }
            }
        }
    }
    
    #[allow(dead_code)]
    pub fn broadcast_with_info(&self, txt: &str, exclude: &str, info: &str) {
        let msg = Message::Text(txt.to_string());
        let mut sent = 0;
        let mut dropped = 0;
        for (cid, c) in &self.clients {
            if cid != exclude {
                if c.tx.try_send(msg.clone()).is_err() {
                    dropped += 1;
                } else {
                    sent += 1;
                }
            }
        }
        info!("[relay] broadcast {}: sent to {} clients, {} dropped ({} total)", info, sent, dropped, self.clients.len());
    }

    pub fn send_to(&self, txt: &str, target: &str) {
        if let Some(c) = self.clients.get(target) {
            if c.tx.try_send(Message::Text(txt.to_string())).is_err() {
                warn!("[room] send_to drop for client {} (channel full)", c.id);
            }
        }
    }

    pub fn broadcast_to_members(&self, community: &crate::storage::CommunityConfig, txt: &str, exclude: &str) {
        let msg = Message::Text(txt.to_string());
        for (cid, c) in &self.clients {
            if cid != exclude {
                if let Some(ref pk) = c.pubkey {
                    if community.members.iter().any(|m| m.pubkey == *pk) {
                        if c.tx.try_send(msg.clone()).is_err() {
                            warn!("[room] broadcast_to_members drop for client {} (channel full)", c.id);
                        }
                    }
                }
            }
        }
    }
}

pub async fn remove_client(state: &AppState, room_name: &str, cid: &str) {
    let mut rooms = state.rooms.write().await;
    if let Some(room) = rooms.get_mut(room_name) {
        if let Some(c) = room.clients.remove(cid) {
            info!("{} ({}) left room {}", c.id, c.ip, room_name);
        }
        if room.clients.is_empty() {
            rooms.remove(room_name);
            info!("Room {} deleted", room_name);
        } else {
            room.broadcast(&messages::json_left(cid), "");
            room.last_act = Instant::now();
        }
    }
}
