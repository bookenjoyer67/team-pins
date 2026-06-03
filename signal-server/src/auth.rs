use hex;
use ed25519_dalek::{VerifyingKey, Signature, Verifier};

pub fn verify_signature(payload: &str, signature_hex: &str, public_key_hex: &str) -> Result<bool, String> {
    let pk_bytes = hex::decode(public_key_hex).map_err(|e| format!("invalid pubkey hex: {}", e))?;
    let sig_bytes = hex::decode(signature_hex).map_err(|e| format!("invalid sig hex: {}", e))?;
    let payload_bytes = hex::decode(payload).map_err(|e| format!("invalid payload hex: {}", e))?;

    let pk_arr: [u8; 32] = pk_bytes.as_slice().try_into().map_err(|_| "pubkey must be 32 bytes".to_string())?;
    let sig_arr: [u8; 64] = sig_bytes.as_slice().try_into().map_err(|_| "signature must be 64 bytes".to_string())?;

    let vk = VerifyingKey::from_bytes(&pk_arr).map_err(|e| format!("invalid verifying key: {}", e))?;
    let sig = Signature::from_bytes(&sig_arr);

    Ok(vk.verify(&payload_bytes, &sig).is_ok())
}

pub fn verify_membership(community: &crate::storage::CommunityConfig, pubkey: &str) -> bool {
    community.members.iter().any(|m| m.pubkey == pubkey)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{SigningKey, Signer};

    fn make_keypair(seed: u8) -> (SigningKey, VerifyingKey) {
        let bytes = [seed; 32];
        // Hash the seed bytes to produce a valid scalar
        use sha2::{Sha512, Digest};
        let hash = Sha512::digest(bytes);
        let sk = SigningKey::from_bytes(&hash[..32].try_into().unwrap());
        let vk = sk.verifying_key();
        (sk, vk)
    }

    #[test]
    fn test_verify_signature_roundtrip() {
        let (sk, vk) = make_keypair(1);
        let pk_hex = hex::encode(vk.to_bytes());
        let message = "hello world test payload";
        let payload_hex = hex::encode(message.as_bytes());
        let sig = sk.sign(message.as_bytes());
        let sig_hex = hex::encode(sig.to_bytes());

        let result = verify_signature(&payload_hex, &sig_hex, &pk_hex);
        assert_eq!(result, Ok(true), "valid signature should verify: {:?}", result);
    }

    #[test]
    fn test_verify_signature_tampered_message() {
        let (sk, vk) = make_keypair(2);
        let pk_hex = hex::encode(vk.to_bytes());
        let message = "original message";
        let _payload_hex = hex::encode(message.as_bytes());
        let sig = sk.sign(message.as_bytes());
        let sig_hex = hex::encode(sig.to_bytes());

        let tampered_hex = hex::encode("tampered message".as_bytes());
        let result = verify_signature(&tampered_hex, &sig_hex, &pk_hex);
        assert_eq!(result, Ok(false), "tampered message should not verify");
    }

    #[test]
    fn test_verify_signature_wrong_key() {
        let (sk1, _) = make_keypair(3);
        let (_, vk2) = make_keypair(4);

        let pk_hex = hex::encode(vk2.to_bytes());
        let message = "test message";
        let payload_hex = hex::encode(message.as_bytes());
        let sig = sk1.sign(message.as_bytes());
        let sig_hex = hex::encode(sig.to_bytes());

        let result = verify_signature(&payload_hex, &sig_hex, &pk_hex);
        assert_eq!(result, Ok(false), "wrong key signature should not verify");
    }

    #[test]
    fn test_verify_signature_invalid_hex() {
        assert!(verify_signature("not-hex", "aa", "bb").is_err());
        assert!(verify_signature("deadbeef", "not-hex", "aa").is_err());
    }

    #[test]
    fn test_verify_membership_found() {
        let c = crate::storage::CommunityConfig {
            community_id: "test".into(),
            name: "test".into(),
            genesis_public_key: "".into(),
            public_key: "".into(),
            secret_key: "".into(),
            wrapped_dek: "".into(),
            key_derivation: "".into(),
            published: false,
            visibility: "public".into(),
            description: "".into(),
            owner_pubkey: "".into(),
            members: vec![crate::storage::MemberRecord {
                pubkey: "abc123".into(),
                display_name: "Alice".into(),
                role: "founder".into(),
            }],
            governance: serde_json::json!({}),
            bounds: None,
            password_hash: None,
            join_wrapped_dek: None,
            used_token_nonces: vec![],
        };
        assert!(verify_membership(&c, "abc123"));
    }

    #[test]
    fn test_verify_membership_not_found() {
        let c = crate::storage::CommunityConfig {
            community_id: "test".into(),
            name: "test".into(),
            genesis_public_key: "".into(),
            public_key: "".into(),
            secret_key: "".into(),
            wrapped_dek: "".into(),
            key_derivation: "".into(),
            published: false,
            visibility: "public".into(),
            description: "".into(),
            owner_pubkey: "".into(),
            members: vec![],
            governance: serde_json::json!({}),
            bounds: None,
            password_hash: None,
            join_wrapped_dek: None,
            used_token_nonces: vec![],
        };
        assert!(!verify_membership(&c, "not-a-member"));
    }
}
