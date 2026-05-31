mod common;
use common::*;

use tokio::time::Duration;

#[tokio::test]
async fn test_join_community_password_protected_correct() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    // Register with password hash
    let pw = "correct-horse";
    let pw_hash = piggpin_signal::messages::hash_password(pw);
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "pw-cid-001",
        "name": "Password Community",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": [],
        "password_hash": pw_hash
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    // Join with correct hash
    client.send(&serde_json::json!({
        "type": "join_community",
        "community_id": "pw-cid-001",
        "request_id": "req-1",
        "password_hash": pw_hash
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive community_joined");
    let r = resp.unwrap();
    assert_eq!(r["type"], "community_joined");
    assert_eq!(r["community_id"], "pw-cid-001");

    drop(client);
}

#[tokio::test]
async fn test_join_community_wrong_password_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    // Register with password hash
    let pw = "correct-horse";
    let pw_hash = piggpin_signal::messages::hash_password(pw);
    let wrong_hash = piggpin_signal::messages::hash_password("wrong");

    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "pw-cid-002",
        "name": "Bad Pw",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": [],
        "password_hash": pw_hash
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    client.send(&serde_json::json!({
        "type": "join_community",
        "community_id": "pw-cid-002",
        "request_id": "req-1",
        "password_hash": wrong_hash
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive community_joined with error");
    let r = resp.unwrap();
    assert_eq!(r["type"], "community_joined");
    assert_eq!(r["error"], "wrong_password");

    drop(client);
}

#[tokio::test]
async fn test_list_communities_only_published() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    // Register unpublished
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "unpub-cid",
        "name": "Unpublished",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": []
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    // Register published
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "pub-cid",
        "name": "Published",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": [],
        "published": true
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    client.send(&serde_json::json!({
        "type": "list_communities"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive community_list");
    let r = resp.unwrap();
    assert_eq!(r["type"], "community_list");
    let comms = r["communities"].as_array().unwrap();
    assert!(comms.iter().any(|c| c["community_id"] == "pub-cid"), "published community should be listed");
    assert!(!comms.iter().any(|c| c["community_id"] == "unpub-cid"), "unpublished community should NOT be listed");

    drop(client);
}

#[tokio::test]
async fn test_publish_community_unauthenticated_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    let founder_pk = "00".repeat(32);
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "pub-auth-cid",
        "name": "Pub Auth",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": [{"pubkey": founder_pk, "display_name": "Founder", "role": "founder"}]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    // Publish without auth — should be rejected
    client.send(&serde_json::json!({
        "type": "publish_community",
        "community_id": "pub-auth-cid"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive error");
    let r = resp.unwrap();
    assert!(r["reason"].as_str().map_or(false, |s| s.contains("founder")),
        "non-founder should be rejected, got: {}", r);

    drop(client);
}

#[tokio::test]
async fn test_delete_community_unauthorized_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "del-cid",
        "name": "Delete Me",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": [],
        "owner_pubkey": "some-owner-pk"
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    client.send(&serde_json::json!({
        "type": "delete_community",
        "community_id": "del-cid"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive error");
    let r = resp.unwrap();
    assert!(r["reason"].as_str().map_or(false, |s| s == "unauthorized"),
        "non-owner should be rejected, got: {}", r);

    drop(client);
}
