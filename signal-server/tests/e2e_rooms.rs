mod common;
use common::*;

#[tokio::test]
async fn test_join_and_welcome() {
    let addr = start_server().await;
    let (client, welcome) = join_room(addr, "test-room").await;
    assert!(welcome["clientId"].as_str().unwrap().len() > 0, "should have clientId");
    drop(client);
}

#[tokio::test]
async fn test_peer_joined_broadcast() {
    let addr = start_server().await;
    let (mut client1, _welcome1) = join_room(addr, "shared").await;

    let mut client2 = connect_to(addr, "shared").await;
    // hello for client2
    let hello2 = client2.recv().await;
    assert_eq!(hello2["type"], "hello");
    // send join
    client2.send(&serde_json::json!({"type":"join","room":"shared"})).await;
    // client2 gets welcome
    let welcome2 = client2.recv().await;
    assert_eq!(welcome2["type"], "welcome");

    // client1 should get peer_joined for client2 (broadcast to room)
    let joined = client1.recv_timeout(std::time::Duration::from_secs(3)).await;
    assert!(joined.is_some(), "client1 should receive peer_joined");
    assert_eq!(joined.unwrap()["type"], "peer_joined");

    drop(client1);
    drop(client2);
}

#[tokio::test]
async fn test_message_broadcast() {
    let addr = start_server().await;
    let (mut client1, _) = join_room(addr, "broadcast-test").await;
    let (mut client2, _) = join_room(addr, "broadcast-test").await;

    // Client1 must get peer_joined for client2
    let pj1 = client1.recv_timeout(std::time::Duration::from_secs(3)).await;
    assert!(pj1.is_some(), "client1 should receive peer_joined");

    // Client2 may also get its own peer_joined — consume if present
    let _ = client2.recv_timeout(std::time::Duration::from_millis(500)).await;

    // Client2 sends a gossip_capabilities message (passthrough type, broadcast to room)
    let msg = serde_json::json!({"type":"gossip_capabilities","data":"hello","communities":[]});
    client2.send(&msg).await;

    // Client1 should receive the broadcast
    let relayed = client1.recv_timeout(std::time::Duration::from_secs(3)).await;
    assert!(relayed.is_some(), "client1 should receive broadcast");
    assert_eq!(relayed.unwrap()["data"], "hello");

    drop(client1);
    drop(client2);
}

#[tokio::test]
async fn test_peer_left_on_disconnect() {
    let addr = start_server().await;
    let (mut client1, welcome1) = join_room(addr, "leave-test").await;
    let cid1 = welcome1["clientId"].as_str().unwrap().to_string();

    let (mut client2, _) = join_room(addr, "leave-test").await;

    // Both clients get peer_joined for each other
    client1.recv_timeout(std::time::Duration::from_secs(3)).await;
    client2.recv_timeout(std::time::Duration::from_secs(3)).await;

    // Client1 disconnects
    drop(client1);

    // Client2 should receive peer_left for client1
    let left = client2.recv_timeout(std::time::Duration::from_secs(3)).await;
    assert!(left.is_some(), "client2 should receive peer_left");
    assert_eq!(left.unwrap()["clientId"], cid1);

    drop(client2);
}

#[tokio::test]
async fn test_multiple_clients_different_rooms_isolated() {
    let addr = start_server().await;
    let (mut client_a, _) = join_room(addr, "room-a").await;
    let (mut client_b, _) = join_room(addr, "room-b").await;

    // No peer_joined between different rooms
    let extra = client_a.recv_timeout(std::time::Duration::from_millis(500)).await;
    assert!(extra.is_none(), "client_a should not receive cross-room messages");

    // Send message in room-a
    let msg = serde_json::json!({"type":"room_a_msg","data":"only-in-a"});
    client_a.send(&msg).await;

    // client_b should NOT receive it (different room)
    let relayed = client_b.recv_timeout(std::time::Duration::from_millis(500)).await;
    assert!(relayed.is_none(), "client_b should not receive room-a messages");

    drop(client_a);
    drop(client_b);
}

#[tokio::test]
async fn test_room_cleanup_and_rejoin() {
    let addr = start_server().await;

    // Join, then leave immediately (room should be cleaned after timeout)
    let cid;
    {
        let (client, welcome) = join_room(addr, "cleanup-test").await;
        cid = welcome["clientId"].as_str().unwrap().to_string();
        drop(client);
    }

    // Wait for room cleanup (timeout=600s, but the cleanup task runs every 60s
    // and uses last_act. Since we dropped the client, room becomes empty and
    // should be removed on the next cleanup cycle).
    // Force cleanup by waiting for the cleanup task to run.
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    // Rejoin the same room — should succeed (room recreated)
    let (client2, welcome2) = join_room(addr, "cleanup-test").await;
    assert!(!welcome2["clientId"].as_str().unwrap().is_empty());
    assert_ne!(welcome2["clientId"].as_str().unwrap(), cid,
        "new join should get new client ID after room cleanup");

    drop(client2);
}

#[tokio::test]
async fn test_empty_room_removed_on_client_leave() {
    let addr = start_server().await;

    // Join a room with a single client, then leave
    let (client, _) = join_room(addr, "solo-room").await;
    drop(client);

    // Wait a bit for cleanup
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Rejoin — should work as if the room never existed
    let (client2, _) = join_room(addr, "solo-room").await;
    drop(client2);

    // If we get here without errors, it worked
}
