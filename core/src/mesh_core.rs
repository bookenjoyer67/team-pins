use wasm_bindgen::prelude::*;
use rns_core::hash::create_hash;
use rns_core::identity::Identity;

/// Generate a new Reticulum Identity from random key material.
/// Returns hex-encoded identity string.
#[wasm_bindgen]
pub fn reticulum_generate_identity() -> String {
    let mut seed = [0u8; 64];
    getrandom::getrandom(&mut seed).ok();
    let pk = &seed[..32];
    let vk = &seed[32..];
    Identity::new_from_slices(pk, vk).to_hex_string()
}

/// Get the 32-character hex address for an identity.
#[wasm_bindgen]
pub fn reticulum_address(identity_hex: &str) -> String {
    match Identity::new_from_hex_string(identity_hex) {
        Ok(id) => id.address_hash.to_hex_string(),
        Err(_) => String::new(),
    }
}

/// Hash arbitrary data, producing a hex-encoded SHA-256 hash.
#[wasm_bindgen]
pub fn reticulum_hash_data(data: &[u8]) -> String {
    let mut buf = [0u8; 32];
    create_hash(data, &mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}
