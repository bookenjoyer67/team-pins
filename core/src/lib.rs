use wasm_bindgen::prelude::*;
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use chacha20poly1305::aead::{Aead, OsRng};
use rand::RngCore;
use serde::{Serialize, Deserialize};
use x25519_dalek::{PublicKey, StaticSecret};
use hkdf::Hkdf;
use sha2::Sha256;
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
struct KeyPair {
    public: Vec<u8>,
    secret: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct EncryptedData {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

#[derive(Serialize)]
struct EncryptedOutput {
    ciphertext: String,
    nonce: String,
}

#[derive(Serialize, Deserialize)]
struct PinOutput {
    title: String,
    note: String,
    lat: f64,
    lng: f64,
}

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

// ---- hex encoding ----
#[wasm_bindgen]
pub fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[wasm_bindgen]
pub fn decode_hex(hex: &str) -> Vec<u8> {
    let s = hex.trim_start_matches("\\x");
    (0..s.len())
        .step_by(2)
        .filter_map(|i| u8::from_str_radix(&s[i..std::cmp::min(i+2, s.len())], 16).ok())
        .collect()
}

// ---- UUID ----
#[wasm_bindgen]
pub fn generate_uuid() -> String {
    Uuid::new_v4().to_string()
}

#[wasm_bindgen]
pub fn generate_token() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    encode_hex(&bytes)
}

// ---- Key generation ----
#[wasm_bindgen]
pub fn generate_user_keypair() -> JsValue {
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    let kp = KeyPair {
        public: public.as_bytes().to_vec(),
        secret: secret.to_bytes().to_vec(),
    };
    serde_wasm_bindgen::to_value(&kp).unwrap()
}

#[wasm_bindgen]
pub fn generate_dek() -> Vec<u8> {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key.to_vec()
}

// ---- ECIES (for wrapping DEKs) ----
fn ecies_seal(plaintext: &[u8], recipient_pub: &PublicKey) -> Result<Vec<u8>, JsError> {
    let ephemeral_sk = StaticSecret::random_from_rng(OsRng);
    let ephemeral_pk = PublicKey::from(&ephemeral_sk);
    let dh_shared = ephemeral_sk.diffie_hellman(recipient_pub);
    let okm = derive_ecies_key(dh_shared.as_bytes())?;
    let cipher = ChaCha20Poly1305::new_from_slice(&okm).map_err(js_err)?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plaintext).map_err(js_err)?;
    let mut sealed = Vec::new();
    sealed.extend_from_slice(ephemeral_pk.as_bytes());
    sealed.extend_from_slice(&nonce_bytes);
    sealed.extend_from_slice(&ct);
    Ok(sealed)
}

fn ecies_open(sealed: &[u8], recipient_sk: &StaticSecret) -> Result<Vec<u8>, JsError> {
    if sealed.len() < 32+12+16 { return Err(js_err("invalid sealed data")); }
    let ephemeral_pk_bytes: [u8; 32] = sealed[..32].try_into().unwrap();
    let nonce_bytes: [u8; 12] = sealed[32..44].try_into().unwrap();
    let ct = &sealed[44..];
    let ephemeral_pk = PublicKey::from(ephemeral_pk_bytes);
    let dh_shared = recipient_sk.diffie_hellman(&ephemeral_pk);
    let okm = derive_ecies_key(dh_shared.as_bytes())?;
    let cipher = ChaCha20Poly1305::new_from_slice(&okm).map_err(js_err)?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plain = cipher.decrypt(nonce, ct).map_err(js_err)?;
    Ok(plain)
}

fn derive_ecies_key(dh_bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    let hk = Hkdf::<Sha256>::new(None, dh_bytes);
    let mut okm = [0u8; 32];
    hk.expand(b"ecies-v1", &mut okm).map_err(js_err)?;
    Ok(okm.to_vec())
}

// ---- DEK wrapping (all-in-one: takes hex keys, returns hex) ----
#[wasm_bindgen]
pub fn wrap_dek(dek: &[u8], public_key_hex: &str) -> Result<String, JsError> {
    let pk_bytes = decode_hex(public_key_hex);
    let pk = PublicKey::from(<[u8; 32]>::try_from(pk_bytes.as_slice()).map_err(js_err)?);
    let sealed = ecies_seal(dek, &pk)?;
    Ok(format!("\\x{}", encode_hex(&sealed)))
}

#[wasm_bindgen]
pub fn unwrap_dek(wrapped_hex: &str, secret_key_hex: &str) -> Result<Vec<u8>, JsError> {
    let sealed = decode_hex(wrapped_hex);
    let sk_bytes = decode_hex(secret_key_hex);
    let sk = StaticSecret::from(<[u8; 32]>::try_from(sk_bytes.as_slice()).map_err(js_err)?);
    ecies_open(&sealed, &sk)
}

