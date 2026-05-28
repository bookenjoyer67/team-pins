use std::collections::HashMap;
use std::sync::Arc;
use rumqttc::AsyncClient;
use tokio::sync::{mpsc, Mutex, RwLock, Semaphore};

use crate::config::Config;
use crate::rate::RateLimiter;
use crate::room::Room;
use crate::share::ShareStore;
use crate::storage::PersistentStore;

pub struct AppState {
    pub rooms: RwLock<HashMap<String, Room>>,
    pub shares: Mutex<ShareStore>,
    pub rl: Mutex<RateLimiter>,
    pub config: Config,
    pub store: PersistentStore,
    pub mesh_uplink: RwLock<Option<mpsc::Sender<String>>>,       // MQTT bridge
    pub reticulum_inject: RwLock<Option<mpsc::Sender<String>>>,  // Reticulum translator
    pub mqtt_client: RwLock<Option<Arc<AsyncClient>>>,
    pub peer_relay_txs: RwLock<HashMap<String, mpsc::Sender<tokio_tungstenite::tungstenite::Message>>>,
    pub conn_semaphore: Arc<Semaphore>,
}
