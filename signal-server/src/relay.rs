//! Relay server — spawnable from any binary (sweeet or standalone).
//! Starts the WebSocket relay and HTTP share server as a background task.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

use dashmap::DashMap;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, timeout, Duration};
use tracing::{error, info, warn};

use socket2::{Socket, Domain, Type, TcpKeepalive};
use std::net::SocketAddr;

use crate::config::Config;
use crate::detect;
use crate::manager::ServiceManager;
use crate::rate::RateLimiter;
use crate::share::ShareStore;
use crate::state::AppState;
use crate::storage::PersistentStore;
use crate::share_http;

#[cfg(feature = "mqtt-bridge")]
use crate::mqtt_bridge;
#[cfg(feature = "rnode-bridge")]
use crate::rnode;
#[cfg(feature = "reticulum-bridge")]
use crate::reticulum_bridge;
#[cfg(feature = "peer-relay")]
use crate::peer_relay;

fn bind_with_keepalive(addr: SocketAddr) -> std::io::Result<TcpListener> {
    let socket = Socket::new(Domain::for_address(addr), Type::STREAM, None)?;
    socket.set_reuse_address(true)?;
    let ka = TcpKeepalive::new()
        .with_time(Duration::from_secs(60))
        .with_interval(Duration::from_secs(10));
    socket.set_tcp_keepalive(&ka).ok();
    socket.bind(&addr.into())?;
    socket.listen(1024)?;
    socket.set_nonblocking(true)?;
    let std_listener: std::net::TcpListener = socket.into();
    TcpListener::from_std(std_listener)
}

pub fn print_startup_banner(cfg: &Config) {
    info!("piggPin relay on {}:{} (WS) + {}:{} (HTTP)",
        cfg.server.bind_address, cfg.server.port,
        cfg.server.bind_address, cfg.share.share_http_port);
    info!("  Rooms: max_clients={} timeout={}s", cfg.rooms.max_clients, cfg.rooms.room_timeout_secs);
    info!("  Rate: {} msg/s {} conn/min", cfg.rate_limit.messages_per_sec, cfg.rate_limit.connections_per_min);
    if cfg.server.tls_cert.is_some() && cfg.server.tls_key.is_some() {
        info!("  TLS: enabled");
    }
}

