use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, timeout, Duration};
use tracing::info;

use socket2::{Socket, Domain, Type, TcpKeepalive};
use std::net::SocketAddr;

use piggpin_signal::config::{load_config, Config};
use piggpin_signal::detect;
use piggpin_signal::rate::RateLimiter;
use piggpin_signal::share::ShareStore;
use piggpin_signal::state::AppState;
use piggpin_signal::storage::PersistentStore;
use piggpin_signal::mqtt_bridge;
use piggpin_signal::rnode;
use piggpin_signal::reticulum_bridge;
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

    let config = load_config();
    print_startup_banner(&config);
    let state = Arc::new(AppState {
        rooms: RwLock::new(HashMap::new()),
        shares: Mutex::new(ShareStore::new(config.share.max_shares, config.share.share_ttl_secs)),
        rl: Mutex::new(RateLimiter::new(config.rate_limit.clone())),
        config: config.clone(),
        store: PersistentStore::new(Some(std::path::PathBuf::from("community_data.json")), config.storage.max_pins_per_community),
        mesh_uplink: RwLock::new(None),
        reticulum_inject: RwLock::new(None),
        mqtt_client: RwLock::new(None),
        peer_relay_txs: RwLock::new(HashMap::new()),
        conn_semaphore: Arc::new(tokio::sync::Semaphore::new(1000)),
    });

    let shutdown = Arc::new(AtomicBool::new(false));

    spawn_background_tasks(state.clone());

    let addr: SocketAddr = format!("{}:{}", config.server.bind_address, config.server.port).parse().expect("Invalid bind address");
    let listener = match bind_with_keepalive(addr) {
        Ok(l) => { tracing::info!("piggPin relay on {} (WS + share HTTP)", addr); l }
        Err(e) => { tracing::error!("Failed to bind {}: {}", addr, e); return; }
    };

    let http_addr: SocketAddr = format!("{}:{}", config.server.bind_address, config.share.share_http_port).parse().expect("Invalid bind address");
    let http_listener = match bind_with_keepalive(http_addr) {
        Ok(l) => l,
        Err(e) => { tracing::error!("Failed to bind HTTP {}: {}", http_addr, e); return; }
    };

    run_server(state, listener, http_listener, shutdown).await;
}

pub fn spawn_background_tasks(state: Arc<AppState>) {
    let st = state.clone();
    tokio::spawn(async move {
        let timeout = Duration::from_secs(st.config.rooms.room_timeout_secs);
        loop { sleep(Duration::from_secs(60)).await; let mut rooms = st.rooms.write().await;
            rooms.retain(|name, r| { let keep = !r.clients.is_empty() || r.last_act.lock().unwrap().elapsed() < timeout; if !keep { info!("Cleaned room {}", name); } keep }); }
    });
    let st = state.clone();
    tokio::spawn(async move { loop { sleep(Duration::from_secs(300)).await; st.shares.lock().await.cleanup(); } });
    let st = state.clone();
    tokio::spawn(async move { loop { sleep(Duration::from_secs(300)).await; st.rl.lock().await.clean(); } });
    let st = state.clone();
    tokio::spawn(async move { loop { sleep(Duration::from_secs(60)).await; st.store.cleanup_expired_ttls().await; } });
    let st = state.clone();
    tokio::spawn(async move { loop { sleep(Duration::from_secs(300)).await; st.store.cleanup_expired_tokens().await; } });
    let st = state.clone();
    tokio::spawn(async move { loop { tokio::time::sleep(std::time::Duration::from_secs(5)).await; st.store.flush_if_dirty().await; } });

    let cfg = &state.config;
    if cfg.mqtt.enabled { let s = state.clone(); tokio::spawn(async move { mqtt_bridge::start_bridge(s).await; }); }
    if cfg.rnode.enabled { let s = state.clone(); tokio::spawn(async move { rnode::start_bridge(s).await; }); }
    { let s = state.clone(); tokio::spawn(async move { reticulum_bridge::start_bridge(s).await; }); }
    if cfg.peer_relays.enabled { let s = state.clone(); tokio::spawn(async move { peer_relay::start_federation(s).await; }); }
}

pub async fn run_server(
    state: Arc<AppState>,
    listener: TcpListener,
    http_listener: TcpListener,
    shutdown: Arc<AtomicBool>,
) {
    let main_l = Arc::new(tokio::sync::Mutex::new(Some(listener)));
    let http_l = Arc::new(tokio::sync::Mutex::new(Some(http_listener)));
    let main_state = state.clone();
    let http_state = state.clone();
    let main_shutdown = shutdown.clone();
    let http_shutdown = shutdown.clone();
    let main_l_clone = main_l.clone();
    let http_l_clone = http_l.clone();

    let main_handle = tokio::spawn(async move {
        loop {
            if main_shutdown.load(Ordering::Acquire) { break; }
            let result = { let guard = main_l_clone.lock().await; match guard.as_ref() { Some(l) => timeout(Duration::from_secs(1), l.accept()).await, None => break } };
            match result { Ok(Ok((stream, addr))) => {
                let permit = match tokio::time::timeout(Duration::from_secs(10), main_state.conn_semaphore.clone().acquire_owned()).await { Ok(p) => p, Err(_) => { continue; } };
                let s = main_state.clone(); tokio::spawn(async move { let _permit = permit; detect::handle_combined(s, stream, addr).await; });
            } Ok(Err(_)) => break, Err(_) => continue }
        }
    });

    let http_handle = tokio::spawn(async move {
        loop {
            if http_shutdown.load(Ordering::Acquire) { break; }
            let result = { let guard = http_l_clone.lock().await; match guard.as_ref() { Some(l) => timeout(Duration::from_secs(1), l.accept()).await, None => break } };
            match result { Ok(Ok((stream, _addr))) => { let s = http_state.clone(); tokio::spawn(async move { share_http::handle_http(s, stream).await; }); } Ok(Err(_)) => break, Err(_) => continue }
        }
    });

    tokio::select! {
        _ = main_handle => {},
        _ = http_handle => {},
        _ = tokio::signal::ctrl_c() => { shutdown.store(true, Ordering::Release); main_l.lock().await.take(); http_l.lock().await.take();
            sleep(Duration::from_secs(2)).await; let _ = tokio::time::timeout(Duration::from_secs(5), state.store.save_snapshot()).await; info!("Shutdown complete"); },
    }
}

fn print_startup_banner(cfg: &Config) {
    let ws_addr = format!("{}:{}", cfg.server.bind_address, cfg.server.port);
    info!("piggPin relay on {} (WS + share HTTP)", ws_addr);
    info!("  Rooms: max_clients={} timeout={}s", cfg.rooms.max_clients, cfg.rooms.room_timeout_secs);
    info!("  Rate: {} msg/s {} conn/min", cfg.rate_limit.messages_per_sec, cfg.rate_limit.connections_per_min);
    info!("  Share: port={} max={} ttl={}s", cfg.share.share_http_port, cfg.share.max_shares, cfg.share.share_ttl_secs);
}
