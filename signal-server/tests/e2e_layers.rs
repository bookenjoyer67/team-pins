mod common;
use common::*;

use tokio::time::Duration;

#[tokio::test]
async fn test_publish_layer_as_founder() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    let founder_pk = "00".repeat(32);
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "layer-cid-001",
        "name": "Layer Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": [{"pubkey": founder_pk, "display_name": "Founder", "role": "founder"}]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    // Publish layer — requires founder auth, will be rejected without auth
    client.send(&serde_json::json!({
        "type": "publish_layer",
        "community_id": "layer-cid-001",
        "layer_id": "layer-1",
        "name": "Public View",
        "topic_tags": ["nature"],
        "layer_dek_wrapped": "00".repeat(32)
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive response");
    let r = resp.unwrap();
    assert!(r["reason"].as_str().map_or(false, |s| s.contains("auth") || s.contains("founder")),
        "unauthenticated publish_layer should fail, got: {}", r);

    drop(client);
}

#[tokio::test]
async fn test_publish_layer_missing_fields_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "publish_layer",
        "community_id": "",
        "layer_id": "",
        "name": "",
        "topic_tags": [],
        "layer_dek_wrapped": ""
    })).await;

    let resp = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(resp.is_none(), "empty fields should be silently ignored");

    drop(client);
}

#[tokio::test]
async fn test_list_public_layers_empty() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "list_public_layers",
        "community_id": "nonexistent-cid"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive public_layers_list");
    let r = resp.unwrap();
    assert_eq!(r["type"], "public_layers_list");
    assert!(r["layers"].as_array().unwrap().is_empty());

    drop(client);
}

#[tokio::test]
async fn test_subscribe_layer_not_found_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "subscribe_layer",
        "community_id": "nonexistent",
        "layer_id": "nonexistent",
        "subscriber_pubkey": "pk"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive error for nonexistent layer");
    assert_eq!(resp.unwrap()["type"], "error");

    drop(client);
}

#[tokio::test]
async fn test_subscribe_layer_empty_fields_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "subscribe_layer",
        "community_id": "",
        "layer_id": "some",
        "subscriber_pubkey": ""
    })).await;

    let resp = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(resp.is_none(), "empty fields should be silently ignored");

    drop(client);
}

#[tokio::test]
async fn test_unsubscribe_layer_handles_unknown() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "unsubscribe_layer",
        "community_id": "nonexistent",
        "layer_id": "nonexistent",
        "subscriber_pubkey": "pk"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive response even for nonexistent");
    assert_eq!(resp.unwrap()["type"], "layer_unsubscribed");

    drop(client);
}

#[tokio::test]
async fn test_sync_subscribed_layers_empty() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "sync_subscribed_layers",
        "subscriber_pubkey": "no-subscriptions",
        "since": 0
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive response");
    let r = resp.unwrap();
    assert_eq!(r["type"], "subscribed_sync");
    assert!(r["pins"].as_array().unwrap().is_empty());
    assert!(r["drawings"].as_array().unwrap().is_empty());

    drop(client);
}
