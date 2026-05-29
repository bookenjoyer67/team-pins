use std::collections::HashMap;
use std::sync::Arc;
use tokio::time::Instant;
use uuid::Uuid;

pub struct Share {
    pub data: Arc<Vec<u8>>,
    pub created: Instant,
    pub ttl_secs: u64,
    pub uses_remaining: Option<u32>,
}

pub struct ShareStore {
    pub shares: HashMap<String, Share>,
    pub max_shares: usize,
    pub share_ttl_secs: u64,
}

impl ShareStore {
    pub fn new(max_shares: usize, share_ttl_secs: u64) -> Self {
        Self { shares: HashMap::new(), max_shares, share_ttl_secs }
    }

    pub fn insert(&mut self, data: Vec<u8>, ttl_secs: Option<u64>, uses: Option<u32>) -> String {
        if self.shares.len() >= self.max_shares {
            let oldest = self.shares.iter()
                .min_by_key(|(_, s)| s.created)
                .map(|(k, _)| k.clone());
            if let Some(key) = oldest {
                self.shares.remove(&key);
            }
        }
        let id = Uuid::new_v4().to_string();
        self.shares.insert(id.clone(), Share {
            data: Arc::new(data),
            created: Instant::now(),
            ttl_secs: ttl_secs.unwrap_or(self.share_ttl_secs),
            uses_remaining: uses,
        });
        id
    }

    pub fn get(&mut self, id: &str) -> Option<Arc<Vec<u8>>> {
        let share = self.shares.remove(id)?;
        if share.created.elapsed().as_secs() > share.ttl_secs {
            return None;
        }
        let remaining = match share.uses_remaining {
            Some(0) => return None,
            Some(n) => Some(n - 1),
            None => None,
        };
        let data = Arc::clone(&share.data);
        self.shares.insert(id.to_string(), Share {
            data,
            created: share.created,
            ttl_secs: share.ttl_secs,
            uses_remaining: remaining,
        });
        Some(if let Some(share) = self.shares.get(id) { Arc::clone(&share.data) } else { return None; })
    }

    pub fn cleanup(&mut self) {
        self.shares.retain(|_, s| {
            s.created.elapsed().as_secs() < s.ttl_secs
        });
    }
}
