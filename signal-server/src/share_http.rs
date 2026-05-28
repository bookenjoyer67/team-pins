use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::info;

use crate::state::AppState;

fn parse_query(path: &str) -> (&str, HashMap<String, String>) {
    let (base, qs) = match path.split_once('?') {
        Some((b, q)) => (b, q),
        None => (path, ""),
    };
    let params: HashMap<String, String> = qs.split('&')
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    (base, params)
}

fn parse_request_line(line: &str) -> Option<(&str, &str)> {
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;
    Some((method, path))
}

async fn read_headers(stream: &mut TcpStream, buf: &mut Vec<u8>) -> Result<usize, &'static str> {
    loop {
        if buf.len() > 8192 { return Err("headers too large"); }
        let mut b = [0u8; 1];
        match stream.read(&mut b).await {
            Ok(0) => return Err("connection closed"),
            Ok(_) => {
                buf.push(b[0]);
                let len = buf.len();
                if len >= 4 && &buf[len - 4..] == b"\r\n\r\n" {
                    let headers = String::from_utf8_lossy(&buf[..len - 4]);
                    let content_length = headers.lines()
                        .find_map(|l| {
                            let l = l.to_lowercase();
                            if l.starts_with("content-length:") {
                                l.split(':').nth(1)?.trim().parse::<usize>().ok()
                            } else { None }
                        })
                        .unwrap_or(0);
                    return Ok(content_length);
                }
            }
            Err(_) => return Err("read error"),
        }
    }
}

fn http_response(status: &str, content_type: &str, body: &[u8], allowed_origin: &str) -> Vec<u8> {
    let mut resp = format!("HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: {}\r\nVary: Origin\r\nConnection: close\r\n\r\n",
        status, content_type, body.len(), allowed_origin).into_bytes();
    resp.extend_from_slice(body);
    resp
}

pub async fn handle_http(state: Arc<AppState>, mut stream: TcpStream) {
    let peer = stream.peer_addr().map(|a| a.to_string()).unwrap_or_default();
    let mut header_buf = Vec::new();
    let content_length = match read_headers(&mut stream, &mut header_buf).await {
        Ok(cl) => cl,
        Err(e) => { info!("{} share HTTP bad headers: {}", peer, e); return; }
    };

    let header_str = String::from_utf8_lossy(&header_buf);
    let first_line = header_str.lines().next().unwrap_or("");
    let (method, raw_path) = match parse_request_line(first_line) {
        Some(mp) => mp,
        None => { info!("{} share HTTP bad request line", peer); return; }
    };

    let path = raw_path.trim_start_matches('/');
    let (clean_path, query) = parse_query(path);

    let allowed_origin = &state.config.share.allowed_origin;

    if method == "OPTIONS" {
        let resp = format!("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: {}\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nVary: Origin\r\nConnection: close\r\n\r\n", allowed_origin);
        let _ = stream.write_all(resp.as_bytes()).await;
        return;
    }

    match (method, clean_path) {
        ("POST", p) if p == "share" => {
            let max_body = state.config.share.max_share_bytes;
            if content_length > max_body {
                info!("{} share upload rejected: {} bytes > {} limit", peer, content_length, max_body);
                let resp = http_response("413 Payload Too Large", "text/plain", b"Share too large", allowed_origin);
                let _ = stream.write_all(&resp).await;
                return;
            }
            let mut body = vec![0u8; content_length];
            if let Err(_) = stream.read_exact(&mut body).await {
                info!("{} share upload read error", peer);
                return;
            }
            let ttl = query.get("ttl").and_then(|v| v.parse::<u64>().ok());
            let uses = query.get("uses").and_then(|v| v.parse::<u32>().ok());
            let max_ttl = state.config.share.max_share_ttl_secs;
            if let Some(t) = ttl {
                if t > max_ttl {
                    info!("{} share upload rejected: ttl {}s > max {}s", peer, t, max_ttl);
                    let resp = http_response("400 Bad Request", "text/plain",
                        format!("TTL exceeds server maximum of {}s", max_ttl).as_bytes(), allowed_origin);
                    let _ = stream.write_all(&resp).await;
                    return;
                }
            }
            let mut store = state.shares.lock().await;
            let id = store.insert(body, ttl, uses);
            info!("{} share uploaded {} bytes -> id {} (ttl={:?}, uses={:?})", peer, content_length, id, ttl, uses);
            let json = serde_json::json!({"id": id}).to_string();
            let resp = http_response("200 OK", "application/json", json.as_bytes(), allowed_origin);
            let _ = stream.write_all(&resp).await;
        }
        ("GET", p) if p.starts_with("share/") => {
            let id = &p[6..];
            let mut store = state.shares.lock().await;
            if let Some(data) = store.get(id) {
                info!("{} share download {} -> {} bytes", peer, id, data.len());
                let resp = http_response("200 OK", "application/octet-stream", &data, allowed_origin);
                let _ = stream.write_all(&resp).await;
            } else {
                info!("{} share download {} -> not found or expired", peer, id);
                let resp = http_response("404 Not Found", "text/plain", b"Share not found", allowed_origin);
                let _ = stream.write_all(&resp).await;
            }
        }
        _ => {
            let body = include_str!("share_page.html");
            let resp = http_response("200 OK", "text/html", body.as_bytes(), allowed_origin);
            let _ = stream.write_all(&resp).await;
        }
    }
}
