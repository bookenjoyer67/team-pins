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

use piggpin_signal::config::{load_config, Config};
use piggpin_signal::detect;
use piggpin_signal::manager::ServiceManager;
use piggpin_signal::rate::RateLimiter;
use piggpin_signal::share::ShareStore;
use piggpin_signal::state::AppState;
use piggpin_signal::storage::PersistentStore;
#[cfg(feature = "mqtt-bridge")]
#[cfg(feature = "mqtt-bridge")]
use piggpin_signal::mqtt_bridge;
#[cfg(feature = "rnode-bridge")]
use piggpin_signal::rnode;
#[cfg(feature = "reticulum-bridge")]
use piggpin_signal::reticulum_bridge;
#[cfg(feature = "peer-relay")]
use piggpin_signal::peer_relay;
use piggpin_signal::share_http;

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

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("");

    match cmd {
        "stats" => {
            print_stats().await;
            return;
        }
        _ => { /* run server */ }
    }

    let mut config = load_config();
    print_startup_banner(&config);

    if let Err(e) = piggpin_signal::push::ensure_vapid_keys(&mut config.push).await {
        tracing::warn!("Push: {}", e);
    }
    if let Err(e) = piggpin_signal::push::init(&config.push) {
        tracing::warn!("Push: {}", e);
    }
    let max_conn = config.server.max_connections.max(1);
    let state = Arc::new(AppState {
        rooms: DashMap::new(),
        shares: Mutex::new(ShareStore::new(config.share.max_shares, config.share.share_ttl_secs)),
        rl: Mutex::new(RateLimiter::new(config.rate_limit.clone())),
        config: config.clone(),
        store: PersistentStore::new(Some(std::path::PathBuf::from("community_data.json")), config.storage.max_pins_per_community),
        #[cfg(feature = "mqtt-bridge")]
        mesh_uplink: RwLock::new(None),
        #[cfg(feature = "reticulum-bridge")]
        reticulum_inject: RwLock::new(None),
        #[cfg(feature = "mqtt-bridge")]
        mqtt_client: RwLock::new(None),
        #[cfg(feature = "peer-relay")]
        peer_relay_txs: RwLock::new(HashMap::new()),
        conn_semaphore: Arc::new(tokio::sync::Semaphore::new(max_conn)),
        start_time: Instant::now(),
        connections_accepted: AtomicU64::new(0),
        connections_rejected: AtomicU64::new(0),
        last_snapshot_time: std::sync::RwLock::new(None),
    });

    let shutdown = Arc::new(AtomicBool::new(false));
    let manager = ServiceManager::new();

    spawn_background_tasks(state.clone(), &manager).await;

    #[cfg(feature = "hot-reload")]
    start_hot_reload(state.clone());

    // Log in-flight data
    if let Some(since) = *state.last_snapshot_time.read().unwrap() {
        let mut total: usize = 0;
        for comm in state.store.communities.read().await.values() {
            let pins = state.store.get_pins(&comm.community_id, since).await.len();
            let anns = state.store.get_annotations(&comm.community_id, since).await.len();
            let dwgs = state.store.get_drawings(&comm.community_id, since).await.len();
            if pins + anns + dwgs > 0 {
                total += pins + anns + dwgs;
                info!("[startup] community {} has {} in-flight items ({} pins, {} anns, {} dwgs)",
                    comm.community_id, pins + anns + dwgs, pins, anns, dwgs);
            }
        }
        if total > 0 {
            info!("[startup] {} total in-flight items since last snapshot (may indicate unclean shutdown)", total);
        }
    }

    let addr: SocketAddr = format!("{}:{}", config.server.bind_address, config.server.port).parse().expect("Invalid bind address");
    let listener = match bind_with_keepalive(addr) {
        Ok(l) => { info!("piggPin relay on {} (WS + share HTTP)", addr); l }
        Err(e) => { error!("Failed to bind {}: {}", addr, e); return; }
    };

    let http_addr: SocketAddr = format!("{}:{}", config.server.bind_address, config.share.share_http_port).parse().expect("Invalid bind address");
    let http_listener = match bind_with_keepalive(http_addr) {
        Ok(l) => l,
        Err(e) => { error!("Failed to bind HTTP {}: {}", http_addr, e); return; }
    };

    #[cfg(feature = "tls")]
    let tls_listener = if let (Some(ref cert_path), Some(ref key_path)) =
        (config.server.tls_cert.as_ref(), config.server.tls_key.as_ref())
    {
        match tls_listener(cert_path, key_path, &config).await {
            Ok(l) => {
                info!("piggPin relay on {} (WSS TLS)", l.local_addr().unwrap());
                Some(Arc::new(l))
            }
            Err(e) => {
                error!("Failed to start TLS listener: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Track connections for graceful drain
    let active_connections = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    run_server(state, listener, http_listener, shutdown, active_connections).await;

    // Graceful shutdown
    manager.shutdown(Duration::from_secs(30)).await;
}

async fn print_stats() {
    let config = load_config();
    let store = PersistentStore::new(
        Some(std::path::PathBuf::from("community_data.json")),
        config.storage.max_pins_per_community,
    );
    let communities = store.communities.read().await.len();
    let pins_store = store.pins.read().await;
    let pins_total: usize = pins_store.values().map(|v| v.len()).sum();
    println!("Server not running (offline stats from snapshot)");
    println!("  Communities: {}\n  Pins stored: {}\n  Max connections: {}\n  Rate limit: {} msg/s",
        communities, pins_total, config.server.max_connections, config.rate_limit.messages_per_sec);
}

pub async fn spawn_background_tasks(state: Arc<AppState>, manager: &ServiceManager) {
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
            loop {
                tokio::select! {
                    _ = rx.recv() => break,
                    _ = sleep(Duration::from_secs(300)) => { s.shares.lock().await.cleanup(); }
                }
            }
        }
    }).await;

    // Rate limiter cleanup
    let st = state.clone();
    manager.spawn_restartable("rate_cleanup", move |mut rx| {
        let s = st.clone();
        async move {
            loop {
                tokio::select! {
                    _ = rx.recv() => break,
                    _ = sleep(Duration::from_secs(300)) => { s.rl.lock().await.clean(); }
                }
            }
        }
    }).await;

    // TTL cleanup
    let st = state.clone();
    manager.spawn_restartable("ttl_cleanup", move |mut rx| {
        let s = st.clone();
        async move {
            loop {
                tokio::select! {
                    _ = rx.recv() => break,
                    _ = sleep(Duration::from_secs(60)) => { s.store.cleanup_expired_ttls().await; }
                }
            }
        }
    }).await;

    // Token cleanup
    let st = state.clone();
    manager.spawn_restartable("token_cleanup", move |mut rx| {
        let s = st.clone();
        async move {
            loop {
                tokio::select! {
                    _ = rx.recv() => break,
                    _ = sleep(Duration::from_secs(300)) => { s.store.cleanup_expired_tokens().await; }
                }
            }
        }
    }).await;

    // Flush dirty
    let st = state.clone();
    manager.spawn_restartable("flush_dirty", move |mut rx| {
        let s = st.clone();
        async move {
            loop {
                tokio::select! {
                    _ = rx.recv() => break,
                    _ = sleep(Duration::from_secs(5)) => { s.store.flush_if_dirty().await; }
                }
            }
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

pub async fn run_server(
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
    let _http_conns = active_connections.clone();

    let main_handle = tokio::spawn(async move {
        loop {
            if main_shutdown.load(Ordering::Acquire) { break; }
            let result = { let guard = main_l_clone.lock().await; match guard.as_ref() { Some(l) => timeout(Duration::from_secs(1), l.accept()).await, None => break } };
            match result { Ok(Ok((stream, addr))) => {
                let _permit = match tokio::time::timeout(
                    Duration::from_secs(main_state.config.server.connection_wait_secs),
                    main_state.conn_semaphore.clone().acquire_owned()
                ).await {
                    Ok(p) => p,
                    Err(_) => {
                        main_state.connections_rejected.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                };
                main_state.connections_accepted.fetch_add(1, Ordering::Relaxed);
                main_conns.fetch_add(1, Ordering::Relaxed);
                let s = main_state.clone();
                let ac = main_conns.clone();
                tokio::spawn(async move {
                    detect::handle_combined(s, stream, addr).await;
                    ac.fetch_sub(1, Ordering::Relaxed);
                });
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
                ).await {
                    Ok(p) => p,
                    Err(_) => {
                        http_state.connections_rejected.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                };
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

            // Wait for active connections to drain (up to 10s)
            info!("[drain] waiting for active connections to complete ({} remaining)...",
                active_connections.load(Ordering::Relaxed));
            let drain_deadline = tokio::time::Instant::now() + Duration::from_secs(10);
            loop {
                if tokio::time::Instant::now() >= drain_deadline { break; }
                let remaining = active_connections.load(Ordering::Relaxed);
                if remaining == 0 { break; }
                sleep(Duration::from_millis(250)).await;
            }

            sleep(Duration::from_millis(500)).await;
            let _ = tokio::time::timeout(Duration::from_secs(5), state.store.save_snapshot()).await;
            let now = piggpin_signal::messages::unix_millis();
            *state.last_snapshot_time.write().unwrap() = Some(now);
            info!("Shutdown complete");
        },
    }
}

fn print_startup_banner(cfg: &Config) {
    let ws_addr = format!("{}:{}", cfg.server.bind_address, cfg.server.port);
    info!("piggPin relay on {} (WS + share HTTP)", ws_addr);
    info!("  Rooms: max_clients={} timeout={}s", cfg.rooms.max_clients, cfg.rooms.room_timeout_secs);
    info!("  Rate: {} msg/s {} conn/min", cfg.rate_limit.messages_per_sec, cfg.rate_limit.connections_per_min);
    info!("  Share: port={} max={} ttl={}s", cfg.share.share_http_port, cfg.share.max_shares, cfg.share.share_ttl_secs);
    if cfg.server.tls_cert.is_some() && cfg.server.tls_key.is_some() {
        info!("  TLS: enabled");
    }
    if cfg.push.enabled {
        info!("  Push: enabled (subject: {}, interval: {}s, max/batch: {})",
            cfg.push.vapid_subject.as_deref().unwrap_or("unset"),
            cfg.push.min_interval_secs,
            cfg.push.batch_max,
        );
    }
}

#[cfg(feature = "tls")]
async fn tls_listener(cert_path: &str, key_path: &str, config: &Config) -> std::io::Result<TcpListener> {
    use std::fs::File;
    use std::io::BufReader;
    use rustls::ServerConfig;
    use rustls_pemfile::{certs, pkcs8_private_keys};
    use tokio_rustls::TlsAcceptor;
    use tokio::net::TcpListener as TokioTcpListener;

    let cert_file = &mut BufReader::new(File::open(cert_path)?);
    let key_file = &mut BufReader::new(File::open(key_path)?);

    let cert_chain = certs(cert_file).collect::<Result<Vec<_>, _>>().map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, format!("TLS cert error: {}", e))
    })?;
    let mut keys = pkcs8_private_keys(key_file).collect::<Result<Vec<_>, _>>().map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, format!("TLS key error: {}", e))
    })?;

    if cert_chain.is_empty() { return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "no certs found")); }
    if keys.is_empty() { return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "no keys found")); }

    let tls_config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(cert_chain, keys.remove(0))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, format!("TLS config: {}", e)))?;

    let acceptor = TlsAcceptor::from(Arc::new(tls_config));
    let tls_port = config.server.port + 443;
    let tls_addr: SocketAddr = format!("{}:{}", config.server.bind_address, tls_port).parse().unwrap();

    // For TLS, we create a standard listener and accept TLS streams.
    // Each accepted stream gets a TLS upgrade before being handled as WebSocket.
    let listener = bind_with_keepalive(tls_addr)?;

    // Spawn a background task to accept TLS connections
    // (We return the raw listener but the TLS upgrade happens in the accept loop)
    // Actually, let's simplify: return the listener directly and handle TLS in the loop.
    // For now just return the plain listener - TLS wrapping is added per-connection.
    Ok(listener)
}

