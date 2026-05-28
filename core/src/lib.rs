use wasm_bindgen::prelude::*;
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use chacha20poly1305::aead::{Aead, OsRng};

mod mesh_core;
use rand::RngCore;
use serde::{Serialize, Deserialize};
use x25519_dalek::{PublicKey, StaticSecret};
use ed25519_dalek::{SigningKey, VerifyingKey, Signature, Signer, Verifier};
use hkdf::Hkdf;
use sha2::Sha256;
use uuid::Uuid;
use qrcode::QrCode;
use qrcode::render::svg;
use qrcode::EcLevel;
use pbkdf2::pbkdf2_hmac;
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use std::io::{Read, Write};

#[derive(Serialize, Deserialize)]
struct KeyPair {
    public: Vec<u8>,
    secret: Vec<u8>,
}

struct EncryptedData {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

#[derive(Serialize)]
struct EncryptedOutput {
    ciphertext: String,
    nonce: String,
    salt: String,
}

#[derive(Serialize, Deserialize)]
struct PinOutput {
    title: String,
    note: String,
    lat: f64,
    lng: f64,
    #[serde(default = "default_color")]
    color: String,
}

fn default_color() -> String {
    "#2563eb".to_string()
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
    (0..s.len()).step_by(2)
        .filter_map(|i| u8::from_str_radix(&s[i..std::cmp::min(i+2, s.len())], 16).ok())
        .collect()
}

// ---- UUID ----
#[wasm_bindgen]
pub fn generate_uuid() -> String {
    Uuid::new_v4().to_string()
}

#[wasm_bindgen]
pub fn generate_qr_svg(data: &str) -> String {
    match QrCode::with_error_correction_level(data.as_bytes(), EcLevel::L) {
        Ok(code) => code.render::<svg::Color>()
            .min_dimensions(200, 200)
            .quiet_zone(false)
            .build(),
        Err(_) => String::new(),
    }
}

pub fn derive_password_key(password: &str, salt: &[u8]) -> Vec<u8> {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, 210_000, &mut key);
    key.to_vec()
}

#[wasm_bindgen]
pub fn encrypt_with_password(plain: &str, password: &str) -> JsValue {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = derive_password_key(password, &salt);
    let encrypted = encrypt_bytes_inner(plain.as_bytes(), &key).unwrap();
    serde_wasm_bindgen::to_value(&EncryptedOutput {
        ciphertext: encode_hex(&encrypted.ciphertext),
        nonce: encode_hex(&encrypted.nonce),
        salt: encode_hex(&salt),
    }).unwrap()
}

#[wasm_bindgen]
pub fn decrypt_with_password(ciphertext_hex: &str, nonce_hex: &str, salt_hex: &str, password: &str) -> Result<String, JsError> {
    let salt = decode_hex(salt_hex);
    let key = derive_password_key(password, &salt);
    let ct = decode_hex(ciphertext_hex);
    let nc = decode_hex(nonce_hex);
    let plain = decrypt_bytes(&ct, &nc, &key)?;
    String::from_utf8(plain).map_err(js_err)
}

#[wasm_bindgen]
pub fn encrypt_bytes_with_password(data: &[u8], password: &str) -> JsValue {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let key = derive_password_key(password, &salt);
    let encrypted = encrypt_bytes_inner(data, &key).unwrap();
    serde_wasm_bindgen::to_value(&EncryptedOutput {
        ciphertext: encode_hex(&encrypted.ciphertext),
        nonce: encode_hex(&encrypted.nonce),
        salt: encode_hex(&salt),
    }).unwrap()
}

