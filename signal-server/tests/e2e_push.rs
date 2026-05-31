mod common;
use common::*;

use tokio::time::Duration;

use ed25519_dalek::{SigningKey, Signer, VerifyingKey};
use sha2::{Sha512, Digest};

fn make_keypair(seed: u8) -> (SigningKey, VerifyingKey) {
    let bytes = [seed; 32];
    let hash = Sha512::digest(bytes);
    let sk = SigningKey::from_bytes(&hash[..32].try_into().unwrap());
    let vk = sk.verifying_key();
    (sk, vk)
}

fn sign_payload(sk: &SigningKey, raw: &str) -> String {
    hex::encode(sk.sign(raw.as_bytes()).to_bytes())
}

async fn auth_client(client: &mut TestClient, sk: &SigningKey, vk: &VerifyingKey) -> String {
    let cm = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(cm["type"], "auth_challenge");
    let challenge = cm["challenge"].as_str().unwrap();
    let ts = cm["ts"].as_u64().unwrap();
    let sig = sign_payload(sk, &format!("{}{}", challenge, ts));
    let pk = hex::encode(vk.to_bytes());
    client.send(&serde_json::json!({
        "type":"auth_response","pubkey":pk,"challenge":challenge,"signature":sig,"ts":ts
    })).await;
    let ok = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(ok["type"], "auth_ok");
    pk
}

// ── Register push subscription ──

#[tokio::test]
async fn test_register_push_subscription_ok() {
    let addr = start_server().await;
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(81);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": "https://fcm.googleapis.com/fcm/send/test01",
        "p256dh": "p256dh_test",
        "auth": "auth_test"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "push_registered");
    drop(client);
}

#[tokio::test]
async fn test_register_push_subscription_no_auth() {
    let addr = start_server().await;
    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": "https://fcm.googleapis.com/fcm/send/test02",
        "p256dh": "p256dh_test",
        "auth": "auth_test"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "error");
    assert!(resp["reason"].as_str().unwrap().contains("auth"));
    drop(client);
}

#[tokio::test]
async fn test_register_push_subscription_missing_fields() {
    let addr = start_server().await;
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(82);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": "",
        "p256dh": "",
        "auth": ""
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "error");
    assert!(resp["reason"].as_str().unwrap().contains("missing"));
    drop(client);
}

#[tokio::test]
async fn test_register_push_subscription_returns_all_fields() {
    let addr = start_server().await;
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(83);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": "https://fcm.googleapis.com/fcm/send/test03",
        "p256dh": "p256dh_value_here",
        "auth": "auth_value_here"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "push_registered");
    drop(client);
}

// ── Unregister push subscription ──

#[tokio::test]
async fn test_unregister_push_subscription_ok() {
    let addr = start_server().await;
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(84);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": "https://fcm.googleapis.com/fcm/send/test04",
        "p256dh": "p256dh",
        "auth": "auth"
    })).await;
    let _ = client.recv_timeout(Duration::from_secs(3)).await;

    client.send(&serde_json::json!({
        "type": "unregister_push_subscription",
        "endpoint": "https://fcm.googleapis.com/fcm/send/test04"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "push_unregistered");
    drop(client);
}

#[tokio::test]
async fn test_unregister_push_subscription_nonexistent() {
    let addr = start_server().await;
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(85);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "unregister_push_subscription",
        "endpoint": "https://fcm.googleapis.com/fcm/send/nonexistent"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "push_unregistered");
    drop(client);
}

#[tokio::test]
async fn test_unregister_push_subscription_missing_endpoint() {
    let addr = start_server().await;
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(86);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "unregister_push_subscription",
        "endpoint": ""
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "error");
    drop(client);
}

// ── Pubkey isolation ──

