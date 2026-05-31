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

#[tokio::test]
async fn test_auth_challenge_response_flow() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;

    // After welcome, the next message for community-relay is auth_challenge
    let challenge_msg = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(challenge_msg.is_some(), "should receive auth_challenge");
    let cm = challenge_msg.unwrap();
    assert_eq!(cm["type"], "auth_challenge");
    let challenge = cm["challenge"].as_str().unwrap();
    let ts = cm["ts"].as_u64().unwrap();

    let (sk, vk) = make_keypair(99);
    let pk_hex = hex::encode(vk.to_bytes());
    let raw_payload = format!("{}{}", challenge, ts);
    let sig = sk.sign(raw_payload.as_bytes());
    let sig_hex = hex::encode(sig.to_bytes());

    client.send(&serde_json::json!({
        "type": "auth_response",
        "pubkey": pk_hex,
        "challenge": challenge,
        "signature": sig_hex,
        "ts": ts
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive auth_ok");
    assert_eq!(resp.unwrap()["type"], "auth_ok");

    drop(client);
}

#[tokio::test]
async fn test_auth_invalid_signature_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;

    let challenge_msg = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(challenge_msg.is_some(), "should receive auth_challenge");
    let cm = challenge_msg.unwrap();
    let challenge = cm["challenge"].as_str().unwrap();
    let ts = cm["ts"].as_u64().unwrap();

    let (sk, _) = make_keypair(1);
    let (_, vk2) = make_keypair(2);
    let wrong_pk_hex = hex::encode(vk2.to_bytes());
    let raw_payload = format!("{}{}", challenge, ts);
    let sig = sk.sign(raw_payload.as_bytes());
    let sig_hex = hex::encode(sig.to_bytes());

    client.send(&serde_json::json!({
        "type": "auth_response",
        "pubkey": wrong_pk_hex,
        "challenge": challenge,
        "signature": sig_hex,
        "ts": ts
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive auth error");
    let r = resp.unwrap();
    assert!(r["reason"].as_str().map_or(false, |s| s.contains("invalid")),
        "should get invalid signature error, got: {}", r);

    drop(client);
}

#[tokio::test]
async fn test_auth_wrong_challenge_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;

    let challenge_msg = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(challenge_msg.is_some(), "should receive auth_challenge");
    let cm = challenge_msg.unwrap();
    let ts = cm["ts"].as_u64().unwrap();

    let (sk, vk) = make_keypair(3);
    let pk_hex = hex::encode(vk.to_bytes());
    let wrong_challenge = hex::encode([77u8; 32]);
    let raw_payload = format!("{}{}", wrong_challenge, ts);
    let sig = sk.sign(raw_payload.as_bytes());
    let sig_hex = hex::encode(sig.to_bytes());

    client.send(&serde_json::json!({
        "type": "auth_response",
        "pubkey": pk_hex,
        "challenge": wrong_challenge,
        "signature": sig_hex,
        "ts": ts
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive auth error");
    let r = resp.unwrap();
    assert!(r["reason"].as_str().map_or(false, |s| s.contains("invalid") || s.contains("expired")),
        "wrong challenge should be rejected, got: {}", r);

    drop(client);
}
