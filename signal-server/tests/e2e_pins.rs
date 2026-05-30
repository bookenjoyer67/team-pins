mod common;
use common::*;

use tokio::time::Duration;

#[tokio::test]
async fn test_register_and_join_community() {
    let addr = start_server().await;
    let (mut client, _welcome) = join_room(addr, "community-relay").await;
    client.drain().await;

    let reg = serde_json::json!({
        "type": "register_community",
        "community_id": "test-cid-001",
        "name": "Test Community",
        "description": "A test community",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {"contribution": "open", "validation": "none"},
        "members": [{"pubkey": "00".repeat(32), "display_name": "Founder", "role": "founder"}]
    });
    client.send(&reg).await;

    let resp = client.recv_timeout(Duration::from_secs(5)).await;
    assert!(resp.is_some(), "should receive community registration response");
    assert_eq!(resp.unwrap()["type"], "community_registered");

    drop(client);
}

#[tokio::test]
async fn test_push_delta_and_sync() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    // Register
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "test-cid-002",
        "name": "Sync Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    })).await;
    let reg_resp = client.recv_timeout(Duration::from_secs(5)).await;
    assert!(reg_resp.is_some(), "should get community_registered");
    assert_eq!(reg_resp.unwrap()["type"], "community_registered");

    // Push pins — include "ts" field so pins don't get created_at=0
    client.send(&serde_json::json!({
        "type": "push_delta",
        "community_id": "test-cid-002",
        "ts": now,
        "pins": [
            {"pin_id": "pin-1", "community_id": "test-cid-002", "created_at": now, "ciphertext": "aa", "nonce": "bb"},
            {"pin_id": "pin-2", "community_id": "test-cid-002", "created_at": now + 1, "ciphertext": "cc", "nonce": "dd"}
        ],
        "annotations": [], "drawings": [], "tombstones": [], "deleted_pin_ids": [], "deleted_drawing_ids": []
    })).await;

    // Server sends "delta_stored" response
    let stored = client.recv_timeout(Duration::from_secs(5)).await;
    assert!(stored.is_some(), "should receive delta_stored");
    assert_eq!(stored.unwrap()["type"], "delta_stored");

    // Sync request
    client.send(&serde_json::json!({
        "type": "sync_request",
        "community_id": "test-cid-002",
        "since": 0
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(5)).await;
    assert!(resp.is_some(), "should receive sync_delta");
    let r = resp.unwrap();
    assert_eq!(r["type"], "sync_delta", "expected sync_delta, got: {:?}", r);
    let pins = r["pins"].as_array().unwrap();
    assert!(pins.len() >= 2, "should have >= 2 pins, got {:?}", pins);

    drop(client);
}

#[tokio::test]
async fn test_since_filter() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    let later = piggpin_signal::messages::unix_millis();

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    // Register
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "test-cid-003",
        "name": "Since Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    })).await;
    client.recv_timeout(std::time::Duration::from_secs(5)).await;
    client.drain().await;

    // Push first pin at timestamp "now"
    client.send(&serde_json::json!({
        "type": "push_delta",
        "community_id": "test-cid-003",
        "ts": now,
        "pins": [
            {"pin_id": "old-pin", "community_id": "test-cid-003", "ciphertext": "xx", "nonce": "yy"}
        ],
        "annotations": [], "drawings": [], "tombstones": [], "deleted_pin_ids": [], "deleted_drawing_ids": []
    })).await;
    client.recv_timeout(std::time::Duration::from_secs(5)).await;

    // Push second pin at "later" time
    client.send(&serde_json::json!({
        "type": "push_delta",
        "community_id": "test-cid-003",
        "ts": later,
        "pins": [
            {"pin_id": "new-pin", "community_id": "test-cid-003", "ciphertext": "zz", "nonce": "ww"}
        ],
        "annotations": [], "drawings": [], "tombstones": [], "deleted_pin_ids": [], "deleted_drawing_ids": []
    })).await;
    client.recv_timeout(std::time::Duration::from_secs(5)).await;

    // Sync with since = (now + later) / 2 — should only get the newer pin
    let midpoint = now + (later - now) / 2;
    client.send(&serde_json::json!({
        "type": "sync_request",
        "community_id": "test-cid-003",
        "since": midpoint
    })).await;

    let resp = client.recv_timeout(std::time::Duration::from_secs(5)).await;
    assert!(resp.is_some(), "should receive sync_delta");
    let r = resp.unwrap();
    let pins = r["pins"].as_array().unwrap();
    assert_eq!(pins.len(), 1, "since filter should return 1 pin, got {:?}", pins);
    assert_eq!(pins[0]["pin_id"], "new-pin");

    drop(client);
}

#[tokio::test]
async fn test_duplicate_community_register() {
    let addr = start_server().await;
    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    let reg = serde_json::json!({
        "type": "register_community",
        "community_id": "test-cid-dup",
        "name": "Dup Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    });

    client.send(&reg).await;
    let r1 = client.recv_timeout(Duration::from_secs(5)).await;
    assert!(r1.is_some(), "first registration should succeed");
    assert_eq!(r1.unwrap()["type"], "community_registered");

    // Re-register
    client.send(&reg).await;
    let r2 = client.recv_timeout(Duration::from_secs(5)).await;
    assert!(r2.is_some(), "re-registration should succeed");
    assert_eq!(r2.unwrap()["type"], "community_registered");

    drop(client);
}

#[tokio::test]
async fn test_pin_push_and_retrieve() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    // Register
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "test-cid-bulk",
        "name": "Bulk Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    })).await;
    client.recv_timeout(Duration::from_secs(5)).await;
    client.drain().await;

    // Push 4 pins — include "ts" field
    let pins: Vec<serde_json::Value> = (1..=4).map(|i| {
        serde_json::json!({
            "pin_id": format!("bulk-pin-{}", i),
            "community_id": "test-cid-bulk",
            "created_at": now + i * 100,
            "ciphertext": format!("cc{}", i),
            "nonce": format!("nn{}", i)
        })
    }).collect();

    client.send(&serde_json::json!({
        "type": "push_delta",
        "community_id": "test-cid-bulk",
        "ts": now,
        "pins": pins,
        "annotations": [], "drawings": [], "tombstones": [], "deleted_pin_ids": [], "deleted_drawing_ids": []
    })).await;
    // Consume delta_stored
    let stored = client.recv_timeout(Duration::from_secs(5)).await;
    assert!(stored.is_some(), "should receive delta_stored");

    // Sync and verify
    client.send(&serde_json::json!({
        "type": "sync_request",
        "community_id": "test-cid-bulk",
        "since": 0
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(5)).await;
    assert!(resp.is_some(), "should receive sync_delta");
    let pins = resp.unwrap()["pins"].as_array().unwrap().clone();
    assert_eq!(pins.len(), 4, "should have 4 pins, got {}", pins.len());

    drop(client);
}