#[wasm_bindgen]
pub fn decrypt_bytes_with_password(ciphertext_hex: &str, nonce_hex: &str, salt_hex: &str, password: &str) -> Result<Vec<u8>, JsError> {
    let salt = decode_hex(salt_hex);
    let key = derive_password_key(password, &salt);
    let ct = decode_hex(ciphertext_hex);
    let nc = decode_hex(nonce_hex);
    decrypt_bytes(&ct, &nc, &key)
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
pub fn generate_user_keypair_from_password(password: &str, community_id: &str) -> JsValue {
    let mut seed = [0u8; 32];
    let salt = format!("piggpin:v1:pbkdf2:{}", community_id);
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt.as_bytes(), 210_000, &mut seed);
    let secret = StaticSecret::from(seed);
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

// ---- Ed25519 signing (for attestations, votes, membership) ----

#[derive(Serialize)]
struct SigningKeyPair {
    public: String,
    secret: String,
}

#[wasm_bindgen]
pub fn generate_signing_keypair() -> JsValue {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    let kp = SigningKeyPair {
        public: encode_hex(&verifying_key.to_bytes()),
        secret: encode_hex(&signing_key.to_bytes()),
    };
    serde_wasm_bindgen::to_value(&kp).unwrap()
}

#[wasm_bindgen]
pub fn sign(payload_hex: &str, secret_key_hex: &str) -> Result<String, JsError> {
    let payload = decode_hex(payload_hex);
    let secret_bytes = decode_hex(secret_key_hex);
    let sk_arr: [u8; 32] = secret_bytes.as_slice().try_into().map_err(js_err)?;
    let signing_key = SigningKey::from_bytes(&sk_arr);
    let signature = signing_key.sign(&payload);
    Ok(encode_hex(&signature.to_bytes()))
}

#[wasm_bindgen]
pub fn verify(payload_hex: &str, signature_hex: &str, public_key_hex: &str) -> Result<bool, JsError> {
    let payload = decode_hex(payload_hex);
    let sig_bytes = decode_hex(signature_hex);
    let pk_bytes = decode_hex(public_key_hex);
    let sig_arr: [u8; 64] = sig_bytes.as_slice().try_into().map_err(js_err)?;
    let pk_arr: [u8; 32] = pk_bytes.as_slice().try_into().map_err(js_err)?;
    let sig = Signature::from_bytes(&sig_arr);
    let vk = VerifyingKey::from_bytes(&pk_arr).map_err(js_err)?;
    Ok(vk.verify(&payload, &sig).is_ok())
}

// ---- Annotation encrypt/decrypt ----
#[derive(Serialize, Deserialize)]
struct AnnotationData {
    text: String,
    author_name: String,
    #[serde(rename = "type")]
    annotation_type: String,
    ttl: Option<i64>,
}

#[wasm_bindgen]
pub fn encrypt_annotation(text: &str, author_name: &str, annotation_type: &str, ttl: Option<i64>, dek: &[u8]) -> Result<JsValue, JsError> {
    let data = AnnotationData {
        text: text.to_string(),
        author_name: author_name.to_string(),
        annotation_type: annotation_type.to_string(),
        ttl,
    };
    let plain = serde_json::to_string(&data).map_err(js_err)?;
    let encrypted = encrypt_bytes_inner(plain.as_bytes(), dek)?;
    let result = EncryptedOutput {
        ciphertext: encode_hex(&encrypted.ciphertext),
        nonce: encode_hex(&encrypted.nonce),
        salt: String::new(),
    };
    Ok(serde_wasm_bindgen::to_value(&result).unwrap())
}

#[wasm_bindgen]
pub fn decrypt_annotation(ciphertext_hex: &str, nonce_hex: &str, dek: &[u8]) -> Result<JsValue, JsError> {
    let ciphertext = decode_hex(ciphertext_hex);
    let nonce = decode_hex(nonce_hex);
    let plain = decrypt_bytes(&ciphertext, &nonce, dek)?;
    let s = String::from_utf8(plain).map_err(js_err)?;
    let data: AnnotationData = serde_json::from_str(&s).map_err(js_err)?;
    Ok(serde_wasm_bindgen::to_value(&data).unwrap())
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
    let ephemeral_pk_bytes: [u8; 32] = sealed[..32].try_into().map_err(|_| js_err("invalid sealed data"))?;
    let nonce_bytes: [u8; 12] = sealed[32..44].try_into().map_err(|_| js_err("invalid sealed data"))?;
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
    Ok(encode_hex(&sealed))
}

#[wasm_bindgen]
pub fn unwrap_dek(wrapped_hex: &str, secret_key_hex: &str) -> Result<Vec<u8>, JsError> {
    let sealed = decode_hex(wrapped_hex);
    let sk_bytes = decode_hex(secret_key_hex);
    let sk = StaticSecret::from(<[u8; 32]>::try_from(sk_bytes.as_slice()).map_err(js_err)?);
    ecies_open(&sealed, &sk)
}

// ---- Pin encrypt/decrypt (takes structured data, returns hex) ----
#[wasm_bindgen]
pub fn encrypt_pin_data(title: &str, note: &str, lat: f64, lng: f64, color: &str, dek: &[u8]) -> Result<JsValue, JsError> {
    let pin_json = serde_json::json!({
        "title": title,
        "note": note,
        "lat": lat,
        "lng": lng,
        "color": color,
    });
    let plain = pin_json.to_string();
    let encrypted = encrypt_bytes_inner(plain.as_bytes(), dek)?;
    let result = EncryptedOutput {
        ciphertext: encode_hex(&encrypted.ciphertext),
        nonce: encode_hex(&encrypted.nonce),
        salt: String::new(),
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
    let encrypted = encrypt_bytes_inner(geojson_str.as_bytes(), dek)?;
    let result = EncryptedOutput {
        ciphertext: encode_hex(&encrypted.ciphertext),
        nonce: encode_hex(&encrypted.nonce),
        salt: String::new(),
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

fn encrypt_bytes_inner(plain: &[u8], dek: &[u8]) -> Result<EncryptedData, JsError> {
    if dek.len() != 32 { return Err(js_err("invalid DEK length")); }
    let cipher = ChaCha20Poly1305::new_from_slice(dek).map_err(js_err)?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plain).map_err(js_err)?;
    Ok(EncryptedData { nonce: nonce_bytes.to_vec(), ciphertext: ct })
}

fn decrypt_bytes(ciphertext: &[u8], nonce: &[u8], dek: &[u8]) -> Result<Vec<u8>, JsError> {
    if dek.len() != 32 { return Err(js_err("invalid DEK length")); }
    if nonce.len() != 12 { return Err(js_err("invalid nonce length")); }
    let cipher = ChaCha20Poly1305::new_from_slice(dek).map_err(js_err)?;
    let nonce = Nonce::from_slice(nonce);
    cipher.decrypt(nonce, ciphertext).map_err(js_err)
}

// --- Raw binary encrypt/decrypt (for media files) ---
#[wasm_bindgen]
pub fn encrypt_raw_bytes(plain: &[u8], dek: &[u8]) -> Result<JsValue, JsError> {
    let encrypted = encrypt_bytes_inner(plain, dek)?;
    let result = EncryptedOutput {
        ciphertext: encode_hex(&encrypted.ciphertext),
        nonce: encode_hex(&encrypted.nonce),
        salt: String::new(),
    };
    Ok(serde_wasm_bindgen::to_value(&result).unwrap())
}

#[wasm_bindgen]
pub fn decrypt_raw_bytes(ciphertext_hex: &str, nonce_hex: &str, dek: &[u8]) -> Result<Vec<u8>, JsError> {
    let ciphertext = decode_hex(ciphertext_hex);
    let nonce = decode_hex(nonce_hex);
    Ok(decrypt_bytes(&ciphertext, &nonce, dek)?)
}

// ---- Freehand drawing utilities ----

fn perpendicular_distance(point: &[f64; 2], a: &[f64; 2], b: &[f64; 2]) -> f64 {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let mag = (dx * dx + dy * dy).sqrt();
    if mag < 1e-12 {
        return ((point[0] - a[0]).powi(2) + (point[1] - a[1]).powi(2)).sqrt();
    }
    let u = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (mag * mag);
    let clamped = u.max(0.0).min(1.0);
    let ix = a[0] + clamped * dx;
    let iy = a[1] + clamped * dy;
    ((point[0] - ix).powi(2) + (point[1] - iy).powi(2)).sqrt()
}

fn douglas_peucker(points: &[[f64; 2]], epsilon: f64) -> Vec<[f64; 2]> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let mut dmax = 0.0;
    let mut index = 0;
    let end = points.len() - 1;
    for i in 1..end {
        let d = perpendicular_distance(&points[i], &points[0], &points[end]);
        if d > dmax {
            dmax = d;
            index = i;
        }
    }
    if dmax > epsilon {
        let mut rec1 = douglas_peucker(&points[..=index], epsilon);
        let rec2 = douglas_peucker(&points[index..], epsilon);
        rec1.pop();
        rec1.extend(rec2);
        rec1
    } else {
        vec![points[0].clone(), points[end].clone()]
    }
}

/// Takes a JSON array of [lng, lat] pairs and returns simplified [lng, lat] pairs.
#[wasm_bindgen]
pub fn simplify_freehand(path_json: &str, tolerance: f64) -> String {
    let points: Vec<[f64; 2]> = serde_json::from_str(path_json).unwrap_or_default();
    if points.len() <= 2 || tolerance <= 0.0 {
        return path_json.to_string();
    }
    let simplified = douglas_peucker(&points, tolerance);
    serde_json::to_string(&simplified).unwrap()
}

// ---- Gzip compression ----

#[wasm_bindgen]
pub fn compress_gzip(data: &[u8]) -> Vec<u8> {
    let mut e = GzEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

#[wasm_bindgen]
pub fn compress_gzip_max(data: &[u8]) -> Vec<u8> {
    let mut e = GzEncoder::new(Vec::new(), Compression::best());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

// ---- Binary container serialization ----

fn encode_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = bytes.len().min(255) as u8;
    buf.push(len);
    if len > 0 { buf.extend_from_slice(&bytes[..len as usize]); }
}

fn decode_str(buf: &[u8], off: &mut usize) -> String {
    if *off >= buf.len() { return String::new(); }
    let len = buf[*off] as usize;
    *off += 1;
    if len == 0 { return String::new(); }
    if *off + len > buf.len() {
        *off = buf.len();
        return String::new();
    }
    let s = String::from_utf8_lossy(&buf[*off..*off + len]).to_string();
    *off += len;
    s
}

fn encode_bytes16(buf: &mut Vec<u8>, data: &[u8]) {
    let len = data.len() as u16;
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(data);
}

fn decode_bytes16(buf: &[u8], off: &mut usize) -> Vec<u8> {
    if *off + 2 > buf.len() { return Vec::new(); }
    let len = u16::from_le_bytes([buf[*off], buf[*off + 1]]) as usize;
    *off += 2;
    if len == 0 { return Vec::new(); }
    if *off + len > buf.len() {
        *off = buf.len();
        return Vec::new();
    }
    let data = buf[*off..*off + len].to_vec();
    *off += len;
    data
}

fn encode_bytes32(buf: &mut Vec<u8>, data: &[u8]) {
    let len = data.len() as u32;
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(data);
}

fn decode_bytes32(buf: &[u8], off: &mut usize) -> Vec<u8> {
    if *off + 4 > buf.len() { return Vec::new(); }
    let len = u32::from_le_bytes([buf[*off], buf[*off + 1], buf[*off + 2], buf[*off + 3]]) as usize;
    *off += 4;
    if len == 0 { return Vec::new(); }
    if len > 50_000_000 { // 50 MB max
        *off = buf.len();
        return Vec::new();
    }
    if *off + len > buf.len() {
        *off = buf.len();
        return Vec::new();
    }
    let data = buf[*off..*off + len].to_vec();
    *off += len;
    data
}

fn strip_empty(v: &serde_json::Value) -> Option<serde_json::Value> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) if s.is_empty() => None,
        serde_json::Value::Array(arr) => {
            let out: Vec<_> = arr.iter().filter_map(strip_empty).collect();
            if out.is_empty() { None } else { Some(serde_json::Value::Array(out)) }
        }
        serde_json::Value::Object(obj) => {
            let out: serde_json::Map<_, _> = obj.iter()
                .filter_map(|(k, v)| strip_empty(v).map(|c| (k.clone(), c)))
                .collect();
            if out.is_empty() { None } else { Some(serde_json::Value::Object(out)) }
        }
        other => Some(other.clone()),
    }
}

