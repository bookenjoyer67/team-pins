use tracing::{info, warn};

use crate::auth;
use crate::messages;
use crate::room::Room;
use crate::state::AppState;

pub mod auth_handler;
pub mod community;
pub mod community_list;
pub mod dek;
pub mod layer;
pub mod member;
#[cfg(feature = "mqtt-bridge")]
pub mod mesh;
pub mod push;
pub mod push_delta;
pub mod sync_request;
pub mod vote;

pub use auth_handler::handle_auth_response;
pub use community::{
    handle_delete_community, handle_join_community, handle_publish_community,
    handle_register_community, handle_unpublish_community,
};
pub use community_list::{handle_list_communities, handle_query_communities};
pub use dek::{handle_request_member_dek, handle_rewrap_member_dek};
pub use layer::{
    handle_list_public_layers, handle_publish_layer, handle_subscribe_layer,
    handle_sync_subscribed_layers, handle_unpublish_layer, handle_unsubscribe_layer,
};
pub use member::{
    handle_add_member, handle_claim_membership, handle_create_token, handle_remove_member,
    handle_update_governance,
};
pub use push::{handle_register_push_subscription, handle_unregister_push_subscription, handle_push_info};
#[cfg(feature = "mqtt-bridge")]
pub use mesh::{handle_mesh_uplink, handle_mesh_uplink_presence};
pub use push_delta::handle_push_delta;
pub use sync_request::handle_sync_request;
pub use vote::{handle_annotation_vote, handle_pin_vote};

pub struct HandlerContext<'a> {
    pub state: &'a AppState,
    pub room: &'a Room,
    pub cid: &'a str,
    pub ip: &'a str,
    pub conn_pubkey: Option<String>,
    pub room_name: &'a str,
}

impl<'a> HandlerContext<'a> {
    pub fn new(
        state: &'a AppState,
        room: &'a Room,
        cid: &'a str,
        ip: &'a str,
        room_name: &'a str,
    ) -> Self {
        let conn_pubkey = get_conn_pubkey(room, cid);
        Self { state, room, cid, ip, conn_pubkey, room_name }
    }
}

pub fn auth_err(msg: &str) -> String {
    messages::json_err(&format!("auth: {}", msg))
}

pub fn get_conn_pubkey(room: &Room, cid: &str) -> Option<String> {
    room.clients.get(cid).and_then(|c| c.pubkey.read().unwrap().clone())
}

pub fn is_founder(community: &crate::storage::CommunityConfig, pubkey: &str) -> bool {
    community.members.iter().any(|m| m.pubkey == pubkey && m.role == "founder")
}

pub fn is_member(community: &crate::storage::CommunityConfig, pubkey: &str) -> bool {
    community.members.iter().any(|m| m.pubkey == pubkey)
}

pub fn get_member_role(community: &crate::storage::CommunityConfig, pubkey: &str) -> Option<String> {
    community.members.iter()
        .find(|m| m.pubkey == pubkey)
        .map(|m| m.role.clone())
}

pub fn get_join_policy(gov: &serde_json::Value) -> String {
    gov.get("join_policy").and_then(|v| v.as_str()).unwrap_or("open").to_string()
}

pub fn verify_creation_attestation(pin: &serde_json::Value, pin_id: &str) -> bool {
    if let Some(attestations) = pin.get("attestations").and_then(|a| a.as_array()) {
        if attestations.is_empty() {
            return true;
        }
        for att in attestations {
            let att_type = att.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if att_type == "created" {
                let pubkey = att.get("pubkey").and_then(|p| p.as_str()).unwrap_or("");
                let sig = att.get("signature").and_then(|s| s.as_str()).unwrap_or("");
                let timestamp = att.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
                if pubkey.is_empty() || sig.is_empty() { continue; }
                let raw_payload = format!("{}|{}|{}", pin_id, "created", timestamp);
                let payload_hex = hex::encode(raw_payload.as_bytes());
                if auth::verify_signature(&payload_hex, sig, pubkey).unwrap_or(false) {
                    return true;
                }
                let old_payload = format!("{}{}{}", pin_id, "created", timestamp);
                let old_payload_hex = hex::encode(old_payload.as_bytes());
                if auth::verify_signature(&old_payload_hex, sig, pubkey).unwrap_or(false) {
                    return true;
                }
                if auth::verify_signature(pin_id, sig, pubkey).unwrap_or(false) {
                    return true;
                }
            }
        }
        warn!("[relay] push_delta: invalid creation attestation for pin {}", pin_id);
        return false;
    }
    true
}