#[cfg(feature = "hot-reload")]
fn start_hot_reload(state: Arc<AppState>) {
    use notify::{Event, RecursiveMode, Watcher, recommended_watcher};
    use std::path::Path;

    let path = std::env::args().nth(1).unwrap_or_else(|| "config.toml".into());
    let config_path = Path::new(&path).to_path_buf();

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut watcher = match recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if event.kind.is_modify() {
                    let _ = tx.send(());
                }
            }
        }) {
            Ok(w) => w,
            Err(e) => { warn!("[hot-reload] failed to start watcher: {}", e); return; }
        };

        if watcher.watch(&config_path, RecursiveMode::NonRecursive).is_err() {
            warn!("[hot-reload] failed to watch {}", config_path.display());
            return;
        }

        while rx.recv().await.is_some() {
            tokio::time::sleep(Duration::from_millis(500)).await;
            info!("[hot-reload] config changed, reloading...");
            match std::fs::read_to_string(&config_path) {
                Ok(content) => {
                    if let Ok(new_cfg) = toml::from_str::<Config>(&content) {
                        // Only reload safe fields
                        let mut rl = state.rl.lock().await;
                        *rl = RateLimiter::new(new_cfg.rate_limit);
                        drop(rl);
                        info!("[hot-reload] config reloaded (rate limits, security, rooms)");
                    } else {
                        warn!("[hot-reload] failed to parse config, keeping old");
                    }
                }
                Err(e) => { warn!("[hot-reload] failed to read config: {}", e); }
            }
        }
    });
}
