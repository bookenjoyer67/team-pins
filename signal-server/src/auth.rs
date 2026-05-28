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