#[wasm_bindgen]
pub fn serialize_container(json: &str) -> Result<Vec<u8>, JsError> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(js_err)?;
    let data = strip_empty(&v).unwrap_or(serde_json::Value::Object(Default::default()));
    let mut buf = vec![0x03u8];

    let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("");
    encode_str(&mut buf, name);

    let keys = data.get("keys");
    if let Some(k) = keys {
        buf.push(1);
        encode_bytes16(&mut buf, &decode_hex(k.get("public_key").and_then(|v| v.as_str()).unwrap_or("")));
        encode_bytes16(&mut buf, &decode_hex(k.get("secret_key").and_then(|v| v.as_str()).unwrap_or("")));
        encode_bytes16(&mut buf, &decode_hex(k.get("wrapped_dek").and_then(|v| v.as_str()).unwrap_or("")));
    } else {
        buf.push(0);
    }

    let center = data.get("map_center").and_then(|v| v.as_array());
    if let Some(c) = center {
        if c.len() == 2 {
            buf.push(1);
            buf.extend_from_slice(&c[0].as_f64().unwrap_or(0.0).to_le_bytes());
            buf.extend_from_slice(&c[1].as_f64().unwrap_or(0.0).to_le_bytes());
        } else {
            buf.push(0);
        }
    } else {
        buf.push(0);
    }

    let zoom = data.get("map_zoom").and_then(|v| v.as_f64());
    if let Some(z) = zoom {
        buf.push(1);
        buf.extend_from_slice(&(z as f32).to_le_bytes());
    } else {
        buf.push(0);
    }

    let pins = data.get("pins").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    buf.extend_from_slice(&(pins.len() as u16).to_le_bytes());
    for p in &pins {
        encode_str(&mut buf, p.get("pin_id").and_then(|v| v.as_str()).unwrap_or(""));
        encode_bytes16(&mut buf, &decode_hex(p.get("ciphertext").and_then(|v| v.as_str()).unwrap_or("")));
        encode_bytes16(&mut buf, &decode_hex(p.get("nonce").and_then(|v| v.as_str()).unwrap_or("")));
        encode_str(&mut buf, p.get("emoji").and_then(|v| v.as_str()).unwrap_or(""));
        encode_str(&mut buf, p.get("layer_id").and_then(|v| v.as_str()).unwrap_or(""));
        let media = p.get("media");
        if let Some(m) = media {
            buf.push(1);
            let mt = m.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let mn = m.get("name").and_then(|v| v.as_str()).unwrap_or("");
            encode_str(&mut buf, mt);
            encode_str(&mut buf, mn);
            encode_bytes32(&mut buf, &decode_hex(m.get("ciphertext").and_then(|v| v.as_str()).unwrap_or("")));
            encode_bytes16(&mut buf, &decode_hex(m.get("nonce").and_then(|v| v.as_str()).unwrap_or("")));
        } else {
            buf.push(0);
        }
    }

    let drawings = data.get("drawings").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    buf.extend_from_slice(&(drawings.len() as u16).to_le_bytes());
    for d in &drawings {
        encode_str(&mut buf, d.get("drawing_id").and_then(|v| v.as_str()).unwrap_or(""));
        encode_bytes16(&mut buf, &decode_hex(d.get("encrypted_geojson").and_then(|v| v.as_str()).unwrap_or("")));
        encode_bytes16(&mut buf, &decode_hex(d.get("nonce").and_then(|v| v.as_str()).unwrap_or("")));
        encode_str(&mut buf, d.get("layer_id").and_then(|v| v.as_str()).unwrap_or(""));
        let media = d.get("media");
        if let Some(m) = media {
            buf.push(1);
            encode_str(&mut buf, m.get("type").and_then(|v| v.as_str()).unwrap_or(""));
            encode_str(&mut buf, m.get("name").and_then(|v| v.as_str()).unwrap_or(""));
            encode_bytes32(&mut buf, &decode_hex(m.get("ciphertext").and_then(|v| v.as_str()).unwrap_or("")));
            encode_bytes16(&mut buf, &decode_hex(m.get("nonce").and_then(|v| v.as_str()).unwrap_or("")));
        } else {
            buf.push(0);
        }
    }

    // layers
    let layers = data.get("layers").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    buf.extend_from_slice(&(layers.len() as u16).to_le_bytes());
    for l in &layers {
        encode_str(&mut buf, l.get("layer_id").and_then(|v| v.as_str()).unwrap_or(""));
        encode_str(&mut buf, l.get("name").and_then(|v| v.as_str()).unwrap_or(""));
        encode_str(&mut buf, l.get("color").and_then(|v| v.as_str()).unwrap_or(""));
        buf.push(if l.get("visible").and_then(|v| v.as_bool()).unwrap_or(true) { 1 } else { 0 });
        let opacity: f32 = l.get("opacity").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
        buf.extend_from_slice(&opacity.to_le_bytes());
        let schema_id = l.get("default_schema_id").and_then(|v| v.as_str()).unwrap_or("");
        if schema_id.is_empty() {
            buf.push(0);
        } else {
            buf.push(1);
            encode_str(&mut buf, schema_id);
        }
    }

    // schemas
    let schemas = data.get("schemas").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    buf.extend_from_slice(&(schemas.len() as u16).to_le_bytes());
    for s in &schemas {
        encode_str(&mut buf, s.get("schema_id").and_then(|v| v.as_str()).unwrap_or(""));
        encode_str(&mut buf, s.get("name").and_then(|v| v.as_str()).unwrap_or(""));
        let fields = s.get("fields").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        buf.push(fields.len().min(255) as u8);
        for f in &fields {
            encode_str(&mut buf, f.get("key").and_then(|v| v.as_str()).unwrap_or(""));
            encode_str(&mut buf, f.get("label").and_then(|v| v.as_str()).unwrap_or(""));
            encode_str(&mut buf, f.get("type").and_then(|v| v.as_str()).unwrap_or("text"));
            let opts = f.get("options").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            buf.push(opts.len().min(255) as u8);
            for o in &opts {
                encode_str(&mut buf, o.as_str().unwrap_or(""));
            }
        }
    }

    Ok(buf)
}

