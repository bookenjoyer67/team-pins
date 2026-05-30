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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_unix_millis_monotonic() {
        let a = unix_millis();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = unix_millis();
        assert!(b > a, "time should advance: {} <= {}", b, a);
    }

    #[test]
    fn test_json_err() {
        let s = json_err("test reason");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["reason"], "test reason");
    }

    #[test]
    fn test_json_hello() {
        let s = json_hello();
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "hello");
    }

    #[test]
    fn test_json_welcome() {
        let s = json_welcome("abc-123");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "welcome");
        assert_eq!(v["clientId"], "abc-123");
    }

    #[test]
    fn test_json_joined() {
        let s = json_joined("peer-1");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "peer_joined");
        assert_eq!(v["clientId"], "peer-1");
    }

    #[test]
    fn test_json_left() {
        let s = json_left("peer-2");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "peer_left");
        assert_eq!(v["clientId"], "peer-2");
    }

    #[test]
    fn test_json_auth_challenge() {
        let (msg, challenge, ts) = json_auth_challenge();
        assert!(!msg.is_empty());
        assert!(!challenge.is_empty(), "challenge should not be empty");
        assert!(ts > 0, "timestamp should be positive");
        // Verify JSON structure
        let v: serde_json::Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(v["type"], "auth_challenge");
        assert_eq!(v["challenge"], challenge);
        assert_eq!(v["ts"], ts);
    }

    #[test]
    fn test_json_member_added() {
        let s = json_member_added("cid", "pk", "Alice", "founder");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "member_added");
        assert_eq!(v["community_id"], "cid");
        assert_eq!(v["pubkey"], "pk");
        assert_eq!(v["display_name"], "Alice");
        assert_eq!(v["role"], "founder");
    }

    #[test]
    fn test_json_member_removed() {
        let s = json_member_removed("cid", "pk");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "member_removed");
        assert_eq!(v["community_id"], "cid");
        assert_eq!(v["pubkey"], "pk");
    }

    #[test]
    fn test_json_claim_denied() {
        let s = json_claim_denied("token expired");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "claim_denied");
        assert_eq!(v["reason"], "token expired");
    }

    #[test]
    fn test_hash_password_roundtrip() {
        let pw = "correct-horse-battery-staple";
        let hash = hash_password(pw);
        assert!(!hash.is_empty(), "hash should not be empty");
        assert!(hash.contains(':'), "hash should contain salt:hash delimiter");
        assert!(check_password(&hash, pw), "correct password should verify");
    }

    #[test]
    fn test_check_password_rejects_wrong() {
        let hash = hash_password("right-password");
        assert!(!check_password(&hash, "wrong-password"), "wrong password should fail");
    }

    #[test]
    fn test_check_password_rejects_empty() {
        let hash = hash_password("something");
        assert!(!check_password(&hash, ""), "empty password should fail");
        assert!(!check_password("", "something"), "empty stored hash should fail");
    }

    #[test]
    fn test_check_password_rejects_malformed() {
        assert!(!check_password("no-delimiter", "anything"));
        assert!(!check_password(":hash-without-salt", "anything"));
        assert!(!check_password("not-hex:not-hex-either", "anything"));
    }

    #[test]
    fn test_all_json_outputs_are_valid() {
        let outputs: Vec<String> = vec![
            json_err("test"),
            json_hello(),
            json_welcome("cid"),
            json_joined("cid"),
            json_left("cid"),
            json_auth_challenge().0,
            json_member_added("cid", "pk", "name", "role"),
            json_member_removed("cid", "pk"),
            json_claim_denied("reason"),
        ];
        for (i, s) in outputs.iter().enumerate() {
            assert!(serde_json::from_str::<serde_json::Value>(s).is_ok(), "output {} is not valid JSON: {}", i, s);
        }
    }
}