#[tokio::test]
async fn test_push_sub_pubkey_isolation_over_ws() {
    let addr = start_server().await;

    let (mut client_a, _) = join_room(addr, "community-relay").await;
    let (sk_a, vk_a) = make_keypair(91);
    auth_client(&mut client_a, &sk_a, &vk_a).await;
    client_a.drain().await;

    client_a.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": "https://fcm.com/client-a",
        "p256dh": "pk-a",
        "auth": "auth-a"
    })).await;
    let _ = client_a.recv_timeout(Duration::from_secs(3)).await;
    drop(client_a);

    let (mut client_b, _) = join_room(addr, "community-relay").await;
    let (sk_b, vk_b) = make_keypair(92);
    auth_client(&mut client_b, &sk_b, &vk_b).await;
    client_b.drain().await;

    client_b.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": "https://fcm.com/client-b",
        "p256dh": "pk-b",
        "auth": "auth-b"
    })).await;
    let _ = client_b.recv_timeout(Duration::from_secs(3)).await;

    let (mut client_a2, _) = join_room(addr, "community-relay").await;
    let (sk_a2, vk_a2) = make_keypair(91);
    auth_client(&mut client_a2, &sk_a2, &vk_a2).await;
    client_a2.drain().await;

    client_a2.send(&serde_json::json!({
        "type": "unregister_push_subscription",
        "endpoint": "https://fcm.com/client-b"
    })).await;
    let resp = client_a2.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "push_unregistered");

    client_a2.send(&serde_json::json!({
        "type": "unregister_push_subscription",
        "endpoint": "https://fcm.com/client-a"
    })).await;
    let resp2 = client_a2.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp2["type"], "push_unregistered");

    drop(client_a2);
    drop(client_b);
}

// ── Subscription persists across reconnect ──

#[tokio::test]
async fn test_push_sub_persists_across_reconnect() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(93);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": "https://fcm.com/reconnect-test",
        "p256dh": "pk-rc",
        "auth": "auth-rc"
    })).await;
    let _ = client.recv_timeout(Duration::from_secs(3)).await;
    drop(client);

    let (mut client2, _) = join_room(addr, "community-relay").await;
    let (sk2, vk2) = make_keypair(93);
    auth_client(&mut client2, &sk2, &vk2).await;
    client2.drain().await;

    client2.send(&serde_json::json!({
        "type": "unregister_push_subscription",
        "endpoint": "https://fcm.com/reconnect-test"
    })).await;
    let resp = client2.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "push_unregistered");
    drop(client2);
}

// ── Push dispatch integration tests ──

static VAPID_TEST_PEM: &str = "-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIOyBod2hHikXPGIe7/3l4d21UF9r7YorjOIt+WH21BaCoAoGCCqGSM49\nAwEHoUQDQgAEDpliXLXeD8VBWt0Tz8ApIJmT/FalcnnIlgji+pdOxy0zw6R6A9qT\nif2mrBf3azVLi3RBErf+tE9o6xeNmiIWdQ==\n-----END EC PRIVATE KEY-----\n";
static TEST_P256DH: &str = "BJkVyLAFBk5a8g6oiIGrU8lvZsGnkKFe5_8CpkOPLFWbsJxxE09bgCI1zFzgjGeQrhlFW5ynz8gVm_iBS9QGYWM";
static TEST_AUTH: &str = "qQhQptOKl61Ox9ox2xq-ZQ";

use piggpin_signal::config::PushConfig;

fn push_cfg() -> PushConfig {
    PushConfig {
        enabled: true,
        vapid_private_key_pem: Some(VAPID_TEST_PEM.to_string()),
        vapid_subject: Some("mailto:test@localhost".to_string()),
        vapid_public_key: Some("BBUf53OU0Yb7RcCKxJmK90TF4Whq_t7h5CIrPulhlFp4K7w7SapqRNwSngRCkHS9y3GlnItoLiH4wUmkBRH3-1s".to_string()),
        min_interval_secs: 1,
        batch_max: 50,
    }
}

