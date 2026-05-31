mod common;
use common::*;

use tokio::time::Duration;

#[tokio::test]
async fn test_add_member_as_founder() {
    let addr = start_server().await;
    let now = piggpin_signal::messages::unix_millis();

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    let founder_pk = "00".repeat(32);
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "member-cid-001",
        "name": "Member Test",
        "description": "",
        "public_key": founder_pk.clone(),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {},
        "members": [{"pubkey": founder_pk, "display_name": "Founder", "role": "founder"}]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    // First authenticate as founder by setting pubkey on the client
    // We can't do Ed25519 auth without the server challenge, but we can test
    // that add_member without auth is rejected
    client.send(&serde_json::json!({
        "type": "add_member",
        "community_id": "member-cid-001",
        "pubkey": "new-member-pk",
        "display_name": "Newbie",
        "role": "contributor",
        "signature": "00".repeat(128),
        "timestamp": now + 1
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive response");
    // Without auth, add_member should be rejected
    let r = resp.unwrap();
    assert!(r["type"] == "error" || r["reason"].as_str().map_or(false, |s| s.contains("auth") || s.contains("required")),
        "unauthenticated add_member should fail, got: {}", r);

    drop(client);
}

#[tokio::test]
async fn test_add_member_missing_fields_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    // Send add_member with empty community_id — should be silently ignored
    client.send(&serde_json::json!({
        "type": "add_member",
        "community_id": "",
        "pubkey": "pk",
        "display_name": "X",
        "role": "contributor",
        "timestamp": 1000
    })).await;

    let resp = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(resp.is_none(), "empty cid should be silently ignored, got: {:?}", resp);

    drop(client);
}

#[tokio::test]
async fn test_remove_member_empty_target_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    client.send(&serde_json::json!({
        "type": "remove_member",
        "community_id": "some-cid",
        "pubkey": "",
        "timestamp": 1000
    })).await;

    let resp = client.recv_timeout(Duration::from_millis(500)).await;
    assert!(resp.is_none(), "empty target should be ignored");

    drop(client);
}

#[tokio::test]
async fn test_create_token_invalid_signature_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    let founder_pk = "00".repeat(32);
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "token-cid",
        "name": "Token Test",
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
        "type": "create_token",
        "community_id": "token-cid",
        "nonce": "nonce-1",
        "role": "contributor",
        "expiry": 0,
        "max_uses": 1,
        "signature": "bad-sig"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive response");
    let r = resp.unwrap();
    assert!(r["type"] == "error" || r["reason"].as_str().map_or(false, |s| s.contains("auth") || s.contains("invalid")),
        "bad sig should be rejected, got: {}", r);

    drop(client);
}

#[tokio::test]
async fn test_claim_membership_invalid_capability_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    let founder_pk = "00".repeat(32);
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "claim-cid",
        "name": "Claim Test",
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
        "type": "claim_membership",
        "community_id": "claim-cid",
        "member_pubkey": "new-pk",
        "member_name": "New",
        "nonce": "nonce-1",
        "capability_signature": "ff".repeat(128)
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive claim_denied");
    assert_eq!(resp.unwrap()["type"], "claim_denied");

    drop(client);
}

#[tokio::test]
async fn test_update_governance_unauthenticated_rejected() {
    let addr = start_server().await;

    let (mut client, _) = join_room(addr, "community-relay").await;
    client.drain().await;

    let founder_pk = "00".repeat(32);
    client.send(&serde_json::json!({
        "type": "register_community",
        "community_id": "gov-cid",
        "name": "Gov Test",
        "description": "",
        "public_key": "00".repeat(32),
        "wrapped_dek": "00".repeat(32),
        "key_derivation": "random",
        "genesis_public_key": "00".repeat(32),
        "governance": {"join_policy": "open"},
        "members": [{"pubkey": founder_pk, "display_name": "Founder", "role": "founder"}]
    })).await;
    client.recv_timeout(Duration::from_secs(3)).await;

    client.send(&serde_json::json!({
        "type": "update_governance",
        "community_id": "gov-cid",
        "governance": {"join_policy": "invite"},
        "signature": "bad"
    })).await;

    let resp = client.recv_timeout(Duration::from_secs(3)).await;
    assert!(resp.is_some(), "should receive error");
    let r = resp.unwrap();
    assert!(r["reason"].as_str().map_or(false, |s| s.contains("auth")),
        "unauthenticated update_governance should fail, got: {}", r);

    drop(client);
}
