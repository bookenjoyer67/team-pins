use wasm_bindgen::prelude::*;
use indexmap::IndexMap;
use serde_json;

// ---- generic key-value Store with TTL + size cap ----

struct Entry {
    ts: u64,                // timestamp (ms) when set
    ttl: u32,               // per-entry TTL in ms
    value: serde_json::Value, // stored as generic JSON
}

#[wasm_bindgen]
pub struct Store {
    map: IndexMap<String, Entry>,
    max_entries: u32,
    default_ttl_ms: u32,
}

#[wasm_bindgen]
impl Store {
    #[wasm_bindgen(constructor)]
    pub fn new(max_entries: u32, default_ttl_ms: u32) -> Store {
        Store {
            map: IndexMap::new(),
            max_entries,
            default_ttl_ms,
        }
    }

    pub fn get(&mut self, key: &str) -> JsValue {
        self.evict_one(key);
        match self.map.get(key) {
            Some(entry) => serde_wasm_bindgen::to_value(&entry.value).unwrap_or(JsValue::UNDEFINED),
            None => JsValue::UNDEFINED,
        }
    }

    pub fn set(&mut self, key: &str, value: JsValue) {
        let now = now_ms();
        let json_val: serde_json::Value = serde_wasm_bindgen::from_value(value).unwrap_or(serde_json::Value::Null);
        if self.map.contains_key(key) {
            self.map.insert(key.to_string(), Entry { ts: now, ttl: self.default_ttl_ms, value: json_val });
        } else {
            // Evict at capacity — FIFO (remove oldest by insertion order)
            while self.map.len() >= self.max_entries as usize {
                self.map.shift_remove_index(0);
            }
            self.map.insert(key.to_string(), Entry { ts: now, ttl: self.default_ttl_ms, value: json_val });
        }
    }

    pub fn delete(&mut self, key: &str) -> bool {
        self.map.shift_remove(key).is_some()
    }

    pub fn has(&mut self, key: &str) -> bool {
        self.evict_one(key);
        self.map.contains_key(key)
    }

    pub fn size(&mut self) -> u32 {
        self.evict_expired();
        self.map.len() as u32
    }

    pub fn clear(&mut self) {
        self.map.clear();
    }

    pub fn entries(&mut self) -> Box<[JsValue]> {
        self.evict_expired();
        self.map.iter()
            .map(|(k, e)| {
                let v = serde_wasm_bindgen::to_value(&e.value).unwrap_or(JsValue::UNDEFINED);
                let arr = js_sys::Array::new();
                arr.push(&JsValue::from_str(k));
                arr.push(&v);
                arr.into()
            })
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }

    pub fn values(&mut self) -> Box<[JsValue]> {
        self.evict_expired();
        self.map.iter()
            .map(|(_, e)| serde_wasm_bindgen::to_value(&e.value).unwrap_or(JsValue::UNDEFINED))
            .filter(|v| !v.is_undefined())
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }

    pub fn keys(&mut self) -> Box<[JsValue]> {
        self.evict_expired();
        self.map.keys()
            .map(|k| JsValue::from_str(k))
            .collect::<Vec<_>>()
            .into_boxed_slice()
    }

    pub fn evict_expired(&mut self) -> u32 {
        let now = now_ms();
        let before = self.map.len();
        self.map.retain(|_, e| now - e.ts < e.ttl as u64);
        (before - self.map.len()) as u32
    }

    pub fn set_ttl(&mut self, key: &str, ttl_ms: u32) {
        if let Some(entry) = self.map.get_mut(key) {
            entry.ttl = ttl_ms;
        }
    }

    fn evict_one(&mut self, key: &str) {
        let now = now_ms();
        if let Some(entry) = self.map.get(key) {
            if now - entry.ts >= entry.ttl as u64 {
                self.map.shift_remove(key);
            }
        }
    }
}

// ---- specialized ChunkStore for message reassembly ----

struct ChunkEntry {
    ts: u64,
    chunks: Vec<Option<String>>, // sparse — Some(chunk) or None for missing
    count: u32,
    total: u32,
}

#[wasm_bindgen]
pub struct ChunkStore {
    map: IndexMap<String, ChunkEntry>,
    max_entries: u32,
    ttl_ms: u32,
}

#[wasm_bindgen]
impl ChunkStore {
    #[wasm_bindgen(constructor)]
    pub fn new(max_entries: u32, ttl_ms: u32) -> ChunkStore {
        ChunkStore {
            map: IndexMap::new(),
            max_entries,
            ttl_ms,
        }
    }

    /// Add a chunk at the given index. Returns true when all chunks received.
    pub fn add_chunk(&mut self, key: &str, index: u32, total: u32, data: &str) -> bool {
        if total == 0 || index >= total {
            return false;
        }
        // Evict oldest if at capacity (must happen before entry() borrow)
        while self.map.len() >= self.max_entries as usize {
            self.map.shift_remove_index(0);
        }
        let idx = index as usize;
        let entry = self.map.entry(key.to_string()).or_insert_with(|| {
            let chunks = (0..total as usize).map(|_| None).collect();
            ChunkEntry { ts: now_ms(), chunks, count: 0, total }
        });
        entry.ts = now_ms();
        // Prevent memory exhaustion from malicious oversized total
        if total as usize > entry.chunks.len() {
            return false;
        }
        if entry.chunks[idx].is_none() {
            entry.chunks[idx] = Some(data.to_string());
            entry.count += 1;
        }
        entry.count >= entry.total
    }

    /// Assemble all chunks in order, joined as a single string.
    /// Returns None if not complete.
    pub fn assemble(&mut self, key: &str) -> Option<String> {
        let entry = self.map.get(key)?;
        if entry.count < entry.total {
            return None;
        }
        Some(entry.chunks.iter()
            .filter_map(|c| c.as_deref())
            .collect::<Vec<_>>()
            .concat())
    }

    pub fn remove(&mut self, key: &str) -> bool {
        self.map.shift_remove(key).is_some()
    }

    pub fn evict_expired(&mut self) -> u32 {
        let now = now_ms();
        let before = self.map.len();
        self.map.retain(|_, e| now - e.ts < self.ttl_ms as u64);
        (before - self.map.len()) as u32
    }

    pub fn clear(&mut self) {
        self.map.clear();
    }
}

fn now_ms() -> u64 {
    js_sys::Date::now() as u64
}