// ---- Legacy raw-byte API (kept for compatibility) ----
#[wasm_bindgen]
pub fn seal_dek(dek: &[u8], recipient_public_key: &[u8]) -> Result<Vec<u8>, JsError> {
    let pk = PublicKey::from(<[u8; 32]>::try_from(recipient_public_key).map_err(js_err)?);
    ecies_seal(dek, &pk)
}

#[wasm_bindgen]
pub fn open_dek(sealed: &[u8], recipient_private_key: &[u8]) -> Result<Vec<u8>, JsError> {
    let sk = StaticSecret::from(<[u8; 32]>::try_from(recipient_private_key).map_err(js_err)?);
    ecies_open(sealed, &sk)
}

// ---- Pin encrypt/decrypt (takes structured data, returns hex) ----
#[wasm_bindgen]
pub fn encrypt_pin_data(title: &str, note: &str, lat: f64, lng: f64, dek: &[u8]) -> Result<JsValue, JsError> {
    let pin_json = serde_json::json!({
        "title": title,
        "note": note,
        "lat": lat,
        "lng": lng,
    });
    let plain = pin_json.to_string();
    let encrypted = encrypt_bytes(plain.as_bytes(), dek)?;
    let result = EncryptedOutput {
        ciphertext: format!("\\x{}", encode_hex(&encrypted.ciphertext)),
        nonce: format!("\\x{}", encode_hex(&encrypted.nonce)),
    };
    Ok(serde_wasm_bindgen::to_value(&result).unwrap())
}

#[wasm_bindgen]
pub fn decrypt_pin_data(ciphertext_hex: &str, nonce_hex: &str, dek: &[u8]) -> Result<JsValue, JsError> {
    let ciphertext = decode_hex(ciphertext_hex);
    let nonce = decode_hex(nonce_hex);
    let plain = decrypt_bytes(&ciphertext, &nonce, dek)?;
    let s = String::from_utf8(plain).map_err(js_err)?;
    let v: PinOutput = serde_json::from_str(&s).map_err(js_err)?;
    Ok(serde_wasm_bindgen::to_value(&v).unwrap())
}

// ---- GeoJSON encrypt/decrypt (takes string, returns hex) ----
#[wasm_bindgen]
pub fn encrypt_geojson(geojson_str: &str, dek: &[u8]) -> Result<JsValue, JsError> {
    let encrypted = encrypt_bytes(geojson_str.as_bytes(), dek)?;
    let result = EncryptedOutput {
        ciphertext: format!("\\x{}", encode_hex(&encrypted.ciphertext)),
        nonce: format!("\\x{}", encode_hex(&encrypted.nonce)),
    };
    Ok(serde_wasm_bindgen::to_value(&result).unwrap())
}

#[wasm_bindgen]
pub fn decrypt_geojson(ciphertext_hex: &str, nonce_hex: &str, dek: &[u8]) -> Result<String, JsError> {
    let ciphertext = decode_hex(ciphertext_hex);
    let nonce = decode_hex(nonce_hex);
    let plain = decrypt_bytes(&ciphertext, &nonce, dek)?;
    String::from_utf8(plain).map_err(js_err)
}

fn encrypt_bytes(plain: &[u8], dek: &[u8]) -> Result<EncryptedData, JsError> {
    let cipher = ChaCha20Poly1305::new_from_slice(dek).map_err(js_err)?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plain).map_err(js_err)?;
    Ok(EncryptedData { nonce: nonce_bytes.to_vec(), ciphertext: ct })
}

fn decrypt_bytes(ciphertext: &[u8], nonce: &[u8], dek: &[u8]) -> Result<Vec<u8>, JsError> {
    let cipher = ChaCha20Poly1305::new_from_slice(dek).map_err(js_err)?;
    let nonce = Nonce::from_slice(nonce);
    cipher.decrypt(nonce, ciphertext).map_err(js_err)
}

// ---- Legacy (keep for compatibility) ----
#[wasm_bindgen]
pub fn encrypt_pin(pin_json: &str, dek: &[u8]) -> Result<JsValue, JsError> {
    let encrypted = encrypt_bytes(pin_json.as_bytes(), dek)?;
    Ok(serde_wasm_bindgen::to_value(&EncryptedData {
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
    }).unwrap())
}

#[wasm_bindgen]
pub fn decrypt_pin(encrypted: &JsValue, dek: &[u8]) -> Result<String, JsError> {
    let data: EncryptedData = serde_wasm_bindgen::from_value(encrypted.clone()).map_err(js_err)?;
    let plain = decrypt_bytes(&data.ciphertext, &data.nonce, dek)?;
    String::from_utf8(plain).map_err(js_err)
}
