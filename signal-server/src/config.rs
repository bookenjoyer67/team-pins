use serde::Deserialize;
use tracing::{info, warn};

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    #[serde(default)] pub server: ServerConfig,
    #[serde(default)] pub rooms: RoomsConfig,
    #[serde(default)] pub rate_limit: RateLimitConfig,
    #[serde(default)] pub security: SecurityConfig,
    #[serde(default)] pub share: ShareConfig,
    #[serde(default)] pub mqtt: MqttConfig,
    #[serde(default)] pub rnode: RnodeConfig,
    #[serde(default)] pub peer_relays: PeerRelayConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    #[serde(default = "d_port")] pub port: u16,
    #[serde(default = "d_bind")] pub bind_address: String,
}
fn d_port() -> u16 { 9000 }
fn d_bind() -> String { "0.0.0.0".into() }

impl Default for ServerConfig {
    fn default() -> Self { Self { port: 9000, bind_address: "0.0.0.0".into() } }
}

#[derive(Debug, Deserialize, Clone)]
pub struct RoomsConfig {
    #[serde(default)] pub max_clients: usize,
    #[serde(default = "d_to")] pub room_timeout_secs: u64,
    #[serde(default = "d_mr")] pub max_rooms: usize,
}
fn d_to() -> u64 { 600 }
fn d_mr() -> usize { 1000 }
impl Default for RoomsConfig {
    fn default() -> Self { Self { max_clients: 0, room_timeout_secs: 600, max_rooms: 1000 } }
}

#[derive(Debug, Deserialize, Clone)]
pub struct RateLimitConfig {
    #[serde(default = "d_mps")] pub messages_per_sec: u32,
    #[serde(default = "d_cpm")] pub connections_per_min: u32,
    #[serde(default = "d_ban")] pub ban_duration_secs: u64,
    #[serde(default = "d_cr5")] pub community_regs_per_window: u32,
    #[serde(default = "d_cr600")] pub community_reg_window_secs: u64,
}
fn d_mps() -> u32 { 20 }
fn d_cpm() -> u32 { 30 }
fn d_ban() -> u64 { 3600 }
fn d_cr5() -> u32 { 5 }
fn d_cr600() -> u64 { 600 }
impl Default for RateLimitConfig {
    fn default() -> Self { Self { messages_per_sec: 20, connections_per_min: 30, ban_duration_secs: 3600, community_regs_per_window: 5, community_reg_window_secs: 600 } }
}

#[derive(Debug, Deserialize, Clone)]
pub struct SecurityConfig {
    #[serde(default = "d_true")] pub require_passwords: bool,
    #[serde(default = "d_pl")] pub max_password_len: usize,
    #[serde(default = "d_rl")] pub max_room_len: usize,
    #[serde(default = "d_ms")] pub max_message_size: usize,
}
fn d_pl() -> usize { 128 }
fn d_rl() -> usize { 64 }
fn d_ms() -> usize { 10485760 }
impl Default for SecurityConfig {
    fn default() -> Self {
        Self { require_passwords: false, max_password_len: 128, max_room_len: 64, max_message_size: 10485760 }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct ShareConfig {
    #[serde(default = "d_sp")] pub share_http_port: u16,
    #[serde(default = "d_sms")] pub max_shares: usize,
    #[serde(default = "d_sttl")] pub share_ttl_secs: u64,
    #[serde(default = "d_sttl")] pub max_share_ttl_secs: u64,
    #[serde(default = "d_smb")] pub max_share_bytes: usize,
    #[serde(default = "d_cors")] pub allowed_origin: String,
}
fn d_sp() -> u16 { 9001 }
fn d_sms() -> usize { 1000 }
fn d_sttl() -> u64 { 86400 }
fn d_smb() -> usize { 200 * 1024 * 1024 }
fn d_cors() -> String { "https://app.piggpin.space".into() }
impl Default for ShareConfig {
    fn default() -> Self {
        Self { share_http_port: 9001, max_shares: 1000, share_ttl_secs: 86400, max_share_ttl_secs: 86400, max_share_bytes: d_smb(), allowed_origin: "https://app.piggpin.space".into() }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct MqttConfig {
    #[serde(default = "d_false")] pub enabled: bool,
    #[serde(default = "d_mqtt_addr")] pub broker: String,
    #[serde(default = "d_mqtt_port")] pub port: u16,
    #[serde(default = "d_empty")] pub username: String,
    #[serde(default = "d_empty")] pub password: String,
    #[serde(default = "d_mqtt_root")] pub root_topic: String,
    #[serde(default = "d_mqtt_room")] pub bridge_room: String,
    #[serde(default = "d_false")] pub uplink_enabled: bool,
}
fn d_mqtt_port() -> u16 { 1883 }
fn d_mqtt_addr() -> String { "mqtt.meshtastic.org".into() }
fn d_mqtt_root() -> String { "msh".into() }
fn d_empty() -> String { String::new() }
fn d_mqtt_room() -> String { "mesh".into() }
impl Default for MqttConfig {
    fn default() -> Self {
        Self {
            enabled: false, port: 1883, broker: "mqtt.meshtastic.org".into(),
            username: String::new(), password: String::new(),
            root_topic: "msh".into(),
            bridge_room: "mesh".into(), uplink_enabled: false,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct RnodeConfig {
    #[serde(default = "d_false")] pub enabled: bool,
    #[serde(default = "d_empty")] pub serial_port: String,
    #[serde(default = "d_115200")] pub baud_rate: u32,
    #[serde(default = "d_rnode_room")] pub bridge_room: String,
}
fn d_false() -> bool { false }
fn d_true() -> bool { true }
fn d_115200() -> u32 { 115200 }
fn d_rnode_room() -> String { "rnode".into() }
impl Default for RnodeConfig {
    fn default() -> Self {
        Self { enabled: false, serial_port: String::new(), baud_rate: 115200, bridge_room: "rnode".into() }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct PeerRelayConfig {
    #[serde(default = "d_false")] pub enabled: bool,
    #[serde(default)] pub peer_urls: Vec<String>,
    #[serde(default = "d_announce_interval")] pub announce_interval_secs: u64,
    #[serde(default = "d_reconnect_delay")] pub reconnect_delay_secs: u64,
}
fn d_announce_interval() -> u64 { 300 }
fn d_reconnect_delay() -> u64 { 30 }
impl Default for PeerRelayConfig {
    fn default() -> Self {
        Self { enabled: false, peer_urls: vec![], announce_interval_secs: 300, reconnect_delay_secs: 30 }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            rooms: RoomsConfig::default(),
            rate_limit: RateLimitConfig::default(),
            security: SecurityConfig::default(),
            share: ShareConfig::default(),
            mqtt: MqttConfig::default(),
            rnode: RnodeConfig::default(),
            peer_relays: PeerRelayConfig::default(),
        }
    }
}

pub fn load_config() -> Config {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(1).map(|s| s.as_str()).unwrap_or("config.toml");
    let mut cfg = match std::fs::read_to_string(path) {
        Ok(c) => match toml::from_str(&c) {
            Ok(cfg) => { info!("Loaded config from {}", path); cfg }
            Err(e) => { warn!("Bad config ({}), using defaults", e); Config::default() }
        },
        Err(_) => { info!("No config at {}, using defaults", path); Config::default() }
    };
    if let Ok(v) = std::env::var("MQTT_USERNAME") { cfg.mqtt.username = v; }
    if let Ok(v) = std::env::var("MQTT_PASSWORD") { cfg.mqtt.password = v; }
    if let Ok(v) = std::env::var("MQTT_BROKER") { cfg.mqtt.broker = v; }
    cfg
}
