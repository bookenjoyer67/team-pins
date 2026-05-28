use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio::time::{sleep, Duration};

use crate::handler;
use crate::share_http;
use crate::state::AppState;

pub async fn handle_combined(state: Arc<AppState>, stream: TcpStream, addr: SocketAddr) {
    let mut buf = [0u8; 256];
    for _ in 0..8 {
        match stream.peek(&mut buf).await {
            Ok(n) if n >= 4 => {
                let head = String::from_utf8_lossy(&buf[..n]);
                let first = head.lines().next().unwrap_or("");
                if first.contains("/share") {
                    return share_http::handle_http(state, stream).await;
                }
                break;
            }
            Ok(_) => { sleep(Duration::from_millis(150)).await; }
            Err(_) => break,
        }
    }
    handler::handle(state, stream, addr).await;
}