async fn spawn_background_tasks(state: Arc<AppState>, manager: &ServiceManager) {
    // Room cleanup
    let st = state.clone();
    manager.spawn_restartable("room_cleanup", move |mut rx| {
        let s = st.clone();
        let timeout = Duration::from_secs(s.config.rooms.room_timeout_secs);
        async move {
            loop {
                tokio::select! {
                    _ = rx.recv() => break,
                    _ = sleep(Duration::from_secs(60)) => {
                        for entry in s.rooms.iter() {
                            let drops = entry.value().dropped_messages.swap(0, Ordering::Relaxed);
                            if drops > 0 {
                                warn!("[relay] room {} had {} dropped messages in last 60s ({} clients)",
                                    entry.key(), drops, entry.value().client_count());
                            }
                        }
                        s.rooms.retain(|name, r| {
                            let keep = !r.clients.is_empty() || r.elapsed_ms() < timeout.as_millis() as u64;
                            if !keep { info!("Cleaned room {}", name); }
                            keep
                        });
                    }
                }
            }
        }
    }).await;

    // Share cleanup
    let st = state.clone();
    manager.spawn_restartable("share_cleanup", move |mut rx| {
        let s = st.clone();
        async move {
            loop { tokio::select! { _ = rx.recv() => break, _ = sleep(Duration::from_secs(300)) => { s.shares.lock().await.cleanup(); } } }
        }
    }).await;

    // Rate limiter cleanup
    let st = state.clone();
    manager.spawn_restartable("rate_cleanup", move |mut rx| {
        let s = st.clone();
        async move {
            loop { tokio::select! { _ = rx.recv() => break, _ = sleep(Duration::from_secs(300)) => { s.rl.lock().await.clean(); } } }
        }
    }).await;

    // TTL cleanup
    let st = state.clone();
    manager.spawn_restartable("ttl_cleanup", move |mut rx| {
        let s = st.clone();
        async move {
            loop { tokio::select! { _ = rx.recv() => break, _ = sleep(Duration::from_secs(60)) => { s.store.cleanup_expired_ttls().await; } } }
        }
    }).await;

    // Token cleanup
    let st = state.clone();
    manager.spawn_restartable("token_cleanup", move |mut rx| {
        let s = st.clone();
        async move {
            loop { tokio::select! { _ = rx.recv() => break, _ = sleep(Duration::from_secs(300)) => { s.store.cleanup_expired_tokens().await; } } }
        }
    }).await;

    // Flush dirty
    let st = state.clone();
    manager.spawn_restartable("flush_dirty", move |mut rx| {
        let s = st.clone();
        async move {
            loop { tokio::select! { _ = rx.recv() => break, _ = sleep(Duration::from_secs(5)) => { s.store.flush_if_dirty().await; } } }
        }
    }).await;

    // Bridge tasks
    #[cfg(feature = "mqtt-bridge")]
    if state.config.mqtt.enabled {
        let s = state.clone();
        manager.spawn_one("mqtt_bridge", async move { mqtt_bridge::start_bridge(s).await; }).await;
    }
    #[cfg(feature = "rnode-bridge")]
    if state.config.rnode.enabled {
        let s = state.clone();
        manager.spawn_one("rnode_bridge", async move { rnode::start_bridge(s).await; }).await;
    }
    #[cfg(feature = "reticulum-bridge")]
    {
        let s = state.clone();
        manager.spawn_one("reticulum_bridge", async move { reticulum_bridge::start_bridge(s).await; }).await;
    }
    #[cfg(feature = "peer-relay")]
    if state.config.peer_relays.enabled {
        let s = state.clone();
        manager.spawn_one("peer_relay", async move { peer_relay::start_federation(s).await; }).await;
    }
}