/// Returns true if the message was fully handled. Returns false if it should
/// fall through to passthrough logic.
#[tracing::instrument(skip(ctx, txt), fields(cid = %ctx.cid))]
pub async fn route_message(
    ctx: &HandlerContext<'_>,
    txt: &str,
) -> bool {
    let v: serde_json::Value = match serde_json::from_str::<serde_json::Value>(txt) {
        Ok(v) if v.get("type").is_some() => v,
        _ => return false,
    };
    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    if ty != "pong" && ty != "ping" {
        info!("[relay] received msg type: {} from room: {}", ty, ctx.room_name);
    }

    match ty {
        "auth_response" if ctx.room_name == "community-relay" =>
            handle_auth_response(ctx, &v).await,

        #[cfg(feature = "mqtt-bridge")]
        "mesh_uplink" if ctx.room_name == "mesh" =>
            handle_mesh_uplink(ctx, &v).await,

        #[cfg(feature = "mqtt-bridge")]
        "mesh_uplink_position" | "mesh_uplink_presence" if ctx.room_name == "mesh" =>
            handle_mesh_uplink_presence(ctx, &v).await,

        "register_community" =>
            handle_register_community(ctx, &v).await,

        "publish_community" =>
            handle_publish_community(ctx, &v).await,

        "unpublish_community" =>
            handle_unpublish_community(ctx, &v).await,

        "delete_community" =>
            handle_delete_community(ctx, &v).await,

        "add_member" if ctx.room_name == "community-relay" =>
            handle_add_member(ctx, &v).await,

        "remove_member" if ctx.room_name == "community-relay" =>
            handle_remove_member(ctx, &v).await,

        "create_token" if ctx.room_name == "community-relay" =>
            handle_create_token(ctx, &v).await,

        "claim_membership" if ctx.room_name == "community-relay" =>
            handle_claim_membership(ctx, &v).await,

        "update_governance" if ctx.room_name == "community-relay" =>
            handle_update_governance(ctx, &v).await,

        "pin_vote" =>
            handle_pin_vote(ctx, &v).await,

        "annotation_vote" =>
            handle_annotation_vote(ctx, &v, txt).await,

        "push_delta" =>
            handle_push_delta(ctx, &v).await,

        "sync_request" =>
            handle_sync_request(ctx, &v).await,

        "list_communities" if ctx.room_name == "community-relay" =>
            handle_list_communities(ctx, &v).await,

        "query_communities" if ctx.room_name == "community-relay" =>
            handle_query_communities(ctx, &v).await,

        "publish_layer" if ctx.room_name == "community-relay" =>
            handle_publish_layer(ctx, &v).await,

        "unpublish_layer" if ctx.room_name == "community-relay" =>
            handle_unpublish_layer(ctx, &v).await,

        "list_public_layers" if ctx.room_name == "community-relay" =>
            handle_list_public_layers(ctx, &v).await,

        "subscribe_layer" if ctx.room_name == "community-relay" =>
            handle_subscribe_layer(ctx, &v).await,

        "unsubscribe_layer" if ctx.room_name == "community-relay" =>
            handle_unsubscribe_layer(ctx, &v).await,

        "sync_subscribed_layers" if ctx.room_name == "community-relay" =>
            handle_sync_subscribed_layers(ctx, &v).await,

        "request_member_dek" =>
            handle_request_member_dek(ctx, &v).await,

        "rewrap_member_dek" =>
            handle_rewrap_member_dek(ctx, &v).await,

        "join_community" =>
            handle_join_community(ctx, &v).await,

        "register_push_subscription" if ctx.room_name == "community-relay" =>
            handle_register_push_subscription(ctx, &v).await,

        "unregister_push_subscription" if ctx.room_name == "community-relay" =>
            handle_unregister_push_subscription(ctx, &v).await,

        "push_info" =>
            handle_push_info(ctx, &v).await,

        _ => return false,
    }
    true
}

/// Passthrough types that should be rebroadcast to room if not handled by relay
pub fn is_passthrough(ty: &str) -> bool {
    matches!(ty, "push_delta" | "sync_request" | "sync_response" | "relay_hello" |
        "relay_announce" | "mesh_uplink" | "mesh_downlink" | "gossip_capabilities" |
        "gossip_query" | "gossip_announce" | "pin_vote" | "annotation_vote" |
        "request_member_dek" | "rewrap_member_dek" | "offer" | "answer")
}

#[cfg(test)]
mod tests {
    use crate::storage::{CommunityConfig, MemberRecord};

    use super::*;

    fn test_community(members: Vec<MemberRecord>) -> CommunityConfig {
        CommunityConfig {
            community_id: "test-cid".into(),
            name: "Test".into(),
            genesis_public_key: "".into(),
            public_key: "".into(),
            secret_key: "".into(),
            wrapped_dek: "".into(),
            key_derivation: "".into(),
            published: false,
            visibility: "public".into(),
            description: "".into(),
            owner_pubkey: "".into(),
            members,
            governance: serde_json::json!({}),
            bounds: None,
            password_hash: None,
            join_wrapped_dek: None,
            used_token_nonces: vec![],
        }
    }

    #[test]
    fn test_is_founder_detects_founder() {
        let c = test_community(vec![
            MemberRecord { pubkey: "pk1".into(), display_name: "A".into(), role: "founder".into() },
            MemberRecord { pubkey: "pk2".into(), display_name: "B".into(), role: "contributor".into() },
        ]);
        assert!(is_founder(&c, "pk1"));
    }

