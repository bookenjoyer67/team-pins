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
    let pk = hex::encode(vk.to_bytes());
    let cm = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(cm["type"], "auth_challenge");
    let challenge = cm["challenge"].as_str().unwrap();
    let ts = cm["ts"].as_u64().unwrap();
    let sig = sign_payload(sk, &format!("{}{}", challenge, ts));
    client.send(&serde_json::json!({
        "type":"auth_response","pubkey":pk,"challenge":challenge,"signature":sig,"ts":ts
    })).await;
    let ok = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(ok["type"], "auth_ok");
    pk
}

#[tokio::test]
async fn test_pin_vote_up_and_verify() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(21);
    let pk = auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"register_community","community_id":"v1","name":"V1","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},"members":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"push_delta","community_id":"v1","ts":now,
        "pins":[{"pin_id":"a","community_id":"v1","ciphertext":"x","nonce":"y"}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    let ts = now + 1;
    let sig = sign_payload(&sk, &format!("a|v1|1|{}", ts));
    client.send(&serde_json::json!({
        "type":"pin_vote","pin_id":"a","community_id":"v1","dir":1,"pubkey":pk,"signature":sig,"timestamp":ts
    })).await;
    let r = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(r["type"],"pin_vote_bc");
    assert_eq!(r["vote_count_up"],1);
    drop(client);
}

#[tokio::test]
async fn test_pin_vote_down_and_verify() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(22);
    let pk = auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"register_community","community_id":"v2","name":"V2","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},"members":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"push_delta","community_id":"v2","ts":now,
        "pins":[{"pin_id":"b","community_id":"v2","ciphertext":"x","nonce":"y"}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    let ts = now + 1;
    let sig = sign_payload(&sk, &format!("b|v2|-1|{}", ts));
    client.send(&serde_json::json!({
        "type":"pin_vote","pin_id":"b","community_id":"v2","dir":-1,"pubkey":pk,"signature":sig,"timestamp":ts
    })).await;
    let r = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(r["type"],"pin_vote_bc");
    assert_eq!(r["vote_count_down"],1);
    drop(client);
}

#[tokio::test]
async fn test_pin_vote_duplicate_rejected() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(23);
    let pk = auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"register_community","community_id":"v3","name":"V3","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},"members":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"push_delta","community_id":"v3","ts":now,
        "pins":[{"pin_id":"c","community_id":"v3","ciphertext":"x","nonce":"y"}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    let ts = now + 1;
    let sig = sign_payload(&sk, &format!("c|v3|1|{}", ts));
    let vote = serde_json::json!({
        "type":"pin_vote","pin_id":"c","community_id":"v3","dir":1,"pubkey":pk,"signature":sig,"timestamp":ts
    });
    client.send(&vote).await;
    let r1 = client.recv_timeout(Duration::from_secs(3)).await.unwrap();
    assert_eq!(r1["vote_count_up"],1);

    client.send(&vote).await;
    let r2 = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(r2.map_or(true,|v| v["type"]!="pin_vote_bc" || v["vote_count_up"]==1),
        "duplicate vote should not increase count");
    drop(client);
}

#[tokio::test]
async fn test_pin_vote_missing_signature_rejected() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (_, vk) = make_keypair(24);
    let pk = hex::encode(vk.to_bytes());

    client.send(&serde_json::json!({
        "type":"register_community","community_id":"v4","name":"V4","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},"members":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"push_delta","community_id":"v4","ts":now,
        "pins":[{"pin_id":"d","community_id":"v4","ciphertext":"x","nonce":"y"}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    client.send(&serde_json::json!({
        "type":"pin_vote","pin_id":"d","community_id":"v4","dir":1,"pubkey":pk,"timestamp":now+1
    })).await;
    let r = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(r.map_or(true,|v| v["type"]!="pin_vote_bc"), "missing sig should be rejected");
    drop(client);
}

#[tokio::test]
async fn test_pin_vote_invalid_dir_rejected() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(25);
    let pk = auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"register_community","community_id":"v5","name":"V5","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},"members":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"push_delta","community_id":"v5","ts":now,
        "pins":[{"pin_id":"e","community_id":"v5","ciphertext":"x","nonce":"y"}],
        "annotations":[],"drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    // dir=0 is rejected by handler early, before pubkey check
    client.send(&serde_json::json!({
        "type":"pin_vote","pin_id":"e","community_id":"v5","dir":0,"pubkey":pk,"timestamp":now+1
    })).await;
    let r = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(r.map_or(true,|v| v["type"]!="pin_vote_bc"), "dir=0 should be rejected");
    drop(client);
}

#[tokio::test]
async fn test_annotation_vote_and_rebroadcast() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();
    let (mut client, _) = join_room(addr, "community-relay").await;
    let (sk, vk) = make_keypair(26);
    let pk = auth_client(&mut client, &sk, &vk).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"register_community","community_id":"av","name":"AV","description":"",
        "public_key":"00".repeat(32),"wrapped_dek":"00".repeat(32),"key_derivation":"random",
        "genesis_public_key":"00".repeat(32),"governance":{},"members":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type":"push_delta","community_id":"av","ts":now,
        "pins":[],
        "annotations":[{"annotation_id":"a1","pin_id":"p1","ciphertext":"x","nonce":"y","author_pubkey":"author"}],
        "drawings":[],"tombstones":[],"deleted_pin_ids":[],"deleted_drawing_ids":[]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    let ts = now + 1;
    let sig = sign_payload(&sk, &format!("a1|up|{}", ts));
    client.send(&serde_json::json!({
        "type":"annotation_vote","annotation_id":"a1","community_id":"av",
        "pubkey":pk,"direction":"up","signature":sig,"timestamp":ts
    })).await;
    let r = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(r.is_some(), "should receive rebroadcast");
    assert_eq!(r.unwrap()["type"],"annotation_vote");
    drop(client);
}