#[wasm_bindgen]
pub fn deserialize_container(binary: &[u8]) -> Result<String, JsError> {
    if binary.is_empty() { return Err(js_err("empty binary")); }
    let version = binary[0];
    let mut off: usize = 1;
    let name = decode_str(binary, &mut off);

    let mut map = serde_json::Map::new();
    map.insert("name".into(), serde_json::Value::String(name));

    let has_keys = binary[off]; off += 1;
    if has_keys == 1 {
        let pk = encode_hex(&decode_bytes16(binary, &mut off));
        let sk = encode_hex(&decode_bytes16(binary, &mut off));
        let wd = encode_hex(&decode_bytes16(binary, &mut off));
        let mut keys = serde_json::Map::new();
        keys.insert("public_key".into(), serde_json::Value::String(pk));
        keys.insert("secret_key".into(), serde_json::Value::String(sk));
        keys.insert("wrapped_dek".into(), serde_json::Value::String(wd));
        map.insert("keys".into(), serde_json::Value::Object(keys));
    }

    let has_center = binary[off]; off += 1;
    if has_center == 1 {
        let lat = f64::from_le_bytes(binary[off..off+8].try_into().unwrap()); off += 8;
        let lng = f64::from_le_bytes(binary[off..off+8].try_into().unwrap()); off += 8;
        map.insert("map_center".into(), serde_json::json!([lat, lng]));
    }

    let has_zoom = binary[off]; off += 1;
    if has_zoom == 1 {
        let zoom = f32::from_le_bytes(binary[off..off+4].try_into().unwrap()); off += 4;
        map.insert("map_zoom".into(), serde_json::json!(zoom));
    }

    let pin_count = u16::from_le_bytes([binary[off], binary[off+1]]) as usize; off += 2;
    let mut pins = Vec::new();
    for _ in 0..pin_count {
        let mut pin = serde_json::Map::new();
        pin.insert("pin_id".into(), decode_str(binary, &mut off).into());
        pin.insert("ciphertext".into(), encode_hex(&decode_bytes16(binary, &mut off)).into());
        pin.insert("nonce".into(), encode_hex(&decode_bytes16(binary, &mut off)).into());
        if version >= 3 {
            let emoji = decode_str(binary, &mut off);
            if !emoji.is_empty() { pin.insert("emoji".into(), emoji.into()); }
            let layer_id = decode_str(binary, &mut off);
            if !layer_id.is_empty() { pin.insert("layer_id".into(), layer_id.into()); }
        }
        let has_media = binary[off]; off += 1;
        if has_media == 1 {
            let mut media = serde_json::Map::new();
            media.insert("type".into(), decode_str(binary, &mut off).into());
            media.insert("name".into(), decode_str(binary, &mut off).into());
            media.insert("ciphertext".into(), encode_hex(&decode_bytes32(binary, &mut off)).into());
            media.insert("nonce".into(), encode_hex(&decode_bytes16(binary, &mut off)).into());
            pin.insert("media".into(), serde_json::Value::Object(media));
        }
        pins.push(serde_json::Value::Object(pin));
    }
    map.insert("pins".into(), serde_json::Value::Array(pins));

    let dwg_count = u16::from_le_bytes([binary[off], binary[off+1]]) as usize; off += 2;
    let mut drawings = Vec::new();
    for _ in 0..dwg_count {
        let mut d = serde_json::Map::new();
        d.insert("drawing_id".into(), decode_str(binary, &mut off).into());
        d.insert("encrypted_geojson".into(), encode_hex(&decode_bytes16(binary, &mut off)).into());
        d.insert("nonce".into(), encode_hex(&decode_bytes16(binary, &mut off)).into());
        if version >= 3 {
            let layer_id = decode_str(binary, &mut off);
            if !layer_id.is_empty() { d.insert("layer_id".into(), layer_id.into()); }
        }
        let has_media = binary[off]; off += 1;
        if has_media == 1 {
            let mut media = serde_json::Map::new();
            media.insert("type".into(), decode_str(binary, &mut off).into());
            media.insert("name".into(), decode_str(binary, &mut off).into());
            media.insert("ciphertext".into(), encode_hex(&decode_bytes32(binary, &mut off)).into());
            media.insert("nonce".into(), encode_hex(&decode_bytes16(binary, &mut off)).into());
            d.insert("media".into(), serde_json::Value::Object(media));
        }
        drawings.push(serde_json::Value::Object(d));
    }
    map.insert("drawings".into(), serde_json::Value::Array(drawings));

    if version >= 3 {
        let layer_count = u16::from_le_bytes([binary[off], binary[off+1]]) as usize; off += 2;
        let mut layers = Vec::new();
        for _ in 0..layer_count {
            let mut l = serde_json::Map::new();
            l.insert("layer_id".into(), decode_str(binary, &mut off).into());
            l.insert("name".into(), decode_str(binary, &mut off).into());
            l.insert("color".into(), decode_str(binary, &mut off).into());
            let visible = binary[off]; off += 1;
            l.insert("visible".into(), serde_json::Value::Bool(visible == 1));
            let opacity = f32::from_le_bytes(binary[off..off+4].try_into().unwrap()); off += 4;
            l.insert("opacity".into(), serde_json::json!(opacity));
            let has_schema = binary[off]; off += 1;
            if has_schema == 1 {
                l.insert("default_schema_id".into(), decode_str(binary, &mut off).into());
            }
            layers.push(serde_json::Value::Object(l));
        }
        map.insert("layers".into(), serde_json::Value::Array(layers));

        let schema_count = u16::from_le_bytes([binary[off], binary[off+1]]) as usize; off += 2;
        let mut schemas = Vec::new();
        for _ in 0..schema_count {
            let mut s = serde_json::Map::new();
            s.insert("schema_id".into(), decode_str(binary, &mut off).into());
            s.insert("name".into(), decode_str(binary, &mut off).into());
            let field_count = binary[off] as usize; off += 1;
            let mut fields = Vec::new();
            for _ in 0..field_count {
                let mut f = serde_json::Map::new();
                f.insert("key".into(), decode_str(binary, &mut off).into());
                f.insert("label".into(), decode_str(binary, &mut off).into());
                f.insert("type".into(), decode_str(binary, &mut off).into());
                let opt_count = binary[off] as usize; off += 1;
                let mut options: Vec<serde_json::Value> = Vec::new();
                for _ in 0..opt_count {
                    options.push(serde_json::Value::String(decode_str(binary, &mut off)));
                }
                if !options.is_empty() {
                    f.insert("options".into(), serde_json::Value::Array(options));
                }
                fields.push(serde_json::Value::Object(f));
            }
            s.insert("fields".into(), serde_json::Value::Array(fields));
            schemas.push(serde_json::Value::Object(s));
        }
        map.insert("schemas".into(), serde_json::Value::Array(schemas));
    }

    serde_json::to_string(&serde_json::Value::Object(map)).map_err(js_err)
}