    #[test]
    fn test_is_founder_rejects_contributor() {
        let c = test_community(vec![
            MemberRecord { pubkey: "pk1".into(), display_name: "A".into(), role: "contributor".into() },
        ]);
        assert!(!is_founder(&c, "pk1"));
    }

    #[test]
    fn test_is_founder_empty_members() {
        let c = test_community(vec![]);
        assert!(!is_founder(&c, "pk1"));
    }

    #[test]
    fn test_is_member_found() {
        let c = test_community(vec![
            MemberRecord { pubkey: "pk1".into(), display_name: "A".into(), role: "founder".into() },
        ]);
        assert!(is_member(&c, "pk1"));
    }

    #[test]
    fn test_is_member_not_found() {
        let c = test_community(vec![
            MemberRecord { pubkey: "pk1".into(), display_name: "A".into(), role: "founder".into() },
        ]);
        assert!(!is_member(&c, "pk2"));
    }

    #[test]
    fn test_get_member_role_returns_correct() {
        let c = test_community(vec![
            MemberRecord { pubkey: "pk1".into(), display_name: "A".into(), role: "founder".into() },
            MemberRecord { pubkey: "pk2".into(), display_name: "B".into(), role: "contributor".into() },
            MemberRecord { pubkey: "pk3".into(), display_name: "C".into(), role: "reader".into() },
        ]);
        assert_eq!(get_member_role(&c, "pk1"), Some("founder".into()));
        assert_eq!(get_member_role(&c, "pk2"), Some("contributor".into()));
        assert_eq!(get_member_role(&c, "pk3"), Some("reader".into()));
    }

    #[test]
    fn test_get_member_role_none_for_stranger() {
        let c = test_community(vec![]);
        assert_eq!(get_member_role(&c, "pk1"), None);
    }

    #[test]
    fn test_get_join_policy_open_default() {
        assert_eq!(get_join_policy(&serde_json::json!({})), "open");
    }

    #[test]
    fn test_get_join_policy_invite() {
        let gov = serde_json::json!({"join_policy": "invite"});
        assert_eq!(get_join_policy(&gov), "invite");
    }

    #[test]
    fn test_get_join_policy_null_governance() {
        assert_eq!(get_join_policy(&serde_json::Value::Null), "open");
    }

    #[test]
    fn test_auth_err_produces_valid_json() {
        let s = auth_err("bad stuff");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["type"], "error");
        assert!(v["reason"].as_str().unwrap().contains("auth:"));
    }

    #[test]
    fn test_verify_creation_attestation_empty_array() {
        let pin = serde_json::json!({"attestations": []});
        assert!(verify_creation_attestation(&pin, "pin-1"));
    }

    #[test]
    fn test_verify_creation_attestation_no_field() {
        let pin = serde_json::json!({"pin_id": "pin-1"});
        assert!(verify_creation_attestation(&pin, "pin-1"));
    }

    #[test]
    fn test_verify_creation_attestation_invalid_sig() {
        let pin = serde_json::json!({
            "attestations": [{
                "type": "created",
                "pubkey": "00".repeat(32),
                "signature": "ff".repeat(64),
                "timestamp": 1000
            }]
        });
        assert!(!verify_creation_attestation(&pin, "pin-1"));
    }

    #[test]
    fn test_verify_creation_attestation_valid_sig() {
        use ed25519_dalek::{SigningKey, Signer};
        use sha2::{Sha512, Digest};

        let seed = [42u8; 32];
        let hash = Sha512::digest(seed);
        let sk = SigningKey::from_bytes(&hash[..32].try_into().unwrap());
        let vk = sk.verifying_key();
        let pk_hex = hex::encode(vk.to_bytes());

        let pin_id = "pin-valid";
        let timestamp = 1000u64;
        let raw = format!("{}|{}|{}", pin_id, "created", timestamp);
        let _payload_hex = hex::encode(raw.as_bytes());
        let sig = sk.sign(raw.as_bytes()); // sign raw bytes, not hex-encoded
        let sig_hex = hex::encode(sig.to_bytes());

        let pin = serde_json::json!({
            "attestations": [{
                "type": "created",
                "pubkey": pk_hex,
                "signature": sig_hex,
                "timestamp": timestamp
            }]
        });
        assert!(verify_creation_attestation(&pin, pin_id));
    }

    #[test]
    fn test_is_passthrough_recognized_types() {
        assert!(is_passthrough("gossip_capabilities"));
        assert!(is_passthrough("offer"));
        assert!(is_passthrough("answer"));
        assert!(is_passthrough("sync_response"));
    }

    #[test]
    fn test_is_passthrough_rejects_unknown() {
        assert!(!is_passthrough("unknown_type"));
        assert!(!is_passthrough("ping"));
    }
}
