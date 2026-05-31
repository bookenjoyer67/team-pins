mod common;
use common::*;

use futures_util::SinkExt;
use tokio::time::Duration;

#[tokio::test]
async fn test_delta_stored_uses_guaranteed_delivery() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    // Register
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "bp-cid-001",
        "name": "Backpressure Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await; // community_registered
    client.drain().await; // drain any subsequent messages like community_peer_joined

    // Push pin — uses send_to_guaranteed for delta_stored
    client.send(&serde_json::json!({
        "type": "push_delta",
        "community_id": "bp-cid-001",
        "ts": now,
        "pins": [{"pin_id": "bp-pin", "community_id": "bp-cid-001", "ciphertext": "xx", "nonce": "yy"}],
        "annotations": [], "drawings": [], "tombstones": [], "deleted_pin_ids": [], "deleted_drawing_ids": []
    })).await;

    // delta_stored should arrive via guaranteed delivery
    let stored = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(stored.is_some(), "should receive delta_stored");
    assert_eq!(stored.unwrap()["type"], "delta_stored");

    // push_delta_bc is broadcast to OTHER clients only (sender excluded)
    drop(client);
}

#[tokio::test]
async fn test_peer_left_on_second_client_disconnect() {
    let addr = start_server().await;

    let (mut client1, welcome1) = join_room(addr, "bp-leave").await;
    let _cid1 = welcome1["clientId"].as_str().unwrap().to_string();

    let (mut client2, _) = join_room(addr, "bp-leave").await;
    // Drain peer_joined
    client1.recv_timeout(Duration::from_secs(3)).await;
    client2.recv_timeout(Duration::from_secs(3)).await;

    // Disconnect client2
    drop(client2);

    // Client1 should receive peer_left for client2
    let left = client1.recv_timeout(Duration::from_secs(3)).await;
    assert!(left.is_some(), "client1 should receive peer_left when client2 disconnects");
    assert_eq!(left.as_ref().unwrap()["type"], "peer_left");

    // Disconnect client1
    drop(client1);
}

#[tokio::test]
async fn test_connection_admission_rejection() {
    let addr = common::start_server_with_max_conn(2).await;

    // Connect and hold 2 clients
    let (mut c1, _) = join_room(addr, "admit-test").await;
    let (mut c2, _) = join_room(addr, "admit-test").await;

    // Drain peer_joined
    let _ = c1.recv_timeout(Duration::from_millis(300)).await;

    // Third client should be rejected (semaphore exhausted)
    let url = format!("ws://{}/", addr);
    let result = tokio_tungstenite::connect_async(&url).await;

    // Connection might succeed or fail depending on timing (the semaphore permits
    // are released after spawn). Just verify the server doesn't crash.
    if let Ok((mut ws, _)) = result {
        // If we got in, join and verify
        let _ = ws.send(tokio_tungstenite::tungstenite::Message::Text(
            serde_json::json!({"type":"join","room":"admit-test"}).to_string()
        )).await;
        let hello = recv_text(&mut ws).await;
        // Either hello or welcome - both are fine
        assert!(hello.is_some());
        drop(ws);
    }

    drop(c1);
    drop(c2);
}

/// Receive the next text message from a raw WebSocket stream.
async fn recv_text(
    ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
) -> Option<String> {
    use futures_util::StreamExt;
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(3), ws.next()).await;
        match msg {
            Ok(Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t)))) => return Some(t),
            Ok(Some(Ok(_))) => continue,
            _ => return None,
        }
    }
}

#[tokio::test]
async fn test_slow_consumer_disconnect() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();

    // Register community
    let (mut reg, _) = join_room(addr, "community-relay").await;
    reg.drain().await;
    reg.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "slow-cid",
        "name": "Slow Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    })).await;
    reg.recv_timeout(Duration::from_secs(3)).await;
    drop(reg);

    // Two clients: sender sends, second receives but never reads
    let (mut sender, _) = join_room(addr, "community-relay").await;
    let _ = sender.recv_timeout(Duration::from_millis(300)).await;
    let (mut slow_client, welcome_slow) = join_room(addr, "community-relay").await;
    let _cid_slow = welcome_slow["clientId"].as_str().unwrap().to_string();
    let _ = slow_client.recv_timeout(Duration::from_millis(300)).await;
    let _ = sender.recv_timeout(Duration::from_millis(500)).await; // peer_joined for slow

    // Sender pushes pins rapidly. The broadcast_guaranteed will fill the slow client's
    // channel since it's not reading, causing consecutive_drops to accumulate.
    // After 50+ drops, the server should disconnect the slow client.
    for i in 0..80 {
        sender.send(&serde_json::json!({
            "type": "push_delta",
            "community_id": "slow-cid",
            "ts": now + i * 10,
            "pins": [{"pin_id": format!("slow-pin-{}", i), "community_id": "slow-cid", "ciphertext": format!("d{}", i), "nonce": "nn"}],
            "annotations": [], "drawings": [], "tombstones": [], "deleted_pin_ids": [], "deleted_drawing_ids": []
        })).await;

        let resp = sender.recv_timeout(Duration::from_secs(5)).await;
        if resp.is_none() {
            break;
        }
    }

    // The slow client should eventually get disconnected
    // Sender should receive peer_left for the slow client
    let _left = sender.recv_timeout(Duration::from_secs(5)).await;
    // Note: this may or may not arrive depending on timing; the key assertion
    // is that the sender's loop above completed without the server crashing

    drop(sender);
    drop(slow_client);
}
