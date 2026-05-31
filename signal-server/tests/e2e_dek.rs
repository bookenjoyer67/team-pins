mod common;
use common::*;

use tokio::time::Duration;

#[tokio::test]
async fn test_request_member_dek() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    let founder_pk = "00".repeat(32);
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "dek-cid-001",
        "name": "DEK Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": [{"pubkey": founder_pk, "display_name": "Founder", "role": "founder"}]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    client.send(&serde_json::json!({
        "type": "request_member_dek",
        "community_id": "dek-cid-001",
        "member_pubkey": "new-member-pk"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive member_dek_requested");
    let r = resp.unwrap();
    assert_eq!(r["type"], "member_dek_requested");
    assert_eq!(r["community_id"], "dek-cid-001");

    drop(client);
}

#[tokio::test]
async fn test_request_member_dek_empty_fields_ignored() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "request_member_dek",
        "community_id": "",
        "member_pubkey": ""
    })).await;

    let resp = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(resp.is_none(), "empty fields should be silently ignored");

    drop(client);
}

#[tokio::test]
async fn test_rewrap_member_dek_empty_fields_ignored() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "rewrap_member_dek",
        "community_id": "",
        "target_pubkey": "",
        "rewrap_dek": ""
    })).await;

    let resp = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(resp.is_none(), "empty fields should be silently ignored");

    drop(client);
}