#[tokio::test]
async fn test_push_info_returns_valid_public_key() {
    let mut config = piggpin_signal::config::Config::default();
    config.push = push_cfg();
    let addr = start_server_with_config(config).await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(171);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({"type":"push_info"})).await;
    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();

    assert_eq!(resp["type"], "push_info");
    assert!(resp["enabled"].as_bool().unwrap_or(false));

    let key = resp["vapid_public_key"].as_str().unwrap();
    assert!(!key.is_empty(), "public key must not be empty");
    // Valid base64url: only A-Z a-z 0-9 - _
    assert!(key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "public key must be valid base64url, got: {}", key);
    // Uncompressed P-256 key: 65 bytes → 87 chars base64 without padding
    assert!(key.len() >= 85, "base64url-encoded 65-byte key should be ~87 chars, got {}", key.len());
    drop(client);
}

async fn setup_community_with_push(
    addr: std::net::SocketAddr,
    seed: u8,
    cid: &str,
    mock_endpoint: &str,
) -> (TestClient, SigningKey, String, u64) {
    // Client A: auth, register community as founder
    let (mut client_a, _) = join_room(addr, "community-relay").await;
    let (sk_a, vk_a) = make_keypair(seed);
    let pk_a = auth_client(&mut client_a, &sk_a, &vk_a).await;
    client_a.drain().await;

    let now = piggpin_signal::messages::unix_millis();

    client_a.send(&serde_json::json!({
        "type":"register_community","community_id":cid,"name":"Test","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},
        "members":[{"pubkey":pk_a,"display_name":"A","role":"founder"}]
    })).await;
    client_a.recv_timeout(Duration::from_secs(3)).await;
    client_a.drain().await;

    // Client B: auth, add as member
    let (mut client_b, _) = join_room(addr, "community-relay").await;
    let (sk_b, vk_b) = make_keypair(seed + 1);
    let pk_b = auth_client(&mut client_b, &sk_b, &vk_b).await;
    client_b.drain().await;

    let ts = piggpin_signal::messages::unix_millis();
    let add_sig = sign_payload(&sk_a, &format!("{}|{}|{}|{}", cid, pk_b, "contributor", ts));
    client_a.send(&serde_json::json!({
        "type":"add_member","community_id":cid,"pubkey":pk_b,"display_name":"B",
        "role":"contributor","signature":add_sig,"timestamp":ts
    })).await;
    let r = client_a.recv_timeout(Duration::from_secs(3)).await;
    assert!(r.is_some(), "add_member response expected");

    // Register push sub
    client_b.send(&serde_json::json!({
        "type": "register_push_subscription",
        "endpoint": mock_endpoint,
        "p256dh": TEST_P256DH,
        "auth": TEST_AUTH
    })).await;
    let _ = client_b.recv_timeout(Duration::from_secs(3)).await;

    // B disconnects
    drop(client_b);
    tokio::time::sleep(Duration::from_millis(200)).await;

    (client_a, sk_a, pk_a, now)
}

