// E2E test helpers for the piggPin signal server.
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, timeout, Duration};

use piggpin_signal::config::Config;
use piggpin_signal::detect;
use piggpin_signal::manager::ServiceManager;
use piggpin_signal::rate::RateLimiter;
use piggpin_signal::share_http;
use piggpin_signal::state::AppState;
use piggpin_signal::storage::PersistentStore;

/// A connected WebSocket test client.
pub struct TestClient {
    pub ws: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
}

impl TestClient {
    /// Send a JSON value as text.
    pub async fn send(&mut self, msg: &serde_json::Value) {
        self.ws
            .send(tokio_tungstenite::tungstenite::Message::Text(msg.to_string()))
            .await
            .unwrap();
    }

    /// Receive the next text message and parse as JSON.
    pub async fn recv(&mut self) -> serde_json::Value {
        loop {
            let msg = self.ws.next().await.unwrap().unwrap();
            if let tokio_tungstenite::tungstenite::Message::Text(t) = msg {
                return serde_json::from_str(&t).unwrap();
            }
        }
    }

    /// Receive with a timeout. Returns None if no message arrives in time.
    pub async fn recv_timeout(&mut self, dur: Duration) -> Option<serde_json::Value> {
        tokio::time::timeout(dur, self.recv()).await.ok()
    }

    /// Skip any pending messages (use after joining to clear peer_joined broadcasts).
    #[allow(dead_code)]
    pub async fn drain(&mut self) {
        while self.recv_timeout(Duration::from_millis(200)).await.is_some() {}
    }
}

/// Start a signal server on random ports with in-memory storage.
/// Spawns background tasks and accept loops. Returns the WS address.
pub async fn start_server() -> SocketAddr {
    start_server_with_config(Config::default()).await
}

/// Start a server with a specific connection limit.
pub async fn start_server_with_max_conn(max_conn: usize) -> SocketAddr {
    let mut config = Config::default();
    config.server.max_connections = max_conn;
    start_server_with_config(config).await
}

/// Start a server with a custom Config.
pub async fn start_server_with_config(config: Config) -> SocketAddr {
    let _ = tracing_subscriber::fmt().try_init();

    let max_conn = config.server.max_connections.max(1);
    let _ = piggpin_signal::push::init(&config.push);

    let state = Arc::new(AppState {
        rooms: DashMap::new(),
        shares: Mutex::new(piggpin_signal::share::ShareStore::new(
            config.share.max_shares,
            config.share.share_ttl_secs,
        )),
        rl: Mutex::new(RateLimiter::new(config.rate_limit.clone())),
        config: config.clone(),
        store: PersistentStore::new(None, config.storage.max_pins_per_community),
        #[cfg(feature = "mqtt-bridge")]
        mesh_uplink: RwLock::new(None),
        #[cfg(feature = "reticulum-bridge")]
        reticulum_inject: RwLock::new(None),
        #[cfg(feature = "mqtt-bridge")]
        mqtt_client: RwLock::new(None),
        #[cfg(feature = "peer-relay")]
        peer_relay_txs: RwLock::new(HashMap::new()),
        conn_semaphore: Arc::new(tokio::sync::Semaphore::new(max_conn.max(1))),
        start_time: Instant::now(),
        connections_accepted: AtomicU64::new(0),
        connections_rejected: AtomicU64::new(0),
        last_snapshot_time: std::sync::RwLock::new(None),
    });

    let shutdown = Arc::new(AtomicBool::new(false));
    let manager = ServiceManager::new();
    spawn_background_tasks(state.clone(), &manager).await;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let http_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();

    let s = state.clone();
    let sd = shutdown.clone();
    tokio::spawn(async move { run_accept_loop(s, listener, http_listener, sd).await });

    // Give the server a moment to start
    sleep(Duration::from_millis(50)).await;
    addr
}

