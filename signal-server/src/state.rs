use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Instant;

use std::sync::RwLock as StdRwLock;

use dashmap::DashMap;
use tokio::sync::{Mutex, Semaphore};

use crate::config::Config;
use crate::rate::RateLimiter;
use crate::room::Room;
use crate::share::ShareStore;
use crate::storage::PersistentStore;

#[cfg(feature = "peer-relay")]
use std::collections::HashMap;
#[cfg(any(feature = "mqtt-bridge", feature = "reticulum-bridge", feature = "peer-relay"))]
use tokio::sync::{mpsc, RwLock};

pub struct AppState {
    pub rooms: DashMap<String, Room>,
    pub shares: Mutex<ShareStore>,
    pub rl: Mutex<RateLimiter>,
    pub config: Config,
    pub store: PersistentStore,
    #[cfg(feature = "mqtt-bridge")]
    pub mesh_uplink: RwLock<Option<mpsc::Sender<String>>>,
    #[cfg(feature = "reticulum-bridge")]
    #[allow(dead_code)]
    pub reticulum_inject: RwLock<Option<mpsc::Sender<String>>>,
    #[cfg(feature = "mqtt-bridge")]
    pub mqtt_client: RwLock<Option<Arc<rumqttc::AsyncClient>>>,
    #[cfg(feature = "peer-relay")]
    pub peer_relay_txs: RwLock<HashMap<String, mpsc::Sender<tokio_tungstenite::tungstenite::Message>>>,
    pub conn_semaphore: Arc<Semaphore>,
    pub start_time: Instant,
    pub connections_accepted: AtomicU64,
    pub connections_rejected: AtomicU64,
    pub last_snapshot_time: StdRwLock<Option<u64>>,
}