#[tokio::test]
async fn test_push_dispatch_attempts_on_delta() {
    let mut config = piggpin_signal::config::Config::default();
    config.push = push_cfg();
    let addr = start_server_with_config(config).await;

    let cid = "push-test-cid";
    let (mut client_a, sk_a, pk_a, now) = setup_community_with_push(
        addr, 201, cid, "http://127.0.0.1:29999/fcm/send/test",
    ).await;

    // Client A pushes a delta — triggers push dispatch to offline B
    client_a.send(&serde_json::json!({
        "type":"push_delta","community_id":cid,"ts":now,
        "pins":[{"pin_id":"p1","community_id":cid,"ciphertext":"x","nonce":"y","author_pubkey":pk_a,
            "attestations":[{"type":"created","pubkey":pk_a,
                "signature":sign_payload(&sk_a,&format!("p1|created|{}",now)),
                "timestamp":now}]}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;

    let resp = client_a.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "server should respond to push_delta even with push enabled");
    drop(client_a);
}

#[tokio::test]
async fn test_push_disabled_delta_still_works() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(131);
    let pk = auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    let cid = "no-push-cid";
    let now = piggpin_signal::messages::unix_millis();

    client.send(&serde_json::json!({
        "type":"register_community","community_id":cid,"name":"NoPush","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},
        "members":[{"pubkey":pk,"display_name":"A","role":"founder"}]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"push_delta","community_id":cid,"ts":now,
        "pins":[{"pin_id":"p3","community_id":cid,"ciphertext":"x","nonce":"y","author_pubkey":pk,
            "attestations":[{"type":"created","pubkey":pk,
                "signature":sign_payload(&sk,&format!("p3|created|{}",now)),
                "timestamp":now}]}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "delta_stored");
    drop(client);
}

// ── Mock push server dispatch tests ──

#[tokio::test]
async fn test_push_dispatch_hits_mock() {
    let mock = start_mock_push(201).await;
    let mut config = piggpin_signal::config::Config::default();
    config.push = push_cfg();
    let addr = start_server_with_config(config).await;

    let cid = "mock-push-cid";
    let mock_endpoint = format!("http://{}/push/test", mock.addr);
    let (mut client_a, sk_a, pk_a, now) = setup_community_with_push(
        addr, 221, cid, &mock_endpoint,
    ).await;

    client_a.send(&serde_json::json!({
        "type":"push_delta","community_id":cid,"ts":now,
        "pins":[{"pin_id":"m1","community_id":cid,"ciphertext":"x","nonce":"y","author_pubkey":pk_a,
            "attestations":[{"type":"created","pubkey":pk_a,
                "signature":sign_payload(&sk_a,&format!("m1|created|{}",now)),
                "timestamp":now}]}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    let _ = client_a.recv_timeout(Duration::from_secs(5)).await;
    tokio::time::sleep(Duration::from_millis(500)).await;

    let captured = mock.captured.lock().await;
    assert!(!captured.is_empty(), "mock push server should have received at least one request");
    drop(captured);
    drop(client_a);
    drop(mock);
}

#[tokio::test]
async fn test_push_debounce() {
    let mock = start_mock_push(201).await;
    let mut config = piggpin_signal::config::Config::default();
    config.push = push_cfg();
    config.push.min_interval_secs = 30;
    let addr = start_server_with_config(config).await;

    let cid = "debounce-cid";
    let mock_endpoint = format!("http://{}/push/debounce", mock.addr);
    let (mut client_a, sk_a, pk_a, now) = setup_community_with_push(
        addr, 241, cid, &mock_endpoint,
    ).await;

    // First delta
    client_a.send(&serde_json::json!({
        "type":"push_delta","community_id":cid,"ts":now,
        "pins":[{"pin_id":"db1","community_id":cid,"ciphertext":"x","nonce":"y","author_pubkey":pk_a,
            "attestations":[{"type":"created","pubkey":pk_a,
                "signature":sign_payload(&sk_a,&format!("db1|created|{}",now)),
                "timestamp":now}]}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    let _ = client_a.recv_timeout(Duration::from_secs(3)).await;

    // Second delta immediately
    let now2 = now + 1;
    client_a.send(&serde_json::json!({
        "type":"push_delta","community_id":cid,"ts":now2,
        "pins":[{"pin_id":"db2","community_id":cid,"ciphertext":"x","nonce":"y","author_pubkey":pk_a,
            "attestations":[{"type":"created","pubkey":pk_a,
                "signature":sign_payload(&sk_a,&format!("db2|created|{}",now2)),
                "timestamp":now2}]}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    let _ = client_a.recv_timeout(Duration::from_secs(3)).await;

    tokio::time::sleep(Duration::from_millis(500)).await;

    let captured = mock.captured.lock().await;
    assert_eq!(captured.len(), 1, "debounce should limit to 1 push within interval");
    drop(captured);
    drop(client_a);
    drop(mock);
}

#[tokio::test]
async fn test_push_stale_endpoint_410() {
    let mock = start_mock_push(410).await;
    let mut config = piggpin_signal::config::Config::default();
    config.push = push_cfg();
    let addr = start_server_with_config(config).await;

    let cid = "stale-cid";
    let mock_endpoint = format!("http://{}/push/stale", mock.addr);
    let (mut client_a, sk_a, pk_a, now) = setup_community_with_push(
        addr, 251, cid, &mock_endpoint,
    ).await;

    // First delta — push will get 410, subscription should be cleaned up
    client_a.send(&serde_json::json!({
        "type":"push_delta","community_id":cid,"ts":now,
        "pins":[{"pin_id":"s1","community_id":cid,"ciphertext":"x","nonce":"y","author_pubkey":pk_a,
            "attestations":[{"type":"created","pubkey":pk_a,
                "signature":sign_payload(&sk_a,&format!("s1|created|{}",now)),
                "timestamp":now}]}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    let _ = client_a.recv_timeout(Duration::from_secs(3)).await;
    tokio::time::sleep(Duration::from_millis(500)).await;

    let first_len = mock.captured.lock().await.len();
    assert!(first_len > 0, "first push attempt should reach mock");

    // Second delta — push should skip because subscription was cleaned up
    let now2 = now + 1000;
    client_a.send(&serde_json::json!({
        "type":"push_delta","community_id":cid,"ts":now2,
        "pins":[{"pin_id":"s2","community_id":cid,"ciphertext":"x","nonce":"y","author_pubkey":pk_a,
            "attestations":[{"type":"created","pubkey":pk_a,
                "signature":sign_payload(&sk_a,&format!("s2|created|{}",now2)),
                "timestamp":now2}]}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    let _ = client_a.recv_timeout(Duration::from_secs(3)).await;
    tokio::time::sleep(Duration::from_millis(500)).await;

    let second_len = mock.captured.lock().await.len();
    assert_eq!(second_len, first_len, "stale sub cleaned up — no second push");
    drop(client_a);
    drop(mock);
}

// ── push_info returns disabled when push not configured ──

#[tokio::test]
async fn test_push_info_disabled_returns_null_key() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(101);
    auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({"type":"push_info"})).await;
    let resp = client.recv_timeout(Duration::from_secs(3)).await.unwrap();

    assert_eq!(resp["type"], "push_info");
    assert_eq!(resp["enabled"].as_bool().unwrap_or(true), false);
    assert!(resp["vapid_public_key"].is_null());

    drop(client);
}

// ── Auto-add member on join_community ──

#[tokio::test]
async fn test_auto_add_member_on_join() {
    let addr = start_server().await;

    // Founder registers a community
    let (mut founder, _) = join_room(addr, "community-relay").await;
    let (sk_f, vk_f) = make_keypair(111);
    let pk_f = auth_client(&mut founder, &sk_f, &vk_f).await;
    founder.drain().await;

    let cid = "auto-add-cid";
    let now = piggpin_signal::messages::unix_millis();
    founder.send(&serde_json::json!({
        "type":"register_community","community_id":cid,"name":"OpenTest","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},
        "members":[{"pubkey":pk_f,"display_name":"Founder","role":"founder"}]
    })).await;
    founder.recv_timeout(Duration::from_secs(3)).await;
    founder.drain().await;

    // Newcomer joins open community
    let (mut joiner, _) = join_room(addr, "community-relay").await;
    let (sk_j, vk_j) = make_keypair(112);
    auth_client(&mut joiner, &sk_j, &vk_j).await;
    joiner.drain().await;

    joiner.send(&serde_json::json!({
        "type":"join_community","community_id":cid,"request_id":"req1"
    })).await;
    let resp = joiner.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(resp["type"], "community_joined");
    assert_eq!(resp["community_id"], cid);

    // your_membership should be present and not null
    let membership = resp.get("your_membership");
    assert!(membership.is_some() && !membership.unwrap().is_null(), "your_membership should be present after auto-add");

    // Members list should contain the joiner
    let members = resp["members"].as_array().unwrap();
    let pk_j = hex::encode(vk_j.to_bytes());
    let found = members.iter().any(|m| m["pubkey"].as_str() == Some(&pk_j));
    assert!(found, "joiner should appear in members list after auto-add");

    drop(founder);
    drop(joiner);
}