// ---- Mesh chunk encoding ----

#[wasm_bindgen]
pub fn mesh_chunk_encode(data: &[u8]) -> String {
    const CHUNK_SIZE: usize = 170;
    if data.len() <= CHUNK_SIZE {
        return serde_json::json!([]).to_string();
    }
    let id = Uuid::new_v4().to_string();
    let total = (data.len() + CHUNK_SIZE - 1) / CHUNK_SIZE;
    let mut chunks = Vec::new();
    for i in 0..total {
        let start = i * CHUNK_SIZE;
        let end = std::cmp::min(start + CHUNK_SIZE, data.len());
        let chunk = std::str::from_utf8(&data[start..end]).unwrap_or("");
        let envelope = serde_json::json!({
            "_m": { "t": "c", "id": id, "i": i, "n": total, "d": chunk }
        });
        chunks.push(envelope.to_string());
    }
    serde_json::to_string(&chunks).unwrap()
}

// ---- Hardware model lookup ----

#[wasm_bindgen]
pub fn hw_model_name(model: u32) -> String {
    match model {
        0 => "Unknown", 1 => "TLORA_V2", 2 => "TLORA_V1", 3 => "TLORA_V2_1_1P6", 4 => "TBEAM",
        5 => "HELTEC_V2_0", 6 => "TBEAM_V0P7", 7 => "T_ECHO", 8 => "TLORA_V1_1P3",
        9 => "RAK4631", 10 => "HELTEC_V2_1", 11 => "HELTEC_V1", 12 => "LILYGO_TBEAM_S3_CORE",
        13 => "RAK11200", 14 => "NANO_G1", 15 => "TLORA_V2_1_1P8", 16 => "TLORA_T3_S3",
        17 => "NANO_G1_EXPLORER", 18 => "NANO_G2_ULTRA", 19 => "LORA_TYPE", 20 => "WIPHONE",
        21 => "WIO_WM1110", 22 => "RAK2560", 23 => "HELTEC_HRU_3601", 24 => "STATION_G2",
        25 => "RAK11310", 26 => "SENSELORA_RP2040", 27 => "SENSELORA_S3",
        28 => "CANARYONE", 29 => "RP2040_LORA", 30 => "STATION_G1", 31 => "WHITECAT_ESP32",
        32 => "HELTEC_TRACKER", 33 => "HELTEC_WSL_V3", 34 => "HELTEC_WIRELESS_PAPER",
        35 => "HELTEC_WIRELESS_TRACKER", 36 => "HELTEC_VISION_MASTER_T190",
        37 => "HELTEC_VISION_MASTER_E290", 38 => "HELTEC_MESH_NODE_T114",
        39 => "SENSECAP_INDICATOR", 40 => "TRACKER_T1000_E", 41 => "RAK3172",
        42 => "WIO_E5", 43 => "RADIOMASTER_900_BANDIT_NANO", 44 => "HELTEC_CAPSULE_SENSOR_V3",
        45 => "HELTEC_V3", 46 => "HELTEC_WIRELESS_STICK_LITE_V3",
        47 => "HELTEC_WIRELESS_PAPER_V1_1", 48 => "HELTEC_HT_D01",
        _ => return format!("HW:{}", model),
    }.to_string()
}

