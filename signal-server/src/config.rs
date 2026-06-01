use serde::Deserialize;
use tracing::{info, warn};

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    #[serde(default)] pub server: ServerConfig,
    #[serde(default)] pub rooms: RoomsConfig,
    #[serde(default)] pub rate_limit: RateLimitConfig,
    #[serde(default)] pub security: SecurityConfig,
    #[serde(default)] pub share: ShareConfig,
    #[cfg(feature = "mqtt-bridge")]
    #[serde(default)]
    pub mqtt: MqttConfig,
    #[cfg(feature = "rnode-bridge")]
    #[serde(default)]
    pub rnode: RnodeConfig,
    #[cfg(feature = "peer-relay")]
    #[serde(default)]
    pub peer_relays: PeerRelayConfig,
    #[serde(default)] pub storage: StorageConfig,
    #[serde(default)] pub push: PushConfig,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    #[serde(default = "d_port")] pub port: u16,
    #[serde(default = "d_bind")] pub bind_address: String,
    #[serde(default = "d_max_conn")] pub max_connections: usize,
    #[serde(default = "d_conn_wait")] pub connection_wait_secs: u64,
    #[serde(default)] pub tls_cert: Option<String>,
    #[serde(default)] pub tls_key: Option<String>,
}
fn d_port() -> u16 { 9000 }
fn d_bind() -> String { "0.0.0.0".into() }
fn d_max_conn() -> usize { 1000 }
fn d_conn_wait() -> u64 { 10 }

impl Default for ServerConfig {
    fn default() -> Self { Self { port: 9000, bind_address: "0.0.0.0".into(), max_connections: 1000, connection_wait_secs: 10, tls_cert: None, tls_key: None } }
}

#[derive(Debug, Deserialize, Clone)]
pub struct RoomsConfig {
    #[serde(default)] pub max_clients: usize,
    #[serde(default = "d_to")] pub room_timeout_secs: u64,
    #[serde(default = "d_mr")] pub max_rooms: usize,
    #[serde(default = "d_cc")] pub channel_capacity: usize,
}
fn d_to() -> u64 { 600 }
fn d_mr() -> usize { 1000 }
fn d_cc() -> usize { 2048 }
impl Default for RoomsConfig {
    fn default() -> Self { Self { max_clients: 0, room_timeout_secs: 600, max_rooms: 1000, channel_capacity: 2048 } }
}

