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

fn http_response(status: &str, content_type: &str, body: &[u8], allowed_origin: &str, request_origin: Option<&str>) -> Vec<u8> {
    let origin = if let Some(req_origin) = request_origin {
        if req_origin == allowed_origin { req_origin } else { allowed_origin }
    } else {
        allowed_origin
    };
    let mut resp = format!("HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: {}\r\nVary: Origin\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n",
        status, content_type, body.len(), origin).into_bytes();
    resp.extend_from_slice(body);
    resp
}

fn http_response_ct(status: &str, content_type: &str, body: &[u8], allowed_origin: &str, request_origin: Option<&str>) -> Vec<u8> {
    http_response(status, content_type, body, allowed_origin, request_origin)
}

async fn handle_osm_proxy(
    _state: &Arc<AppState>,
    stream: &mut TcpStream,
    method: &str,
    raw_path: &str,
    content_length: usize,
    allowed_origin: &str,
    req_origin: Option<&str>,
) {
    let osm_path = raw_path.strip_prefix("/api/proxy/osm/").unwrap_or(raw_path);
    let osm_url = format!("https://api.openstreetmap.org/{}", osm_path);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            let err = http_response("500 Internal Server Error", "text/plain", b"Client init failed", allowed_origin, req_origin);
            let _ = stream.write_all(&err).await;
            return;
        }
    };

    let mut req = match method {
        "GET" => client.get(&osm_url),
        "POST" => {
            let cap = content_length.min(65536);
            let mut body = vec![0u8; cap];
            if cap > 0 {
                if stream.read_exact(&mut body).await.is_err() {
                    return;
                }
            }
            client
                .post(&osm_url)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(String::from_utf8_lossy(&body).to_string())
        }
        _ => {
            let resp = http_response("405 Method Not Allowed", "text/plain", b"Only GET/POST supported", allowed_origin, req_origin);
            let _ = stream.write_all(&resp).await;
            return;
        }
    };

    req = req.header("User-Agent", "piggPin-Relay/0.1.0");

    match req.send().await {
        Ok(resp) => {
            let status_code = resp.status().as_u16();
            let status_text = match status_code {
                200 => "200 OK",
                201 => "201 Created",
                400 => "400 Bad Request",
                404 => "404 Not Found",
                429 => "429 Too Many Requests",
                509 => "509 Bandwidth Limit Exceeded",
                _ => "200 OK",
            };
            let ct = resp.headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let body = resp.bytes().await.unwrap_or_default();
            let proxy_resp = http_response_ct(status_text, &ct, &body, allowed_origin, req_origin);
            let _ = stream.write_all(&proxy_resp).await;
        }
        Err(_) => {
            let err = http_response("502 Bad Gateway", "text/plain", b"Upstream unreachable", allowed_origin, req_origin);
            let _ = stream.write_all(&err).await;
        }
    }
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
    let request_origin = header_str.lines()
        .find_map(|l| {
            if l.to_lowercase().starts_with("origin:") {
                l.split(':').nth(1)?.trim().to_string().into()
            } else { None }
        });

    let (method, raw_path) = match parse_request_line(first_line) {
        Some(mp) => mp,
        None => { info!("{} share HTTP bad request line", peer); return; }
    };

    let path = raw_path.trim_start_matches('/');
    let (clean_path, query) = parse_query(path);

    let allowed_origin = &state.config.share.allowed_origin;
    let req_origin = request_origin.as_deref();

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
                let resp = http_response("413 Payload Too Large", "text/plain", b"Share too large", allowed_origin, req_origin);
                let _ = stream.write_all(&resp).await;
                return;
            }
            let mut body = Vec::with_capacity(content_length);
            let mut remaining = content_length;
            let mut chunk_buf = vec![0u8; 65536];
            let timeout = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                async {
                    while remaining > 0 {
                        let to_read = std::cmp::min(remaining, chunk_buf.len());
                        let n = stream.read(&mut chunk_buf[..to_read]).await.map_err(|_| ())?;
                        if n == 0 { return Err(()); }
                        body.extend_from_slice(&chunk_buf[..n]);
                        remaining -= n;
                    }
                    Ok::<_, ()>(())
                }
            ).await;
            if timeout.is_err() || timeout.unwrap().is_err() {
                info!("{} share upload read error or timeout", peer);
                return;
            }
            let ttl = query.get("ttl").and_then(|v| v.parse::<u64>().ok());
            let uses = query.get("uses").and_then(|v| v.parse::<u32>().ok());
            let max_ttl = state.config.share.max_share_ttl_secs;
            if let Some(t) = ttl {
                if t > max_ttl {
                    info!("{} share upload rejected: ttl {}s > max {}s", peer, t, max_ttl);
                    let resp = http_response("400 Bad Request", "text/plain",
                        format!("TTL exceeds server maximum of {}s", max_ttl).as_bytes(), allowed_origin, req_origin);
                    let _ = stream.write_all(&resp).await;
                    return;
                }
            }
            let mut store = state.shares.lock().await;
            let id = store.insert(body, ttl, uses);
            info!("{} share uploaded {} bytes -> id {} (ttl={:?}, uses={:?})", peer, content_length, id, ttl, uses);
            let json = serde_json::json!({"id": id}).to_string();
            let resp = http_response("200 OK", "application/json", json.as_bytes(), allowed_origin, req_origin);
            let _ = stream.write_all(&resp).await;
        }
        ("GET", p) if p.starts_with("api/proxy/osm/") => {
            handle_osm_proxy(&state, &mut stream, method, raw_path, content_length, allowed_origin, req_origin).await;
        }
        ("POST", p) if p.starts_with("api/proxy/osm/") => {
            handle_osm_proxy(&state, &mut stream, method, raw_path, content_length, allowed_origin, req_origin).await;
        }
        ("GET", p) if p == "health" => {
            use std::sync::atomic::Ordering;

            let uptime = state.start_time.elapsed().as_secs();
            let rooms: usize = state.rooms.iter().count();
            let clients: usize = state.rooms.iter().map(|e| e.value().client_count()).sum();
            let dropped: u64 = state.rooms.iter()
                .map(|e| e.value().dropped_messages.load(Ordering::Relaxed))
                .sum();
            let communities = state.store.communities.read().await.len();
            let shares = state.shares.lock().await.shares.len();
            let rl = state.rl.lock().await;
            let banned_ips = rl.banned_count();
            let total_bans = rl.total_bans;
            let total_rate_limited = rl.total_rate_limited;
            drop(rl);
            let conn_available = state.conn_semaphore.available_permits();
            let conn_accepted = state.connections_accepted.load(Ordering::Relaxed);
            let conn_rejected = state.connections_rejected.load(Ordering::Relaxed);

            let json = serde_json::json!({
                "status": "ok",
                "uptime_secs": uptime,
                "rooms": rooms,
                "clients": clients,
                "communities": communities,
                "shares": shares,
                "banned_ips": banned_ips,
                "total_bans": total_bans,
                "total_rate_limited": total_rate_limited,
                "dropped_messages_total": dropped,
                "conn_semaphore_available": conn_available,
                "connections_accepted": conn_accepted,
                "connections_rejected": conn_rejected,
            }).to_string();
            let resp = http_response("200 OK", "application/json", json.as_bytes(), allowed_origin, req_origin);
            let _ = stream.write_all(&resp).await;
        }
        ("GET", p) if p.starts_with("share/") => {
            let id = &p[6..];
            let mut store = state.shares.lock().await;
            if let Some(data) = store.get(id) {
                info!("{} share download {} -> {} bytes", peer, id, data.len());
                let resp = http_response("200 OK", "application/octet-stream", &data, allowed_origin, req_origin);
                let _ = stream.write_all(&resp).await;
            } else {
                info!("{} share download {} -> not found or expired", peer, id);
                let resp = http_response("404 Not Found", "text/plain", b"Share not found", allowed_origin, req_origin);
                let _ = stream.write_all(&resp).await;
            }
        }
        _ => {
            let body = include_str!("share_page.html");
            let resp = http_response("200 OK", "text/html", body.as_bytes(), allowed_origin, req_origin);
            let _ = stream.write_all(&resp).await;
        }
    }
}