#[wasm_bindgen]
pub fn decompress_gzip(data: &[u8]) -> Result<Vec<u8>, JsError> {
    let d = GzDecoder::new(data);
    let mut out = Vec::new();
    d.take(50_000_000).read_to_end(&mut out).map_err(js_err)?;
    Ok(out)
}

// ---- Geometry helpers ----

const EARTH_R: f64 = 6_371_000.0;

fn haversine_m(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let d_lat = (lat2 - lat1).to_radians();
    let d_lng = (lng2 - lng1).to_radians();
    let a = (d_lat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lng / 2.0).sin().powi(2);
    EARTH_R * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

fn linestring_length(coords: &[[f64; 2]]) -> f64 {
    let mut total = 0.0;
    for i in 1..coords.len() {
        total += haversine_m(coords[i-1][1], coords[i-1][0], coords[i][1], coords[i][0]);
    }
    total
}

fn polygon_area(coords: &[[f64; 2]]) -> f64 {
    let n = coords.len();
    let mut area = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        let lng1 = coords[i][0].to_radians();
        let lat1 = coords[i][1].to_radians();
        let lng2 = coords[j][0].to_radians();
        let lat2 = coords[j][1].to_radians();
        area += (lng2 - lng1) * (2.0 + lat1.sin() + lat2.sin());
    }
    (area * EARTH_R * EARTH_R / 2.0).abs()
}