#[derive(Debug, Deserialize, Clone)]
pub struct RateLimitConfig {
    #[serde(default = "d_mps")] pub messages_per_sec: u32,
    #[serde(default = "d_cpm")] pub connections_per_min: u32,
    #[serde(default = "d_ban")] pub ban_duration_secs: u64,
    #[serde(default = "d_cr5")] pub community_regs_per_window: u32,
    #[serde(default = "d_cr600")] pub community_reg_window_secs: u64,
    #[serde(default = "d_graduated")] pub graduated_ban_durations_secs: Vec<u64>,
}
fn d_mps() -> u32 { 20 }
fn d_cpm() -> u32 { 30 }
fn d_ban() -> u64 { 3600 }
fn d_cr5() -> u32 { 5 }
fn d_cr600() -> u64 { 600 }
fn d_graduated() -> Vec<u64> { vec![60, 300, 1800, 7200, 86400] }
impl Default for RateLimitConfig {
    fn default() -> Self { Self { messages_per_sec: 20, connections_per_min: 30, ban_duration_secs: 3600, community_regs_per_window: 5, community_reg_window_secs: 600, graduated_ban_durations_secs: d_graduated() } }
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

#[cfg(feature = "mqtt-bridge")]
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
#[cfg(feature = "mqtt-bridge")]
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

#[cfg(feature = "rnode-bridge")]
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
#[cfg(feature = "rnode-bridge")]
impl Default for RnodeConfig {
    fn default() -> Self {
        Self { enabled: false, serial_port: String::new(), baud_rate: 115200, bridge_room: "rnode".into() }
    }
}

#[cfg(feature = "peer-relay")]
#[derive(Debug, Deserialize, Clone)]
pub struct PeerRelayConfig {
    #[serde(default = "d_false")] pub enabled: bool,
    #[serde(default)] pub peer_urls: Vec<String>,
    #[serde(default = "d_announce_interval")] pub announce_interval_secs: u64,
    #[serde(default = "d_reconnect_delay")] pub reconnect_delay_secs: u64,
    #[serde(default = "d_max_backoff")] pub max_reconnect_delay_secs: u64,
}
fn d_announce_interval() -> u64 { 300 }
fn d_reconnect_delay() -> u64 { 30 }
fn d_max_backoff() -> u64 { 300 }
#[cfg(feature = "peer-relay")]
impl Default for PeerRelayConfig {
    fn default() -> Self {
        Self { enabled: false, peer_urls: vec![], announce_interval_secs: 300, reconnect_delay_secs: 30, max_reconnect_delay_secs: 300 }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct StorageConfig {
    /// Maximum pins per community (0 = unlimited). Oldest pins evicted when exceeded.
    #[serde(default)] pub max_pins_per_community: usize,
    /// Maximum pins per push delta (0 = unlimited). Deltas exceeding this are rejected.
    #[serde(default = "d_pins_per_push")] pub max_pins_per_push: usize,
    /// Maximum annotations per push delta (0 = unlimited).
    #[serde(default = "d_200")] pub max_annotations_per_push: usize,
    /// Maximum drawings per push delta (0 = unlimited).
    #[serde(default = "d_200")] pub max_drawings_per_push: usize,
    /// Maximum tombstones per push delta (0 = unlimited).
    #[serde(default = "d_200")] pub max_tombstones_per_push: usize,
    /// Maximum deleted pin IDs per push delta (0 = unlimited).
    #[serde(default = "d_500")] pub max_deleted_pin_ids_per_push: usize,
    /// Maximum deleted drawing IDs per push delta (0 = unlimited).
    #[serde(default = "d_500")] pub max_deleted_drawing_ids_per_push: usize,
    /// Maximum chains per push delta (0 = unlimited).
    #[serde(default = "d_200")] pub max_chains_per_push: usize,
    /// Maximum deleted chain IDs per push delta (0 = unlimited).
    #[serde(default = "d_200")] pub max_deleted_chain_ids_per_push: usize,
}
fn d_pins_per_push() -> usize { 2000 }
fn d_200() -> usize { 200 }
fn d_500() -> usize { 500 }
impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            max_pins_per_community: 0, max_pins_per_push: 2000,
            max_annotations_per_push: 200, max_drawings_per_push: 200,
            max_tombstones_per_push: 200, max_deleted_pin_ids_per_push: 500,
            max_deleted_drawing_ids_per_push: 500, max_chains_per_push: 200,
            max_deleted_chain_ids_per_push: 200,
        }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct PushConfig {
    #[serde(default = "d_false")] pub enabled: bool,
    #[serde(default)]            pub vapid_private_key_pem: Option<String>,
    #[serde(default)]            pub vapid_subject: Option<String>,
    #[serde(default)]            pub vapid_public_key: Option<String>,
    #[serde(default = "d_push_interval")] pub min_interval_secs: u64,
    #[serde(default = "d_push_batch")]    pub batch_max: usize,
}
fn d_push_interval() -> u64 { 300 }
fn d_push_batch() -> usize { 50 }

impl Default for PushConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            vapid_private_key_pem: None,
            vapid_subject: None,
            vapid_public_key: None,
            min_interval_secs: 300,
            batch_max: 50,
        }
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
            #[cfg(feature = "mqtt-bridge")]
            mqtt: MqttConfig::default(),
            #[cfg(feature = "rnode-bridge")]
            rnode: RnodeConfig::default(),
            #[cfg(feature = "peer-relay")]
            peer_relays: PeerRelayConfig::default(),
            storage: StorageConfig::default(),
            push: PushConfig::default(),
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
    #[cfg(feature = "mqtt-bridge")]
    if let Ok(v) = std::env::var("MQTT_USERNAME") { cfg.mqtt.username = v; }
    #[cfg(feature = "mqtt-bridge")]
    if let Ok(v) = std::env::var("MQTT_PASSWORD") { cfg.mqtt.password = v; }
    #[cfg(feature = "mqtt-bridge")]
    if let Ok(v) = std::env::var("MQTT_BROKER") { cfg.mqtt.broker = v; }
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let cfg = Config::default();
        assert_eq!(cfg.server.port, 9000);
        assert_eq!(cfg.share.share_http_port, 9001);
        assert_eq!(cfg.rate_limit.messages_per_sec, 20);
        assert_eq!(cfg.rate_limit.connections_per_min, 30);
        assert_eq!(cfg.rooms.max_clients, 0);
        assert_eq!(cfg.rooms.max_rooms, 1000);
        assert_eq!(cfg.rooms.room_timeout_secs, 600);
        assert_eq!(cfg.security.max_room_len, 64);
        assert_eq!(cfg.security.max_message_size, 10_485_760);
        #[cfg(feature = "mqtt-bridge")]
        assert!(!cfg.mqtt.enabled);
        #[cfg(feature = "rnode-bridge")]
        assert!(!cfg.rnode.enabled);
        #[cfg(feature = "peer-relay")]
        assert!(!cfg.peer_relays.enabled);
        assert_eq!(cfg.storage.max_pins_per_community, 0);
    }

    #[test]
    fn test_default_servers() {
        assert_eq!(ServerConfig::default().port, 9000);
        assert_eq!(RoomsConfig::default().room_timeout_secs, 600);
        assert_eq!(SecurityConfig::default().max_password_len, 128);
        assert_eq!(ShareConfig::default().share_ttl_secs, 86400);
        assert_eq!(StorageConfig::default().max_pins_per_community, 0);
    }

    #[test]
    fn test_storage_config_default() {
        let s = StorageConfig::default();
        assert_eq!(s.max_pins_per_community, 0);
    }

    #[test]
    fn test_rate_limit_config_default() {
        let r = RateLimitConfig::default();
        assert_eq!(r.messages_per_sec, 20);
        assert_eq!(r.connections_per_min, 30);
        assert_eq!(r.ban_duration_secs, 3600);
    }

    #[cfg(feature = "peer-relay")]
    #[test]
    fn test_peer_relay_config_default() {
        let p = PeerRelayConfig::default();
        assert!(!p.enabled);
        assert_eq!(p.announce_interval_secs, 300);
    }

    #[test]
    fn test_push_config_defaults() {
        let p = PushConfig::default();
        assert!(!p.enabled);
        assert!(p.vapid_private_key_pem.is_none());
        assert!(p.vapid_subject.is_none());
        assert!(p.vapid_public_key.is_none());
        assert_eq!(p.min_interval_secs, 300);
        assert_eq!(p.batch_max, 50);
        let cfg = Config::default();
        assert!(!cfg.push.enabled);
    }
}
