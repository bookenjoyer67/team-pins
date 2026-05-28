mod config;
mod detect;
mod handler;
mod messages;
mod mqtt_bridge;
mod peer_relay;
mod rate;
mod reticulum_bridge;
mod rnode;
mod room;
mod share;
mod share_http;
mod state;
mod storage;
mod auth;

use std::collections::HashMap;
use std::sync::Arc;

use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, Duration};
use tracing::info;

use crate::config::load_config;
use crate::detect::handle_combined;
use crate::rate::RateLimiter;
use crate::share::ShareStore;
use crate::state::AppState;
use crate::storage::PersistentStore;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
        )
        .init();

    let config = load_config();
    print_startup_banner(&config);
    let state = Arc::new(AppState {
        rooms: RwLock::new(HashMap::new()),
        shares: Mutex::new(ShareStore::new(config.share.max_shares, config.share.share_ttl_secs)),
        rl: Mutex::new(RateLimiter::new(config.rate_limit.clone())),
        config: config.clone(),
        store: PersistentStore::new(Some(std::path::PathBuf::from("community_data.json"))),
        mesh_uplink: RwLock::new(None),
        reticulum_inject: RwLock::new(None),
        mqtt_client: RwLock::new(None),
        peer_relay_txs: RwLock::new(HashMap::new()),
        conn_semaphore: Arc::new(tokio::sync::Semaphore::new(1000)),
    });

    // Room cleanup
    {
        let s = state.clone();
        tokio::spawn(async move {
            let timeout = Duration::from_secs(s.config.rooms.room_timeout_secs);
            loop {
                sleep(Duration::from_secs(60)).await;
                let mut rooms = s.rooms.write().await;
                rooms.retain(|name, r| {
                    let keep = !r.clients.is_empty() || r.last_act.elapsed() < timeout;
                    if !keep { info!("Cleaned room {}", name); }
                    keep
                });
            }
        });
    }

    // Share cleanup
    {
        let s = state.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(300)).await;
                let mut store = s.shares.lock().await;
                store.cleanup();
            }
        });
    }

    // Rate limit cleanup
    {
        let s = state.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(300)).await;
                s.rl.lock().await.clean();
            }
        });
    }

    // TTL expiry cleanup
    {
        let s = state.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(60)).await;
                s.store.cleanup_expired_ttls().await;
            }
        });
    }

    // Token expiry cleanup
    {
        let s = state.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(300)).await;
                s.store.cleanup_expired_tokens().await;
            }
        });
    }

    // MQTT mesh bridge (only if enabled in config)
    if config.mqtt.enabled {
        let s = state.clone();
        tokio::spawn(async move {
            mqtt_bridge::start_bridge(s).await;
        });
    }

    // RNode bridge (only if enabled in config)
    if config.rnode.enabled {
        let s = state.clone();
        tokio::spawn(async move {
            rnode::start_bridge(s).await;
        });
    }

    // Reticulum transport bridge
    {
        let s = state.clone();
        tokio::spawn(async move {
            reticulum_bridge::start_bridge(s).await;
        });
    }

    // Periodic snapshot flush (5-second interval)
    let flush_state = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            flush_state.store.flush_snapshot().await;
        }
    });

    // Relay federation — peer-to-peer relay connections
    if config.peer_relays.enabled {
        let s = state.clone();
        tokio::spawn(async move {
            peer_relay::start_federation(s).await;
        });
    }

    // Main listener (port 9000) — detects WS vs HTTP share
    let addr = format!("{}:{}", config.server.bind_address, config.server.port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => { tracing::error!("Failed to bind {}: {}", addr, e); return; }
    };
    tracing::info!("piggPin relay on {} (WS + share HTTP)", addr);

    let http_addr = format!("{}:{}", config.server.bind_address, config.share.share_http_port);
    let http_listener = match TcpListener::bind(&http_addr).await {
        Ok(l) => l,
        Err(e) => { tracing::error!("Failed to bind HTTP {}: {}", http_addr, e); return; }
    };

    let main_state = state.clone();
    let http_state = state.clone();

    let main_handle = tokio::spawn(async move {
        while let Ok((stream, addr)) = listener.accept().await {
            let permit = main_state.conn_semaphore.clone().acquire_owned().await;
            let s = main_state.clone();
            tokio::spawn(async move {
                let _permit = permit;
                handle_combined(s, stream, addr).await;
            });
        }
    });

    let http_handle = tokio::spawn(async move {
        while let Ok((stream, _addr)) = http_listener.accept().await {
            let s = http_state.clone();
            tokio::spawn(async move {
                share_http::handle_http(s, stream).await;
            });
        }
    });

    tokio::select! {
        _ = main_handle => {},
        _ = http_handle => {},
    }
}

fn print_startup_banner(cfg: &config::Config) {
    let ws_addr = format!("{}:{}", cfg.server.bind_address, cfg.server.port);
    let http_addr = format!("{}:{}", cfg.server.bind_address, cfg.share.share_http_port);

    info!("══════════════════════════════════════════");
    info!("  piggPin Signal Relay");
    info!("══════════════════════════════════════════");
    info!("");
    info!("  Listeners:");
    info!("    WebSocket + Share HTTP   ws://{}", ws_addr);
    info!("    Share HTTP (direct)      http://{}", http_addr);
    info!("");
    info!("  MQTT Mesh Bridge:");
    if cfg.mqtt.enabled {
        info!("    Broker                   mqtt://{}:{}", cfg.mqtt.broker, cfg.mqtt.port);
        info!("    Bridge room              \"{}\"", cfg.mqtt.bridge_room);
        info!("    Uplink                   {}", if cfg.mqtt.uplink_enabled { "enabled" } else { "disabled" });
    } else {
        info!("    Status                   disabled");
    }
    info!("");
    info!("  RNode LoRa Bridge:");
    if cfg.rnode.enabled && !cfg.rnode.serial_port.is_empty() {
        info!("    Serial port              {}", cfg.rnode.serial_port);
        info!("    Baud rate                {}", cfg.rnode.baud_rate);
        info!("    Bridge room              \"{}\"", cfg.rnode.bridge_room);
    } else {
        info!("    Status                   disabled");
    }
    info!("");
    info!("  Rooms:");
    info!("    Max clients per room     {}", if cfg.rooms.max_clients == 0 { "unlimited".to_string() } else { cfg.rooms.max_clients.to_string() });
    info!("    Max rooms                {}", cfg.rooms.max_rooms);
    info!("    Room timeout             {}s", cfg.rooms.room_timeout_secs);
    info!("");
    info!("  Rate Limiting:");
    info!("    Messages/sec             {}", cfg.rate_limit.messages_per_sec);
    info!("    Connections/min          {}", cfg.rate_limit.connections_per_min);
    info!("    Ban duration             {}s", cfg.rate_limit.ban_duration_secs);
    info!("");
    info!("  Security:");
    info!("    Passwords required       {}", cfg.security.require_passwords);
    info!("    Max message size         {} bytes", cfg.security.max_message_size);
    info!("    Max room name length     {}", cfg.security.max_room_len);
    info!("");
    info!("  Share:");
    info!("    Max shares               {}", cfg.share.max_shares);
    info!("    Share TTL                {}s ({}h)", cfg.share.share_ttl_secs, cfg.share.share_ttl_secs / 3600);
    info!("    Max share payload        {} bytes ({} MB)", cfg.share.max_share_bytes, cfg.share.max_share_bytes / (1024 * 1024));
    info!("");
    info!("══════════════════════════════════════════");
}