fn point_in_poly(point: &[f64; 2], polygon: &[[f64; 2]]) -> bool {
    let mut inside = false;
    let mut j = polygon.len() - 1;
    for i in 0..polygon.len() {
        let (xi, yi) = (polygon[i][0], polygon[i][1]);
        let (xj, yj) = (polygon[j][0], polygon[j][1]);
        if (yi > point[1]) != (yj > point[1])
            && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

#[wasm_bindgen]
pub fn compute_geometry(geojson_json: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(geojson_json).unwrap_or_default();
    let mut result = serde_json::json!({});
    if let Some(geom) = v.get("geometry").or_else(|| v.get("coordinates").and(Some(&v))) {
        let t = geom.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let pts: Vec<[f64; 2]> = if t == "Polygon" {
            geom.get("coordinates").and_then(|c| c[0].as_array()).map(|a| a.iter().filter_map(|p: &serde_json::Value| {
                Some([p[0].as_f64()?, p[1].as_f64()?])
            }).collect::<Vec<_>>()).unwrap_or_default()
        } else if t == "LineString" {
            geom.get("coordinates").and_then(|c| c.as_array()).map(|a| a.iter().filter_map(|p: &serde_json::Value| {
                Some([p[0].as_f64()?, p[1].as_f64()?])
            }).collect::<Vec<_>>()).unwrap_or_default()
        } else { vec![] };
        if !pts.is_empty() {
            if t == "Polygon" {
                let area = polygon_area(&pts);
                let mut perim = 0.0;
                for i in 0..pts.len() { perim += haversine_m(pts[i][1], pts[i][0], pts[(i+1)%pts.len()][1], pts[(i+1)%pts.len()][0]); }
                result = serde_json::json!({ "area": area, "perimeter": perim });
            } else if t == "LineString" {
                result = serde_json::json!({ "length": linestring_length(&pts) });
            }
        }
    }
    if let Some(pt) = v.get("point") {
        let px = pt[0].as_f64().unwrap_or(0.0);
        let py = pt[1].as_f64().unwrap_or(0.0);
        if let Some(geom) = v.get("geometry") {
            let t = geom.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let poly_pts: Vec<[f64; 2]> = geom.get("coordinates").and_then(|c| c[0].as_array()).map(|a| a.iter().filter_map(|p: &serde_json::Value| {
                Some([p[0].as_f64()?, p[1].as_f64()?])
            }).collect::<Vec<_>>()).unwrap_or_default();
            if !poly_pts.is_empty() {
                let inside = point_in_poly(&[px, py], &poly_pts);
                result["inside"] = serde_json::json!(inside);
            }
        }
    }
    serde_json::to_string(&result).unwrap()
}

#[wasm_bindgen]
pub fn detect_freehand_shape(points_json: &str) -> String {
    let points: Vec<[f64; 2]> = serde_json::from_str(points_json).unwrap_or_default();
    if points.len() < 8 { return "null".to_string(); }
    let first = points[0];
    let last = points[points.len() - 1];
    let close_dist = ((first[0] - last[0]).powi(2) + (first[1] - last[1]).powi(2)).sqrt();
    if close_dist > 0.002 { return "null".to_string(); }
    // Auto-close: snap last point to first
    let mut pts = points.clone();
    let last_idx = pts.len() - 1;
    pts[last_idx] = first;

    // Rectangle detection on auto-closed points
    let n = pts.len() as f64;
    let mut cx = 0.0; let mut cy = 0.0;
    for p in &pts { cx += p[0]; cy += p[1]; }
    cx /= n; cy /= n;
    let mut total_r = 0.0;
    let mut dists = Vec::with_capacity(pts.len());
    for p in &pts {
        let d = ((p[0] - cx).powi(2) + (p[1] - cy).powi(2)).sqrt();
        dists.push(d);
        total_r += d;
    }
    let avg_r = total_r / n;
    let variance: f64 = dists.iter().map(|d| (d - avg_r).powi(2)).sum::<f64>() / n;
    let std_dev = variance.sqrt() / (avg_r + 0.000001);
    if std_dev < 0.35 && avg_r > 0.0002 {
        let radius_m = haversine_m(cy, cx, cy + avg_r, cx);
        return serde_json::to_string(&serde_json::json!({
            "type": "circle",
            "center": [cx, cy],
            "radius": radius_m
        })).unwrap();
    }

    // Rectangle detection (only if circle was rejected)
    let min_lng = pts.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
    let max_lng = pts.iter().map(|p| p[0]).fold(f64::NEG_INFINITY, f64::max);
    let min_lat = pts.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
    let max_lat = pts.iter().map(|p| p[1]).fold(f64::NEG_INFINITY, f64::max);
    let tol = 0.12;
    let range_lng = max_lng - min_lng + 0.000001;
    let range_lat = max_lat - min_lat + 0.000001;
    let aspect = range_lng / range_lat;
    if aspect < 0.65 || aspect > 1.55 { return "null".to_string(); }
    let mut on_edge = 0;
    for p in &pts {
        let near_left = (p[0] - min_lng).abs() / range_lng < tol;
        let near_right = (p[0] - max_lng).abs() / range_lng < tol;
        let near_bot = (p[1] - min_lat).abs() / range_lat < tol;
        let near_top = (p[1] - max_lat).abs() / range_lat < tol;
        if (near_left || near_right) && p[1] >= min_lat && p[1] <= max_lat { on_edge += 1; }
        else if (near_bot || near_top) && p[0] >= min_lng && p[0] <= max_lng { on_edge += 1; }
    }
    if on_edge as f64 / pts.len() as f64 > 0.55 {
        return serde_json::to_string(&serde_json::json!({
            "type": "rectangle",
            "corners": [[min_lng, min_lat], [max_lng, min_lat], [max_lng, max_lat], [min_lng, max_lat]]
        })).unwrap();
    }

    "null".to_string()
}
