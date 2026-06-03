use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredPin {
    pub pin_id: String,
    pub community_id: String,
    pub ciphertext: String,
    pub nonce: String,
    pub created_at: u64,
    pub author_pubkey: String,
    pub media: Option<serde_json::Value>,
    pub posted_anonymously: bool,
    pub ttl_expires_at: Option<u64>,
    pub ttl_base_at: Option<u64>,
    pub vote_count_up: u32,
    pub vote_count_down: u32,
    pub layer_id: Option<String>,
    pub emoji: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteRecord {
    pub pin_id: String,
    pub community_id: String,
    pub pubkey: String,
    pub dir: i8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAnnotation {
    pub annotation_id: String,
    pub pin_id: String,
    pub community_id: String,
    pub ciphertext: String,
    pub nonce: String,
    pub author_pubkey: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub votes: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredDrawing {
    pub drawing_id: String,
    pub community_id: String,
    pub ciphertext: String,
    pub nonce: String,
    pub author_pubkey: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberDek {
    pub member_pubkey: String,
    pub individually_wrapped_dek: String,
    pub stored_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTombstone {
    pub tombstone_id: String,
    pub target_id: String,
    pub community_id: String,
    pub by_pubkey: String,
    pub timestamp: u64,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunityConfig {
    pub community_id: String,
    pub name: String,
    pub genesis_public_key: String,
    pub public_key: String,
    pub secret_key: String,
    pub wrapped_dek: String,
    pub key_derivation: String,
    pub published: bool,
    #[serde(default = "default_visibility")]
    pub visibility: String,
    pub description: String,
    pub owner_pubkey: String,
    pub members: Vec<MemberRecord>,
    pub governance: serde_json::Value,
    pub bounds: Option<Vec<f64>>,
    pub password_hash: Option<String>,
    pub join_wrapped_dek: Option<String>,
    pub used_token_nonces: Vec<String>,
}

fn default_visibility() -> String { "public".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteToken {
    pub nonce: String,
    pub community_id: String,
    pub role: String,
    pub expiry: u64,
    pub max_uses: u32,
    pub used_count: u32,
    pub created_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberRecord {
    pub pubkey: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicLayer {
    pub layer_id: String,
    pub community_id: String,
    pub name: String,
    pub topic_tags: Vec<String>,
    pub layer_dek_wrapped: String,
    pub published_at: u64,
    pub published_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerSubscription {
    pub community_id: String,
    pub layer_id: String,
    pub subscriber_pubkey: String,
    pub subscribed_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushSubscription {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapshotData {
    pub communities: Vec<CommunityConfig>,
    pub pins: HashMap<String, Vec<StoredPin>>,
    pub annotations: HashMap<String, Vec<StoredAnnotation>>,
    pub drawings: HashMap<String, Vec<StoredDrawing>>,
    pub tombstones: HashMap<String, StoredTombstone>,
    pub votes: HashMap<String, Vec<VoteRecord>>,
    pub tokens: HashMap<String, Vec<InviteToken>>,
    pub public_layers: HashMap<String, Vec<PublicLayer>>,
    pub layer_subscriptions: HashMap<String, Vec<LayerSubscription>>,
    pub member_deks: HashMap<String, HashMap<String, MemberDek>>,
    pub pending_dek_requests: HashMap<String, Vec<String>>,
    pub push_subscriptions: HashMap<String, Vec<PushSubscription>>,
}

#[derive(Debug)]
pub struct PersistentStore {
    pub communities: RwLock<HashMap<String, CommunityConfig>>,
    pub pins: RwLock<HashMap<String, Vec<StoredPin>>>,
    pub annotations: RwLock<HashMap<String, Vec<StoredAnnotation>>>,
    pub drawings: RwLock<HashMap<String, Vec<StoredDrawing>>>,
    pub tombstones: RwLock<HashMap<String, StoredTombstone>>,
    pub votes: RwLock<HashMap<String, Vec<VoteRecord>>>,
    pub tokens: RwLock<HashMap<String, Vec<InviteToken>>>,
    pub public_layers: RwLock<HashMap<String, Vec<PublicLayer>>>,
    pub layer_subscriptions: RwLock<HashMap<String, Vec<LayerSubscription>>>,
    pub member_deks: RwLock<HashMap<String, HashMap<String, MemberDek>>>,
    pub pending_dek_requests: RwLock<HashMap<String, Vec<String>>>,
    pub push_subscriptions: RwLock<HashMap<String, Vec<PushSubscription>>>,
    snapshot_path: Option<PathBuf>,
    dirty: std::sync::atomic::AtomicBool,
    last_snapshot: tokio::sync::Mutex<std::time::Instant>,
    max_pins_per_community: usize,
}

impl PersistentStore {
    pub fn new(snapshot_path: Option<PathBuf>, max_pins_per_community: usize) -> Self {
        if let Some(ref path) = snapshot_path {
            if let Ok(meta) = std::fs::metadata(path) {
                if meta.len() > 100_000_000 {
                    tracing::error!("[relay] snapshot file too large ({} bytes), data lost — starting fresh", meta.len());
                } else if let Ok(data) = std::fs::read_to_string(path) {
                    let bak = path.with_extension("json.bak");
                    let _ = std::fs::write(&bak, &data);
                    match serde_json::from_str::<SnapshotData>(&data) {
                        Ok(snap) => {
                        let mut communities = HashMap::new();
                        for c in snap.communities {
                            communities.insert(c.community_id.clone(), c);
                        }
                        tracing::info!("[relay] loaded snapshot: {} communities", communities.len());
                         return Self {
                            communities: RwLock::new(communities),
                            pins: RwLock::new(snap.pins),
                            annotations: RwLock::new(snap.annotations),
                            drawings: RwLock::new(snap.drawings),
                            tombstones: RwLock::new(snap.tombstones),
                            votes: RwLock::new(snap.votes),
                            tokens: RwLock::new(snap.tokens),
                            public_layers: RwLock::new(snap.public_layers),
                            layer_subscriptions: RwLock::new(snap.layer_subscriptions),
                            member_deks: RwLock::new(snap.member_deks),
                            pending_dek_requests: RwLock::new(snap.pending_dek_requests),
                            push_subscriptions: RwLock::new(snap.push_subscriptions),
                            snapshot_path,
                            dirty: std::sync::atomic::AtomicBool::new(false),
                            last_snapshot: tokio::sync::Mutex::new(std::time::Instant::now()),
                            max_pins_per_community,
                        };
                    }
                        Err(e) => {
                            tracing::error!("[relay] snapshot parse failed: {} (backup saved to {})", e, bak.display());
                        }
                    }
                }
            }
        }
        Self { communities: RwLock::new(HashMap::new()), pins: RwLock::new(HashMap::new()), annotations: RwLock::new(HashMap::new()), drawings: RwLock::new(HashMap::new()), tombstones: RwLock::new(HashMap::new()), votes: RwLock::new(HashMap::new()), tokens: RwLock::new(HashMap::new()), public_layers: RwLock::new(HashMap::new()), layer_subscriptions: RwLock::new(HashMap::new()), member_deks: RwLock::new(HashMap::new()), pending_dek_requests: RwLock::new(HashMap::new()), push_subscriptions: RwLock::new(HashMap::new()), snapshot_path, dirty: std::sync::atomic::AtomicBool::new(false), last_snapshot: tokio::sync::Mutex::new(std::time::Instant::now()), max_pins_per_community }
    }

    pub async fn save_snapshot(&self) {
        if let Some(ref path) = self.snapshot_path {
            // Clone data under read locks only long enough to copy, then drop locks
            let communities: Vec<CommunityConfig> = {
                let mut list: Vec<CommunityConfig> = self.communities.read().await.values().cloned().collect();
                for c in &mut list {
                    c.secret_key = String::new();
                    c.wrapped_dek = String::new();
                }
                list
            };
            let pins = self.pins.read().await.clone();
            let annotations = self.annotations.read().await.clone();
            let drawings = self.drawings.read().await.clone();
            let tombstones = self.tombstones.read().await.clone();
            let votes = self.votes.read().await.clone();
            let tokens = self.tokens.read().await.clone();
            let public_layers = self.public_layers.read().await.clone();
            let layer_subscriptions = self.layer_subscriptions.read().await.clone();
            let member_deks = self.member_deks.read().await.clone();
            let pending_dek_requests = self.pending_dek_requests.read().await.clone();
            let push_subscriptions = self.push_subscriptions.read().await.clone();

            let snap = SnapshotData {
                communities,
                pins,
                annotations,
                drawings,
                tombstones,
                votes,
                tokens,
                public_layers,
                layer_subscriptions,
                member_deks,
                pending_dek_requests,
                push_subscriptions,
            };

            // Offload CPU-heavy serialization and file I/O to blocking thread pool
            let path = path.clone();
            let result = tokio::task::spawn_blocking(move || {
                let json = serde_json::to_string_pretty(&snap).map_err(|e| e.to_string())?;
                let tmp = path.with_file_name(
                    path.file_name().map(|n| {
                        let mut s = n.to_os_string();
                        s.push(".tmp");
                        s
                    }).unwrap_or_else(|| std::ffi::OsString::from("snapshot.json.tmp"))
                );
                std::fs::write(&tmp, &json).map_err(|e| e.to_string())?;
                std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
                Ok::<_, String>(())
            }).await;

            match result {
                Ok(Ok(())) => {}
                Ok(Err(e)) => tracing::error!("[relay] snapshot failed: {}", e),
                Err(e) => tracing::error!("[relay] snapshot spawn_blocking failed: {}", e),
            }
        }
    }

    pub fn mark_dirty(&self) {
        self.dirty.store(true, std::sync::atomic::Ordering::Release);
    }

    pub async fn flush_if_dirty(&self) {
        if self.dirty.load(std::sync::atomic::Ordering::Acquire) {
            let mut last = self.last_snapshot.lock().await;
            let elapsed = last.elapsed();
            // Minimum 30s between snapshots to prevent serialization storms
            if elapsed.as_secs() < 30 {
                return;
            }
            self.save_snapshot().await;
            *last = std::time::Instant::now();
            self.dirty.store(false, std::sync::atomic::Ordering::Release);
        }
    }

    pub async fn register_community(&self, config: CommunityConfig) {
        {
            let mut map = self.communities.write().await;
            if let Some(existing) = map.get_mut(&config.community_id) {
                existing.name = config.name;
                existing.description = config.description;
                existing.published = config.published;
                existing.public_key = config.public_key;
                existing.wrapped_dek = config.wrapped_dek;
                existing.key_derivation = config.key_derivation;
                existing.governance = config.governance;
                existing.bounds = config.bounds;
                existing.password_hash = config.password_hash;
                existing.genesis_public_key = config.genesis_public_key;
                existing.owner_pubkey = config.owner_pubkey;
                existing.join_wrapped_dek = config.join_wrapped_dek;
            } else {
                map.insert(config.community_id.clone(), config);
            }
        }
        self.mark_dirty();
    }

    pub async fn set_published(&self, community_id: &str, published: bool) {
        {
            let mut map = self.communities.write().await;
            if let Some(c) = map.get_mut(community_id) {
                c.published = published;
            }
        }
        self.mark_dirty();
    }

    pub async fn delete_community(&self, community_id: &str) {
        self.communities.write().await.remove(community_id);
        self.pins.write().await.remove(community_id);
        self.annotations.write().await.remove(community_id);
        self.drawings.write().await.remove(community_id);

        let prefix = format!("{}:", community_id);
        self.votes.write().await.retain(|k, _| !k.starts_with(&prefix));
        self.tombstones.write().await.retain(|_, t| t.community_id != community_id);
        self.tokens.write().await.remove(community_id);
        self.public_layers.write().await.remove(community_id);
        self.layer_subscriptions.write().await.retain(|k, _| !k.starts_with(&prefix));
        self.member_deks.write().await.remove(community_id);
        self.pending_dek_requests.write().await.remove(community_id);

        self.mark_dirty();
    }

    pub async fn delete_pin(&self, community_id: &str, pin_id: &str) {
        {
            let mut pins = self.pins.write().await;
            if let Some(list) = pins.get_mut(community_id) {
                list.retain(|p| p.pin_id != pin_id);
            }
        }
        // Clean vote key outside pins lock
        let vote_key = format!("{}:{}", community_id, pin_id);
        self.votes.write().await.remove(&vote_key);

        // Cascade-delete annotations linked to this pin
        {
            if let Some(list) = self.annotations.write().await.get_mut(community_id) {
                list.retain(|a| a.pin_id != pin_id);
            }
        }

        // Cascade-delete tombstones targeting this pin
        let target_pin = pin_id.to_string();
        self.tombstones.write().await.retain(|_, t| !(t.community_id == community_id && t.target_id == target_pin));

        self.mark_dirty();
    }

    pub async fn get_community(&self, community_id: &str) -> Option<CommunityConfig> {
        self.communities.read().await.get(community_id).cloned()
    }

    pub async fn store_pin(&self, pin: StoredPin) {
        let community_id = pin.community_id.clone();
        let pin_id = pin.pin_id.clone();
        let mut pins = self.pins.write().await;
        let list = pins.entry(community_id.clone()).or_default();
        if let Some(pos) = list.iter().position(|p| p.pin_id == pin.pin_id) {
            list[pos] = pin;
        } else {
            list.push(pin);
            // Evict oldest if over cap
            if self.max_pins_per_community > 0 && list.len() > self.max_pins_per_community {
                if let Some(oldest_idx) = list.iter()
                    .enumerate()
                    .filter(|(_, p)| p.pin_id != pin_id)
                    .min_by_key(|(_, p)| p.created_at)
                    .map(|(i, _)| i)
                {
                    let evicted = list.remove(oldest_idx);
                    let evicted_pin_id = evicted.pin_id.clone();
                    drop(pins);
                    // Cascade cleanup
                    self.votes.write().await.remove(&format!("{}:{}", community_id, evicted_pin_id));
                    if let Some(list) = self.annotations.write().await.get_mut(&community_id) {
                        list.retain(|a| a.pin_id != evicted_pin_id);
                    }
                    self.tombstones.write().await.retain(|_, t| {
                        !(t.community_id == community_id && t.target_id == evicted_pin_id)
                    });
                    tracing::info!("[relay] evicted pin {} from {} (cap={})",
                        evicted_pin_id, community_id, self.max_pins_per_community);
                }
            }
        }
    }

    pub async fn get_pins(&self, community_id: &str, since: u64) -> Vec<StoredPin> {
        self.pins.read().await.get(community_id)
            .map(|pins| pins.iter().filter(|p| p.created_at > since).cloned().collect())
            .unwrap_or_default()
    }

    pub async fn get_pin(&self, community_id: &str, pin_id: &str) -> Option<StoredPin> {
        self.pins.read().await.get(community_id)
            .and_then(|pins| pins.iter().find(|p| p.pin_id == pin_id).cloned())
    }

    pub async fn count_pins(&self, community_id: &str) -> usize {
        self.pins.read().await.get(community_id).map(|v| v.len()).unwrap_or(0)
    }

    pub async fn count_drawings(&self, community_id: &str) -> usize {
        self.drawings.read().await.get(community_id).map(|v| v.len()).unwrap_or(0)
    }

    pub async fn store_annotation(&self, ann: StoredAnnotation) {
        let mut anns = self.annotations.write().await;
        let list = anns.entry(ann.community_id.clone()).or_default();
        if let Some(pos) = list.iter().position(|a| a.annotation_id == ann.annotation_id) {
            list[pos] = ann;
        } else {
            list.push(ann);
        }
    }

    pub async fn get_annotations(&self, community_id: &str, since: u64) -> Vec<StoredAnnotation> {
        self.annotations.read().await.get(community_id)
            .map(|anns| anns.iter().filter(|a| a.updated_at > since || a.created_at > since).cloned().collect())
            .unwrap_or_default()
    }

    pub async fn get_annotation(&self, annotation_id: &str) -> Option<StoredAnnotation> {
        self.annotations.read().await.values()
            .find_map(|anns| anns.iter().find(|a| a.annotation_id == annotation_id).cloned())
    }

    pub async fn store_drawing(&self, dwg: StoredDrawing) {
        let mut drawings = self.drawings.write().await;
        let list = drawings.entry(dwg.community_id.clone()).or_default();
        if let Some(pos) = list.iter().position(|d| d.drawing_id == dwg.drawing_id) {
            list[pos] = dwg;
        } else {
            list.push(dwg);
        }
    }

    pub async fn get_drawings(&self, community_id: &str, since: u64) -> Vec<StoredDrawing> {
        self.drawings.read().await.get(community_id)
            .map(|dwgs| dwgs.iter().filter(|d| d.created_at > since).cloned().collect())
            .unwrap_or_default()
    }

    pub async fn delete_drawing(&self, community_id: &str, drawing_id: &str) {
        if let Some(list) = self.drawings.write().await.get_mut(community_id) {
            list.retain(|d| d.drawing_id != drawing_id);
        }
    }

    pub async fn get_pin_author(&self, community_id: &str, pin_id: &str) -> Option<String> {
        self.pins.read().await.get(community_id)
            .and_then(|pins| pins.iter().find(|p| p.pin_id == pin_id))
            .map(|p| p.author_pubkey.clone())
    }

    pub async fn get_drawing_author(&self, community_id: &str, drawing_id: &str) -> Option<String> {
        self.drawings.read().await.get(community_id)
            .and_then(|dwgs| dwgs.iter().find(|d| d.drawing_id == drawing_id))
            .map(|d| d.author_pubkey.clone())
    }

    pub async fn store_tombstone(&self, t: StoredTombstone) {
        self.tombstones.write().await.insert(t.tombstone_id.clone(), t);
    }

    pub async fn get_tombstones(&self, community_id: &str, since: u64) -> Vec<StoredTombstone> {
        self.tombstones.read().await.iter()
            .filter(|(_, t)| t.community_id == community_id && t.timestamp > since)
            .map(|(_, t)| t.clone())
            .collect()
    }

    pub async fn record_vote(&self, vote: VoteRecord) -> Option<(u32, u32)> {
        let key = format!("{}:{}", vote.community_id, vote.pin_id);
        let result = {
            let mut votes = self.votes.write().await;
            let pin_votes = votes.entry(key).or_default();
            if pin_votes.iter().any(|v| v.pubkey == vote.pubkey) {
                return None;
            }
            pin_votes.push(vote);
            let up = pin_votes.iter().filter(|v| v.dir == 1).count() as u32;
            let down = pin_votes.iter().filter(|v| v.dir == -1).count() as u32;
            Some((up, down))
        };
        self.mark_dirty();
        result
    }

    pub async fn update_pin_ttl(&self, community_id: &str, pin_id: &str, vote_up: u32, vote_down: u32, ttl_expires_at: u64, deleted: bool) {
        {
            let mut pins = self.pins.write().await;
            if let Some(community_pins) = pins.get_mut(community_id) {
                if let Some(pin) = community_pins.iter_mut().find(|p| p.pin_id == pin_id) {
                    pin.vote_count_up = vote_up;
                    pin.vote_count_down = vote_down;
                    if deleted {
                        pin.ttl_expires_at = Some(0);
                    } else {
                        pin.ttl_expires_at = Some(ttl_expires_at);
                    }
                }
            }
        }
        self.mark_dirty();
    }

    pub async fn update_annotation_vote(&self, annotation_id: &str, community_id: &str, vote: serde_json::Value) {
        {
            let mut anns = self.annotations.write().await;
            if let Some(list) = anns.get_mut(community_id) {
                if let Some(ann) = list.iter_mut().find(|a| a.annotation_id == annotation_id) {
                    let mut votes: Vec<serde_json::Value> = ann.votes.as_array().cloned().unwrap_or_default();
                    let pubkey = vote.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
                    if let Some(idx) = votes.iter().position(|v| v.get("pubkey").and_then(|p| p.as_str()).unwrap_or("") == pubkey) {
                        votes[idx] = vote;
                    } else {
                        votes.push(vote);
                    }
                    ann.votes = serde_json::Value::Array(votes);
                    let now = crate::messages::unix_millis();
                    ann.updated_at = now;
                }
            }
        }
        self.mark_dirty();
    }

    pub async fn list_communities(&self) -> Vec<CommunityConfig> {
        self.communities.read().await.values()
            .filter(|c| c.published)
            .cloned().collect()
    }

    pub async fn cleanup_expired_ttls(&self) {
        let now = crate::messages::unix_millis();

        // Phase 1: expire pins — hold pins write lock alone
        let deleted = {
            let mut pins = self.pins.write().await;
            let mut n = 0usize;
            for (_, pin_list) in pins.iter_mut() {
                let before = pin_list.len();
                pin_list.retain(|p| {
                    let keep = p.ttl_expires_at.map_or(true, |e| e > 0 && e > now);
                    keep
                });
                n += before - pin_list.len();
            }
            n
        };

        // Phase 2: clean orphaned annotations — hold anns lock alone
        {
            let pins = self.pins.read().await;
            let valid_pin_ids: std::collections::HashSet<String> = pins
                .values()
                .flat_map(|v| v.iter().map(|p| p.pin_id.clone()))
                .collect();
            drop(pins);
            let mut anns = self.annotations.write().await;
            for (_, ann_list) in anns.iter_mut() {
                ann_list.retain(|a| valid_pin_ids.contains(&a.pin_id));
            }
        }

        // Phase 3: clean orphaned votes — hold votes lock alone
        {
            let pins = self.pins.read().await;
            let valid_vote_keys: std::collections::HashSet<String> = pins
                .iter()
                .flat_map(|(cid, pin_list)| pin_list.iter().map(move |p| format!("{}:{}", cid, p.pin_id)))
                .collect();
            drop(pins);
            self.votes.write().await.retain(|k, _| valid_vote_keys.contains(k));
        }

        if deleted > 0 {
            tracing::info!("[relay] TTL cleanup: removed {} expired pins", deleted);
            self.mark_dirty();
        }
    }

    // ---- Token management ----

    pub async fn register_token(&self, community_id: &str, token: InviteToken) -> Result<(), &'static str> {
        let communities = self.communities.read().await;
        let c = communities.get(community_id).ok_or("community not found")?;
        if !c.members.iter().any(|m| m.pubkey == token.created_by && m.role == "founder") {
            return Err("only founders can create tokens");
        }
        drop(communities);
        // Verify community still exists under token write lock
        let mut tokens = self.tokens.write().await;
        if !self.communities.read().await.contains_key(community_id) {
            return Err("community not found");
        }
        tokens.entry(community_id.to_string()).or_default().push(token);
        self.mark_dirty();
        Ok(())
    }

    pub async fn claim_token(&self, community_id: &str, nonce: &str, pubkey: &str) -> Result<String, &'static str> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_millis() as u64;
        let mut tokens = self.tokens.write().await;
        let list = tokens.get_mut(community_id).ok_or("token not found")?;
        if let Some(t) = list.iter_mut().find(|t| t.nonce == nonce) {
            if t.expiry > 0 && t.expiry < now {
                return Err("token expired");
            }
            if t.max_uses > 0 && t.used_count >= t.max_uses {
                return Err("token uses exhausted");
            }
            t.used_count += 1;
            let role = t.role.clone();
            drop(tokens);
            let mut communities = self.communities.write().await;
            let c = communities.get_mut(community_id).ok_or("community not found")?;
            if c.members.iter().any(|m| m.pubkey == pubkey) {
                return Err("already a member");
            }
            self.mark_dirty();
            Ok(role)
        } else {
            Err("token not found")
        }
    }

    pub async fn add_member(&self, community_id: &str, member: MemberRecord, requester_pubkey: &str) -> Result<(), &'static str> {
        let mut communities = self.communities.write().await;
        let c = communities.get_mut(community_id).ok_or("community not found")?;
        if !c.members.iter().any(|m| m.pubkey == requester_pubkey && m.role == "founder") {
            return Err("only founders can add members");
        }
        if c.members.iter().any(|m| m.pubkey == member.pubkey) {
            return Err("already a member");
        }
        let _member_pubkey = member.pubkey.clone();
        c.members.push(member);
        self.mark_dirty();
        Ok(())
    }

    pub async fn add_member_by_token(&self, community_id: &str, member: MemberRecord) -> Result<(), &'static str> {
        let mut communities = self.communities.write().await;
        let c = communities.get_mut(community_id).ok_or("community not found")?;
        if c.members.iter().any(|m| m.pubkey == member.pubkey) {
            return Err("already a member");
        }
        c.members.push(member);
        self.mark_dirty();
        Ok(())
    }

    pub async fn ensure_member(&self, community_id: &str, pubkey: &str, display_name: &str, role: &str) {
        let mut communities = self.communities.write().await;
        if let Some(c) = communities.get_mut(community_id) {
            if !c.members.iter().any(|m| m.pubkey == pubkey) {
                c.members.push(MemberRecord {
                    pubkey: pubkey.to_string(),
                    display_name: display_name.to_string(),
                    role: role.to_string(),
                });
                self.mark_dirty();
            }
        }
    }

    pub async fn remove_member(&self, community_id: &str, target_pubkey: &str, requester_pubkey: &str) -> Result<(), &'static str> {
        let mut communities = self.communities.write().await;
        let c = communities.get_mut(community_id).ok_or("community not found")?;
        if !c.members.iter().any(|m| m.pubkey == requester_pubkey && m.role == "founder") {
            return Err("only founders can remove members");
        }
        if target_pubkey == requester_pubkey {
            return Err("founder cannot remove themselves");
        }
        let before = c.members.len();
        c.members.retain(|m| m.pubkey != target_pubkey);
        if c.members.len() == before {
            return Err("member not found");
        }
        self.mark_dirty();
        Ok(())
    }

    pub async fn update_governance(&self, community_id: &str, governance: serde_json::Value) {
        let mut communities = self.communities.write().await;
        if let Some(c) = communities.get_mut(community_id) {
            c.governance = governance;
        }
        self.mark_dirty();
    }

    pub async fn cleanup_expired_tokens(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_millis() as u64;
        let mut cleaned = 0usize;
        {
            let mut tokens = self.tokens.write().await;
            for (_, list) in tokens.iter_mut() {
                let before = list.len();
                list.retain(|t| t.expiry == 0 || t.expiry > now);
                list.retain(|t| t.max_uses == 0 || t.used_count < t.max_uses);
                cleaned += before - list.len();
            }
        }
        if cleaned > 0 {
            tracing::info!("[relay] token cleanup: removed {} expired/exhausted tokens", cleaned);
            self.mark_dirty();
        }
    }

    // ---- Public layers + subscriptions ----

    pub async fn publish_layer(&self, layer: PublicLayer) {
        let mut layers = self.public_layers.write().await;
        layers.entry(layer.community_id.clone()).or_default().push(layer);
        self.mark_dirty();
    }

    pub async fn unpublish_layer(&self, community_id: &str, layer_id: &str) {
        let mut layers = self.public_layers.write().await;
        if let Some(list) = layers.get_mut(community_id) {
            list.retain(|l| l.layer_id != layer_id);
        }
        self.mark_dirty();
    }

    pub async fn get_public_layers(&self, community_id: &str) -> Vec<PublicLayer> {
        self.public_layers.read().await.get(community_id).cloned().unwrap_or_default()
    }

    pub async fn has_public_layers(&self, community_id: &str) -> bool {
        self.public_layers.read().await.get(community_id).map(|v| !v.is_empty()).unwrap_or(false)
    }

    pub async fn add_subscription(&self, sub: LayerSubscription) -> Result<(), &'static str> {
        let key = format!("{}:{}", sub.community_id, sub.layer_id);
        let mut subs = self.layer_subscriptions.write().await;
        let list = subs.entry(key).or_default();
        if list.iter().any(|s| s.subscriber_pubkey == sub.subscriber_pubkey) {
            return Err("already subscribed");
        }
        list.push(sub);
        self.mark_dirty();
        Ok(())
    }

    pub async fn remove_subscription(&self, community_id: &str, layer_id: &str, subscriber_pubkey: &str) {
        let key = format!("{}:{}", community_id, layer_id);
        let mut subs = self.layer_subscriptions.write().await;
        if let Some(list) = subs.get_mut(&key) {
            list.retain(|s| s.subscriber_pubkey != subscriber_pubkey);
        }
        self.mark_dirty();
    }

    pub async fn get_subscribers_for_layer(&self, community_id: &str, layer_id: &str) -> Vec<LayerSubscription> {
        let key = format!("{}:{}", community_id, layer_id);
        self.layer_subscriptions.read().await.get(&key).cloned().unwrap_or_default()
    }

    pub async fn get_subscribed_layers_for_pubkey(&self, pubkey: &str) -> Vec<(String, String)> {
        let subs = self.layer_subscriptions.read().await;
        let mut result = Vec::new();
        for (_, list) in subs.iter() {
            for s in list {
                if s.subscriber_pubkey == pubkey {
                    result.push((s.community_id.clone(), s.layer_id.clone()));
                }
            }
        }
        result
    }

    // ---- Member DEK exchange ----

    pub async fn store_member_dek(&self, community_id: &str, member_pubkey: &str, wrapped_dek: &str) {
        let mut deks = self.member_deks.write().await;
        let entry = deks.entry(community_id.to_string()).or_default();
        entry.insert(member_pubkey.to_string(), MemberDek {
            member_pubkey: member_pubkey.to_string(),
            individually_wrapped_dek: wrapped_dek.to_string(),
            stored_at: crate::messages::unix_millis(),
        });
        self.mark_dirty();
    }

    pub async fn get_member_dek(&self, community_id: &str, member_pubkey: &str) -> Option<MemberDek> {
        self.member_deks.read().await
            .get(community_id)
            .and_then(|map| map.get(member_pubkey).cloned())
    }

    pub async fn add_pending_dek_request(&self, community_id: &str, member_pubkey: &str) {
        let mut pending = self.pending_dek_requests.write().await;
        let list = pending.entry(community_id.to_string()).or_default();
        if !list.contains(&member_pubkey.to_string()) {
            list.push(member_pubkey.to_string());
        }
        self.mark_dirty();
    }

    #[allow(dead_code)]
    pub async fn take_pending_dek_requests(&self, community_id: &str) -> Vec<String> {
        let mut pending = self.pending_dek_requests.write().await;
        pending.remove(community_id).unwrap_or_default()
    }

    pub async fn remove_pending_dek_request(&self, community_id: &str, member_pubkey: &str) {
        let mut pending = self.pending_dek_requests.write().await;
        if let Some(list) = pending.get_mut(community_id) {
            list.retain(|p| p != member_pubkey);
        }
        self.mark_dirty();
    }

    #[allow(dead_code)]
    pub async fn get_member_deks_for_community(&self, community_id: &str) -> Vec<MemberDek> {
        self.member_deks.read().await
            .get(community_id)
            .map(|map| map.values().cloned().collect())
            .unwrap_or_default()
    }

    #[allow(dead_code)]
    pub async fn delete_member_dek(&self, community_id: &str, member_pubkey: &str) {
        let mut deks = self.member_deks.write().await;
        if let Some(map) = deks.get_mut(community_id) {
            map.remove(member_pubkey);
        }
        self.mark_dirty();
    }

    // ── Push notification subscriptions ──

    pub async fn add_push_subscription(&self, pubkey: &str, sub: PushSubscription) {
        let mut subs = self.push_subscriptions.write().await;
        subs.entry(pubkey.to_string()).or_default().push(sub);
        self.mark_dirty();
    }

    pub async fn remove_push_subscription(&self, pubkey: &str, endpoint: &str) {
        let mut subs = self.push_subscriptions.write().await;
        if let Some(list) = subs.get_mut(pubkey) {
            let len_before = list.len();
            list.retain(|s| s.endpoint != endpoint);
            if list.len() != len_before { self.mark_dirty(); }
            if list.is_empty() { subs.remove(pubkey); }
        }
    }

    pub async fn get_push_subscriptions(&self, pubkey: &str) -> Vec<PushSubscription> {
        self.push_subscriptions.read().await
            .get(pubkey)
            .cloned()
            .unwrap_or_default()
    }

    pub async fn remove_stale_subscription(&self, endpoint: &str) {
        let mut subs = self.push_subscriptions.write().await;
        let mut dirty = false;
        subs.retain(|_pk, list| {
            let old = list.len();
            list.retain(|s| s.endpoint != endpoint);
            if list.len() != old { dirty = true; }
            !list.is_empty()
        });
        if dirty { self.mark_dirty(); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sub(url: &str) -> PushSubscription {
        PushSubscription {
            endpoint: url.to_string(),
            p256dh: "p256dh_key".into(),
            auth: "auth_secret".into(),
            created_at: 1,
        }
    }

    #[tokio::test]
    async fn test_push_sub_add_and_get() {
        let store = PersistentStore::new(None, 0);
        store.add_push_subscription("pk1", sub("https://fcm.com/1")).await;
        let subs = store.get_push_subscriptions("pk1").await;
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].endpoint, "https://fcm.com/1");
    }

    #[tokio::test]
    async fn test_push_sub_multiple_per_pubkey() {
        let store = PersistentStore::new(None, 0);
        store.add_push_subscription("pk1", sub("https://fcm.com/1")).await;
        store.add_push_subscription("pk1", sub("https://fcm.com/2")).await;
        store.add_push_subscription("pk1", sub("https://fcm.com/3")).await;
        assert_eq!(store.get_push_subscriptions("pk1").await.len(), 3);
    }

    #[tokio::test]
    async fn test_push_sub_remove_by_endpoint() {
        let store = PersistentStore::new(None, 0);
        store.add_push_subscription("pk1", sub("https://fcm.com/1")).await;
        store.add_push_subscription("pk1", sub("https://fcm.com/2")).await;
        store.remove_push_subscription("pk1", "https://fcm.com/1").await;
        let subs = store.get_push_subscriptions("pk1").await;
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].endpoint, "https://fcm.com/2");
    }

    #[tokio::test]
    async fn test_push_sub_remove_nonexistent() {
        let store = PersistentStore::new(None, 0);
        store.add_push_subscription("pk1", sub("https://fcm.com/1")).await;
        store.remove_push_subscription("pk1", "https://fcm.com/nope").await;
        assert_eq!(store.get_push_subscriptions("pk1").await.len(), 1);
    }

    #[tokio::test]
    async fn test_push_sub_stale_cleanup() {
        let store = PersistentStore::new(None, 0);
        store.add_push_subscription("pk1", sub("https://fcm.com/1")).await;
        store.add_push_subscription("pk2", sub("https://fcm.com/1")).await;
        store.remove_stale_subscription("https://fcm.com/1").await;
        assert!(store.get_push_subscriptions("pk1").await.is_empty());
        assert!(store.get_push_subscriptions("pk2").await.is_empty());
    }

    #[tokio::test]
    async fn test_push_sub_pubkey_isolation() {
        let store = PersistentStore::new(None, 0);
        store.add_push_subscription("pk_a", sub("https://fcm.com/a")).await;
        store.add_push_subscription("pk_b", sub("https://fcm.com/b")).await;
        let a_subs = store.get_push_subscriptions("pk_a").await;
        let b_subs = store.get_push_subscriptions("pk_b").await;
        assert_eq!(a_subs.len(), 1);
        assert_eq!(b_subs.len(), 1);
        assert_eq!(a_subs[0].endpoint, "https://fcm.com/a");
        assert_eq!(b_subs[0].endpoint, "https://fcm.com/b");
    }

    #[tokio::test]
    async fn test_push_snapshot_roundtrip() {
        let store = PersistentStore::new(None, 0);
        store.add_push_subscription("pk1", sub("https://fcm.com/1")).await;
        store.add_push_subscription("pk1", sub("https://fcm.com/2")).await;

        let subs_clone = store.push_subscriptions.read().await.clone();
        let snap = SnapshotData {
            communities: vec![],
            pins: HashMap::new(),
            annotations: HashMap::new(),
            drawings: HashMap::new(),
            tombstones: HashMap::new(),
            votes: HashMap::new(),
            tokens: HashMap::new(),
            public_layers: HashMap::new(),
            layer_subscriptions: HashMap::new(),
            member_deks: HashMap::new(),
            pending_dek_requests: HashMap::new(),
            push_subscriptions: subs_clone,
        };
        let json = serde_json::to_string(&snap).unwrap();

        let snap2: SnapshotData = serde_json::from_str(&json).unwrap();
        let restored = PersistentStore {
            communities: RwLock::new(HashMap::new()),
            pins: RwLock::new(HashMap::new()),
            annotations: RwLock::new(HashMap::new()),
            drawings: RwLock::new(HashMap::new()),
            tombstones: RwLock::new(HashMap::new()),
            votes: RwLock::new(HashMap::new()),
            tokens: RwLock::new(HashMap::new()),
            public_layers: RwLock::new(HashMap::new()),
            layer_subscriptions: RwLock::new(HashMap::new()),
            member_deks: RwLock::new(HashMap::new()),
            pending_dek_requests: RwLock::new(HashMap::new()),
            push_subscriptions: RwLock::new(snap2.push_subscriptions),
            snapshot_path: None,
            dirty: std::sync::atomic::AtomicBool::new(false),
            last_snapshot: tokio::sync::Mutex::new(std::time::Instant::now()),
            max_pins_per_community: 0,
        };

        let subs = restored.get_push_subscriptions("pk1").await;
        assert_eq!(subs.len(), 2);
    }

    #[tokio::test]
    async fn test_ensure_member_adds_to_empty() {
        let store = PersistentStore::new(None, 0);
        store.register_community(CommunityConfig {
            community_id: "test-cid".into(),
            name: "Test".into(),
            genesis_public_key: "00".into(),
            public_key: "00".into(),
            secret_key: "00".into(),
            wrapped_dek: "00".into(),
            key_derivation: "random".into(),
            published: false,
            visibility: "public".into(),
            description: "".into(),
            owner_pubkey: "pk1".into(),
            members: vec![],
            governance: serde_json::json!({}),
            bounds: None,
            password_hash: None,
            join_wrapped_dek: None,
            used_token_nonces: vec![],
        }).await;

        store.ensure_member("test-cid", "pkA", "Alice", "contributor").await;
        let c = store.get_community("test-cid").await.unwrap();
        assert_eq!(c.members.len(), 1);
        assert_eq!(c.members[0].pubkey, "pkA");
        assert_eq!(c.members[0].display_name, "Alice");
        assert_eq!(c.members[0].role, "contributor");
    }

    #[tokio::test]
    async fn test_ensure_member_no_duplicate() {
        let store = PersistentStore::new(None, 0);
        store.register_community(CommunityConfig {
            community_id: "test-cid2".into(),
            name: "Test2".into(),
            genesis_public_key: "00".into(),
            public_key: "00".into(),
            secret_key: "00".into(),
            wrapped_dek: "00".into(),
            key_derivation: "random".into(),
            published: false,
            visibility: "public".into(),
            description: "".into(),
            owner_pubkey: "pk1".into(),
            members: vec![],
            governance: serde_json::json!({}),
            bounds: None,
            password_hash: None,
            join_wrapped_dek: None,
            used_token_nonces: vec![],
        }).await;

        store.ensure_member("test-cid2", "pkA", "Alice", "contributor").await;
        store.ensure_member("test-cid2", "pkA", "Alice", "contributor").await;
        let c = store.get_community("test-cid2").await.unwrap();
        assert_eq!(c.members.len(), 1);
    }

    #[tokio::test]
    async fn test_ensure_member_nonexistent_community() {
        let store = PersistentStore::new(None, 0);
        store.ensure_member("nonexistent", "pkA", "Alice", "contributor").await;
        let c = store.get_community("nonexistent").await;
        assert!(c.is_none());
    }

    #[tokio::test]
    async fn test_ensure_member_preserves_existing() {
        let store = PersistentStore::new(None, 0);
        store.register_community(CommunityConfig {
            community_id: "test-cid3".into(),
            name: "Test3".into(),
            genesis_public_key: "00".into(),
            public_key: "00".into(),
            secret_key: "00".into(),
            wrapped_dek: "00".into(),
            key_derivation: "random".into(),
            published: false,
            visibility: "public".into(),
            description: "".into(),
            owner_pubkey: "pk1".into(),
            members: vec![
                MemberRecord { pubkey: "pkA".into(), display_name: "A".into(), role: "founder".into() },
                MemberRecord { pubkey: "pkB".into(), display_name: "B".into(), role: "contributor".into() },
            ],
            governance: serde_json::json!({}),
            bounds: None,
            password_hash: None,
            join_wrapped_dek: None,
            used_token_nonces: vec![],
        }).await;

        store.ensure_member("test-cid3", "pkC", "Charlie", "contributor").await;
        let c = store.get_community("test-cid3").await.unwrap();
        assert_eq!(c.members.len(), 3);
        let pubs: Vec<_> = c.members.iter().map(|m| &m.pubkey).collect();
        assert!(pubs.contains(&&"pkA".to_string()));
        assert!(pubs.contains(&&"pkB".to_string()));
        assert!(pubs.contains(&&"pkC".to_string()));
    }
}
