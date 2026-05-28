use std::collections::HashMap;
use tokio::time::{Duration, Instant};
use tracing::warn;

use crate::config::RateLimitConfig;

pub struct RateLimiter {
    msgs: HashMap<String, (Instant, u32)>,
    conns: HashMap<String, (Instant, u32)>,
    bans: HashMap<String, Instant>,
    config: RateLimitConfig,
}

impl RateLimiter {
    pub fn new(c: RateLimitConfig) -> Self {
        Self { msgs: HashMap::new(), conns: HashMap::new(), bans: HashMap::new(), config: c }
    }

    pub fn check_conn(&mut self, ip: &str) -> bool {
        if let Some(until) = self.bans.get(ip) {
            if Instant::now() < *until { return false; }
            self.bans.remove(ip);
        }
        let e = self.conns.entry(ip.to_string()).or_insert((Instant::now(), 0));
        if e.0.elapsed().as_secs() > 60 { *e = (Instant::now(), 0); }
        e.1 += 1;
        if e.1 > self.config.connections_per_min {
            self.bans.insert(ip.to_string(), Instant::now() + Duration::from_secs(self.config.ban_duration_secs));
            warn!("Banned {} for connection flood", ip);
            return false;
        }
        true
    }

    pub fn check_msg(&mut self, ip: &str) -> bool {
        if self.bans.contains_key(ip) { return false; }
        let e = self.msgs.entry(ip.to_string()).or_insert((Instant::now(), 0));
        if e.0.elapsed().as_secs() > 1 { *e = (Instant::now(), 0); }
        e.1 += 1;
        e.1 <= self.config.messages_per_sec
    }

    pub fn clean(&mut self) {
        let now = Instant::now();
        self.msgs.retain(|_, (t, _)| t.elapsed().as_secs() < 300);
        self.conns.retain(|_, (t, _)| t.elapsed().as_secs() < 300);
        self.bans.retain(|_, t| *t > now);
    }
}
