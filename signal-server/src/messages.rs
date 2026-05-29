use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;

pub fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(std::time::Duration::from_millis(0))
        .as_millis() as u64
}

pub fn json_err(reason: &str) -> String {
    serde_json::json!({"type":"error","reason":reason}).to_string()
}

pub fn json_hello() -> String {
    serde_json::json!({"type":"hello"}).to_string()
}

pub fn json_welcome(cid: &str) -> String {
    serde_json::json!({"type":"welcome","clientId":cid}).to_string()
}

pub fn json_joined(cid: &str) -> String {
    serde_json::json!({"type":"peer_joined","clientId":cid}).to_string()
}

pub fn json_left(cid: &str) -> String {
    serde_json::json!({"type":"peer_left","clientId":cid}).to_string()
}

pub fn json_auth_challenge() -> (String, String, u64) {
    let mut buf = [0u8; 32];
    if getrandom::getrandom(&mut buf).is_err() {
        return (json_err("entropy failure"), String::new(), 0);
    }
    let challenge = hex::encode(buf);
    let ts = unix_millis();
    (serde_json::json!({"type":"auth_challenge","challenge":challenge,"ts":ts}).to_string(), challenge, ts)
}

pub fn json_member_added(community_id: &str, pubkey: &str, display_name: &str, role: &str) -> String {
    serde_json::json!({
        "type": "member_added",
        "community_id": community_id,
        "pubkey": pubkey,
        "display_name": display_name,
        "role": role,
    }).to_string()
}

pub fn json_member_removed(community_id: &str, pubkey: &str) -> String {
    serde_json::json!({
        "type": "member_removed",
        "community_id": community_id,
        "pubkey": pubkey,
    }).to_string()
}

pub fn json_claim_denied(reason: &str) -> String {
    serde_json::json!({"type":"claim_denied","reason":reason}).to_string()
}

pub fn hash_password(pw: &str) -> String {
    let mut salt = [0u8; 16];
    if getrandom::getrandom(&mut salt).is_err() {
        tracing::error!("hash_password: getrandom failed, cannot generate salt");
        return String::new();
    }
    let mut hash = [0u8; 32];
    pbkdf2_hmac::<Sha256>(pw.as_bytes(), &salt, 210_000, &mut hash);
    format!("{}:{}", hex::encode(&salt), hex::encode(&hash))
}

pub fn check_password(stored: &str, pw: &str) -> bool {
    if let Some((salt_hex, hash_hex)) = stored.split_once(':') {
        let salt = match hex::decode(salt_hex) { Ok(s) => s, Err(_) => { return false; } };
        let mut hash = [0u8; 32];
        pbkdf2_hmac::<Sha256>(pw.as_bytes(), &salt, 210_000, &mut hash);
        hex::encode(&hash) == hash_hex
    } else {
        false
    }
}
