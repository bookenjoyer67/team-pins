mod common;
use common::*;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::time::Duration;

#[tokio::test]
async fn test_concurrent_multi_client_join_and_sync() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();
    let client_count = 6;

    // Keep registration client alive to prevent room cleanup
    let (mut reg_client, _) = join_room(addr, "community-relay").await;
    reg_client.drain().await;
    reg_client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "conc-cid",
        "name": "Concurrent Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    })).await;
    reg_client.recv_timeout(Duration::from_secs(3)).await;

    let addr_arc = Arc::new(addr);
    let mut handles = Vec::new();

    // Start all clients concurrently (join + handshake)
    for _ in 0..client_count {
        let a = addr_arc.clone();
        handles.push(tokio::spawn(async move {
            let mut client = common::join_room(*a, "community-relay").await.0;
            // Drain auth_challenge and any peer_joined from other concurrent joins
            client.drain().await;
            client
        }));
    }

    let mut clients: Vec<TestClient> = Vec::new();
    for h in handles {
        if let Ok(c) = h.await {
            clients.push(c);
        }
    }
    assert_eq!(clients.len(), client_count, "all clients should join");

    // Verify a single push works after concurrent joins
    let mut first = clients.remove(0);
    let pin_id = "conc-pin-master";
    first.send(&serde_json::json!({
        "type": "push_delta",
        "community_id": "conc-cid",
        "ts": now,
        "pins": [{"pin_id": pin_id, "community_id": "conc-cid", "ciphertext": "data-master", "nonce": "nn"}],
        "annotations": [], "drawings": [], "tombstones": [], "deleted_pin_ids": [], "deleted_drawing_ids": []
    })).await;

    let stored = first.recv_timeout(Duration::from_secs(5)).await;
    assert!(stored.is_some(), "should receive delta_stored after concurrent joins");
    assert_eq!(stored.unwrap()["type"], "delta_stored");

    // Final sync to verify the pin was stored
    first.send(&serde_json::json!({
        "type": "sync_request",
        "community_id": "conc-cid",
        "since": 0
    })).await;
    let sync = first.recv_timeout(Duration::from_secs(5)).await;
    assert!(sync.is_some(), "verifier should receive sync_delta");
    let pins = sync.unwrap()["pins"].as_array().cloned().unwrap_or_default();
    assert!(pins.len() >= 1, "should have at least 1 pin, got {}", pins.len());

    drop(first);
    drop(reg_client);
}

#[tokio::test]
async fn test_broadcast_during_client_disconnect() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();

    // Register
    let (mut reg_client, _) = join_room(addr, "community-relay").await;
    reg_client.drain().await;
    reg_client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "race-cid",
        "name": "Race Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    })).await;
    reg_client.recv_timeout(Duration::from_secs(3)).await;
    drop(reg_client);

    // Join two clients
    let (mut sender, _) = join_room(addr, "community-relay").await;
    let _ = sender.recv_timeout(Duration::from_millis(300)).await;
    let (mut receiver, _) = join_room(addr, "community-relay").await;
    let _ = receiver.recv_timeout(Duration::from_millis(300)).await;
    let _ = sender.recv_timeout(Duration::from_millis(300)).await; // peer_joined

    // Receiver disconnects while sender is pushing
    drop(receiver);

    // Sender pushes multiple pins — should succeed without panic even though
    // the receiver disconnected mid-broadcast
    for i in 0..5 {
        sender.send(&serde_json::json!({
            "type": "push_delta",
            "community_id": "race-cid",
            "ts": now + i * 10,
            "pins": [{"pin_id": format!("race-pin-{}", i), "community_id": "race-cid", "ciphertext": format!("d{}", i), "nonce": "nn"}],
            "annotations": [], "drawings": [], "tombstones": [], "deleted_pin_ids": [], "deleted_drawing_ids": []
        })).await;

        // We may receive peer_left before delta_stored due to disconnect
        let stored = sender.recv_timeout(Duration::from_secs(5)).await;
        if let Some(ref r) = stored {
            if r["type"] == "peer_left" {
                // Try once more for delta_stored
                let stored2 = sender.recv_timeout(Duration::from_secs(3)).await;
                if stored2.is_none() || stored2.as_ref().unwrap()["type"] != "delta_stored" {
                    break;
                }
                continue;
            }
            assert_eq!(r["type"], "delta_stored", "expected delta_stored, got: {}", r);
        }
    }

    drop(sender);
}

#[tokio::test]
async fn test_concurrent_join_same_room() {
    let addr = start_server().await;
    let client_count = 8;
    let joined = Arc::new(AtomicUsize::new(0));
    let a = Arc::new(addr);
    let mut handles = Vec::new();

    for _ in 0..client_count {
        let a = a.clone();
        let j = joined.clone();
        handles.push(tokio::spawn(async move {
            let (client, welcome) = common::join_room(*a, "concurrent-join").await;
            let cid = welcome["clientId"].as_str().unwrap().to_string();
            assert!(!cid.is_empty());
            j.fetch_add(1, Ordering::Relaxed);
            drop(client);
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    assert_eq!(joined.load(Ordering::Relaxed), client_count,
        "all clients should join without errors");
}
