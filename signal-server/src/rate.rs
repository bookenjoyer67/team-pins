use std::collections::HashMap;
use tokio::time::Instant;
use tracing::warn;

use crate::config::RateLimitConfig;

const MAX_ENTRIES: usize = 100_000;

pub struct RateLimiter {
    msgs: HashMap<String, Vec<Instant>>,
    conns: HashMap<String, Vec<Instant>>,
    bans: HashMap<String, Instant>,
    comm_regs: HashMap<String, Vec<Instant>>,
    config: RateLimitConfig,
}

impl RateLimiter {
    pub fn new(c: RateLimitConfig) -> Self {
        Self { msgs: HashMap::new(), conns: HashMap::new(), bans: HashMap::new(), comm_regs: HashMap::new(), config: c }
    }

    pub fn check_conn(&mut self, ip: &str) -> bool {
        if let Some(until) = self.bans.get(ip) {
            if Instant::now() < *until { return false; }
            self.bans.remove(ip);
        }
        let now = Instant::now();
        let window = std::time::Duration::from_secs(60);
        let e = self.conns.entry(ip.to_string()).or_default();
        e.retain(|t| now.duration_since(*t) < window);
        e.push(now);
        if e.len() as u32 > self.config.connections_per_min {
            self.bans.insert(ip.to_string(), now + std::time::Duration::from_secs(self.config.ban_duration_secs));
            warn!("Banned {} for connection flood", ip);
            return false;
        }
        true
    }

    pub fn check_msg(&mut self, ip: &str) -> bool {
        if let Some(until) = self.bans.get(ip) {
            if Instant::now() < *until { return false; }
            self.bans.remove(ip);
        }
        let now = Instant::now();
        let window = std::time::Duration::from_secs(1);
        let e = self.msgs.entry(ip.to_string()).or_default();
        e.retain(|t| now.duration_since(*t) < window);
        e.push(now);
        if e.len() > self.config.messages_per_sec as usize * 3 {
            self.bans.insert(ip.to_string(), now + std::time::Duration::from_secs(self.config.ban_duration_secs));
            warn!("Banned {} for repeated message flooding", ip);
            return false;
        }
        (e.len() as u32) <= self.config.messages_per_sec
    }

    pub fn check_community_reg(&mut self, ip: &str) -> bool {
        if let Some(until) = self.bans.get(ip) {
            if Instant::now() < *until { return false; }
            self.bans.remove(ip);
        }
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.config.community_reg_window_secs);
        let e = self.comm_regs.entry(ip.to_string()).or_default();
        e.retain(|t| now.duration_since(*t) < window);
        e.push(now);
        if e.len() as u32 > self.config.community_regs_per_window {
            self.bans.insert(ip.to_string(), now + std::time::Duration::from_secs(self.config.ban_duration_secs));
            warn!("Banned {} for repeated community registration flooding", ip);
            return false;
        }
        true
    }

    pub fn clean(&mut self) {
        let now = Instant::now();
        let msg_window = std::time::Duration::from_secs(300);
        let conn_window = std::time::Duration::from_secs(300);
        self.msgs.retain(|_, v| { v.retain(|t| now.duration_since(*t) < msg_window); !v.is_empty() });
        self.conns.retain(|_, v| { v.retain(|t| now.duration_since(*t) < conn_window); !v.is_empty() });
        self.bans.retain(|_, t| *t > now);
        self.comm_regs.retain(|_, v| { v.retain(|t| now.duration_since(*t) < std::time::Duration::from_secs(self.config.community_reg_window_secs)); !v.is_empty() });
        if self.comm_regs.len() > MAX_ENTRIES {
            let key = self.comm_regs.keys().next().cloned();
            if let Some(k) = key { self.comm_regs.remove(&k); }
        }
        if self.msgs.len() > MAX_ENTRIES {
            let key = self.msgs.keys().next().cloned();
            if let Some(k) = key { self.msgs.remove(&k); }
        }
        if self.conns.len() > MAX_ENTRIES {
            let key = self.conns.keys().next().cloned();
            if let Some(k) = key { self.conns.remove(&k); }
        }
        if self.bans.len() > MAX_ENTRIES {
            let key = self.bans.keys().next().cloned();
            if let Some(k) = key { self.bans.remove(&k); }
        }
    }
}