async fn run_server(
    state: Arc<AppState>,
    listener: TcpListener,
    http_listener: TcpListener,
    shutdown: Arc<AtomicBool>,
    active_connections: Arc<std::sync::atomic::AtomicUsize>,
) {
    let main_l = Arc::new(tokio::sync::Mutex::new(Some(listener)));
    let http_l = Arc::new(tokio::sync::Mutex::new(Some(http_listener)));
    let main_state = state.clone();
    let http_state = state.clone();
    let main_shutdown = shutdown.clone();
    let http_shutdown = shutdown.clone();
    let main_l_clone = main_l.clone();
    let http_l_clone = http_l.clone();
    let main_conns = active_connections.clone();

    let main_handle = tokio::spawn(async move {
        loop {
            if main_shutdown.load(Ordering::Acquire) { break; }
            let result = { let guard = main_l_clone.lock().await; match guard.as_ref() { Some(l) => timeout(Duration::from_secs(1), l.accept()).await, None => break } };
            match result { Ok(Ok((stream, addr))) => {
                let _permit = match tokio::time::timeout(
                    Duration::from_secs(main_state.config.server.connection_wait_secs),
                    main_state.conn_semaphore.clone().acquire_owned()
                ).await { Ok(p) => p, Err(_) => { main_state.connections_rejected.fetch_add(1, Ordering::Relaxed); continue; } };
                main_state.connections_accepted.fetch_add(1, Ordering::Relaxed);
                main_conns.fetch_add(1, Ordering::Relaxed);
                let s = main_state.clone(); let ac = main_conns.clone();
                tokio::spawn(async move { detect::handle_combined(s, stream, addr).await; ac.fetch_sub(1, Ordering::Relaxed); });
            } Ok(Err(_)) => break, Err(_) => continue }
        }
    });

    let http_handle = tokio::spawn(async move {
        loop {
            if http_shutdown.load(Ordering::Acquire) { break; }
            let result = { let guard = http_l_clone.lock().await; match guard.as_ref() { Some(l) => timeout(Duration::from_secs(1), l.accept()).await, None => break } };
            match result { Ok(Ok((stream, _addr))) => {
                let _permit = match tokio::time::timeout(
                    Duration::from_secs(http_state.config.server.connection_wait_secs),
                    http_state.conn_semaphore.clone().acquire_owned()
                ).await { Ok(p) => p, Err(_) => { http_state.connections_rejected.fetch_add(1, Ordering::Relaxed); continue; } };
                http_state.connections_accepted.fetch_add(1, Ordering::Relaxed);
                let s = http_state.clone();
                tokio::spawn(async move { share_http::handle_http(s, stream).await; });
            } Ok(Err(_)) => break, Err(_) => continue }
        }
    });

    tokio::select! {
        _ = main_handle => {},
        _ = http_handle => {},
        _ = tokio::signal::ctrl_c() => {
            info!("Shutting down gracefully...");
            shutdown.store(true, Ordering::Release);
            main_l.lock().await.take();
            http_l.lock().await.take();
            info!("[drain] waiting for active connections to complete ({} remaining)...", active_connections.load(Ordering::Relaxed));
            let drain_deadline = tokio::time::Instant::now() + Duration::from_secs(10);
            loop {
                if tokio::time::Instant::now() >= drain_deadline { break; }
                let remaining = active_connections.load(Ordering::Relaxed);
                if remaining == 0 { break; }
                sleep(Duration::from_millis(250)).await;
            }
            sleep(Duration::from_millis(500)).await;
            let _ = tokio::time::timeout(Duration::from_secs(5), state.store.save_snapshot()).await;
            let now = crate::messages::unix_millis();
            *state.last_snapshot_time.write().unwrap() = Some(now);
            info!("Shutdown complete");
        },
    }
}

/// Start the piggPin relay. Returns immediately — spawns listeners in background.
pub async fn start(config: Config) -> anyhow::Result<()> {
    print_startup_banner(&config);

    if let Err(e) = crate::push::ensure_vapid_keys(&mut config.push.clone()).await {
        warn!("Push: {}", e);
    }

    let state = Arc::new(AppState {
        rooms: DashMap::new(),
        shares: Mutex::new(ShareStore::new(config.share.max_shares, config.share.share_ttl_secs)),
        rl: Mutex::new(RateLimiter::new(config.rate_limit.clone())),
        config: config.clone(),
        store: PersistentStore::new(Some(std::path::PathBuf::from("community_data.json")), config.storage.max_pins_per_community),
        conn_semaphore: Arc::new(tokio::sync::Semaphore::new(config.server.max_connections.max(1))),
        start_time: Instant::now(),
        connections_accepted: AtomicU64::new(0),
        connections_rejected: AtomicU64::new(0),
        last_snapshot_time: std::sync::RwLock::new(None),
    });

    let shutdown = Arc::new(AtomicBool::new(false));
    let manager = ServiceManager::new();

    spawn_background_tasks(state.clone(), &manager).await;

    let ws_addr: SocketAddr = format!("{}:{}", config.server.bind_address, config.server.port).parse()?;
    let http_addr: SocketAddr = format!("{}:{}", config.server.bind_address, config.share.share_http_port).parse()?;

    let ws_listener = bind_with_keepalive(ws_addr)
        .map_err(|e| anyhow::anyhow!("Failed to bind {}: {}", ws_addr, e))?;
    let http_listener = bind_with_keepalive(http_addr)
        .map_err(|e| anyhow::anyhow!("Failed to bind {}: {}", http_addr, e))?;

    let active_connections = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    tokio::spawn(async move {
        run_server(state, ws_listener, http_listener, shutdown, active_connections).await;
        manager.shutdown(Duration::from_secs(30)).await;
    });

    Ok(())
}