/// Connect a WebSocket client to the server in a specific room.
pub async fn connect_to(addr: SocketAddr, room: &str) -> TestClient {
    let url = format!("ws://{}/?room={}", addr, room);
    let (ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();
    TestClient { ws }
}

/// Connect and complete the join handshake.
/// The protocol is: connect → receive "hello" → send "join" → receive "welcome"
pub async fn join_room(addr: SocketAddr, room: &str) -> (TestClient, serde_json::Value) {
    let mut client = connect_to(addr, room).await;

    // Server sends "hello" first
    let hello = client.recv().await;
    assert_eq!(hello["type"], "hello", "expected hello, got: {}", hello);

    // Send join request
    client.send(&serde_json::json!({"type":"join","room":room})).await;

    // Receive welcome
    let welcome = client.recv().await;
    assert_eq!(welcome["type"], "welcome", "expected welcome, got: {}", welcome);
    (client, welcome)
}

// ---- Internal server helpers (duplicated from main.rs for test access) ----

async fn spawn_background_tasks(state: Arc<AppState>, manager: &ServiceManager) {
    let st = state.clone();
    manager.spawn_restartable("room_cleanup", move |mut rx| {
        let s = st.clone();
        let timeout = Duration::from_secs(s.config.rooms.room_timeout_secs);
        async move {
            loop {
                tokio::select! {
                    _ = rx.recv() => break,
                    _ = sleep(Duration::from_secs(60)) => {
                        s.rooms.retain(|name, r| {
                            let keep = !r.clients.is_empty()
                                || r.elapsed_ms() < timeout.as_millis() as u64;
                            if !keep { tracing::info!("Cleaned room {}", name); }
                            keep
                        });
                    }
                }
            }
        }
    }).await;

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
}

async fn run_accept_loop(
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

    let main_handle = tokio::spawn(async move {
        loop {
            if main_shutdown.load(Ordering::Acquire) { break; }
            let result = {
                let guard = main_l.lock().await;
                match guard.as_ref() {
                    Some(l) => timeout(Duration::from_secs(1), l.accept()).await,
                    None => break,
                }
            };
            match result {
                Ok(Ok((stream, addr))) => {
                    let permit = match tokio::time::timeout(Duration::from_secs(10), main_state.conn_semaphore.clone().acquire_owned()).await {
                        Ok(p) => p,
                        Err(_) => continue,
                    };
                    let s = main_state.clone();
                    tokio::spawn(async move {
                        let _permit = permit;
                        detect::handle_combined(s, stream, addr).await;
                    });
                }
                Ok(Err(_)) => break,
                Err(_) => continue,
            }
        }
    });

    let http_handle = tokio::spawn(async move {
        loop {
            if http_shutdown.load(Ordering::Acquire) { break; }
            let result = {
                let guard = http_l.lock().await;
                match guard.as_ref() {
                    Some(l) => timeout(Duration::from_secs(1), l.accept()).await,
                    None => break,
                }
            };
            match result {
                Ok(Ok((stream, _addr))) => {
                    let s = http_state.clone();
                    tokio::spawn(async move { share_http::handle_http(s, stream).await; });
                }
                Ok(Err(_)) => break,
                Err(_) => continue,
            }
        }
    });

    let _ = tokio::join!(main_handle, http_handle);
}

// ── Mock push server for testing push notification dispatch ──

use std::sync::atomic::{AtomicU16, Ordering as AtomicOrdering};

pub struct CapturedPush {
    pub path: String,
    pub body: Vec<u8>,
}

pub struct MockPushServer {
    pub addr: std::net::SocketAddr,
    pub captured: Arc<Mutex<Vec<CapturedPush>>>,
    pub status: Arc<AtomicU16>,
    handle: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for MockPushServer {
    fn drop(&mut self) {
        if let Some(h) = self.handle.take() {
            h.abort();
        }
    }
}

pub async fn start_mock_push(status: u16) -> MockPushServer {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let captured: Arc<Mutex<Vec<CapturedPush>>> = Arc::new(Mutex::new(Vec::new()));
    let status = Arc::new(AtomicU16::new(status));
    let cap = captured.clone();
    let st = status.clone();

    let handle = tokio::spawn(async move {
        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(c) => c,
                Err(_) => break,
            };
            let cap = cap.clone();
            let st = st.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 16384];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };
                let raw = String::from_utf8_lossy(&buf[..n]);
                let body_start = raw.find("\r\n\r\n").map(|i| i + 4).unwrap_or(raw.len());
                let body = buf[body_start..n].to_vec();

                // Extract path from first line
                let first_line = raw.lines().next().unwrap_or("");
                let path = first_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string();

                cap.lock().await.push(CapturedPush { path, body });

                let code = st.load(AtomicOrdering::Relaxed);
                let resp = format!("HTTP/1.1 {} OK\r\nContent-Length: 0\r\n\r\n", code);
                socket.write_all(resp.as_bytes()).await.ok();
            });
        }
    });

    MockPushServer {
        addr,
        captured,
        status,
        handle: Some(handle),
    }
}
