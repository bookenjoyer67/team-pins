use std::net::SocketAddr;
use std::sync::Arc;

use tokio::net::TcpStream;
use tokio::time::{sleep, timeout, Duration};

use crate::handler;
use crate::share_http;
use crate::state::AppState;

pub async fn handle_combined(state: Arc<AppState>, stream: TcpStream, addr: SocketAddr) {
    let mut buf = [0u8; 512];
    let peek_result = timeout(Duration::from_millis(500), async {
        for _ in 0..3 {
            match stream.peek(&mut buf).await {
                Ok(n) if n >= 4 => {
                    let head = String::from_utf8_lossy(&buf[..n]);
                    let first = head.lines().next().unwrap_or("");
                    if first.contains("/share") || first.contains("/health") {
                        return Ok::<_, ()>(true);
                    }
                    return Ok::<_, ()>(false);
                }
                Ok(_) => { sleep(Duration::from_millis(50)).await; }
                Err(_) => return Ok::<_, ()>(false),
            }
        }
        Ok::<_, ()>(false)
    }).await;
    match peek_result {
        Ok(Ok(true)) => { share_http::handle_http(state, stream).await; }
        _ => { handler::handle(state, stream, addr).await; }
    }
}
