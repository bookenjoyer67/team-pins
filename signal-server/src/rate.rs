use std::collections::HashMap;
use std::time::Duration;
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
    offenses: HashMap<String, u32>,
    pub total_bans: u64,
    pub total_rate_limited: u64,
}

impl RateLimiter {
    pub fn new(c: RateLimitConfig) -> Self {
        Self {
            msgs: HashMap::new(),
            conns: HashMap::new(),
            bans: HashMap::new(),
            comm_regs: HashMap::new(),
            config: c,
            offenses: HashMap::new(),
            total_bans: 0,
            total_rate_limited: 0,
        }
    }

    fn escalate_ban(&mut self, ip: &str, now: Instant) {
        let count = self.offenses.entry(ip.to_string()).and_modify(|c| *c += 1).or_insert(1);
        let idx = ((*count as usize).saturating_sub(1))
            .min(self.config.graduated_ban_durations_secs.len().saturating_sub(1));
        let duration = self.config.graduated_ban_durations_secs
            .get(idx)
            .copied()
            .unwrap_or(self.config.ban_duration_secs);
        self.bans.insert(ip.to_string(), now + Duration::from_secs(duration));
        self.total_bans += 1;
        warn!("Banned {} for {}s (offense #{}, tier {})", ip, duration, count, idx + 1);
    }

    pub fn check_conn(&mut self, ip: &str) -> bool {
        if let Some(until) = self.bans.get(ip) {
            if Instant::now() < *until { return false; }
            self.bans.remove(ip);
        }
        let now = Instant::now();
        let window = Duration::from_secs(60);
        let e = self.conns.entry(ip.to_string()).or_default();
        e.retain(|t| now.duration_since(*t) < window);
        e.push(now);
        if e.len() as u32 > self.config.connections_per_min {
            self.escalate_ban(ip, now);
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
        let window = Duration::from_secs(1);
        let e = self.msgs.entry(ip.to_string()).or_default();
        e.retain(|t| now.duration_since(*t) < window);
        e.push(now);
        if e.len() > self.config.messages_per_sec as usize * 3 {
            self.escalate_ban(ip, now);
            return false;
        }
        let ok = (e.len() as u32) <= self.config.messages_per_sec;
        if !ok { self.total_rate_limited += 1; }
        ok
    }

    pub fn check_community_reg(&mut self, ip: &str) -> bool {
        if let Some(until) = self.bans.get(ip) {
            if Instant::now() < *until { return false; }
            self.bans.remove(ip);
        }
        let now = Instant::now();
        let window = Duration::from_secs(self.config.community_reg_window_secs);
        let e = self.comm_regs.entry(ip.to_string()).or_default();
        e.retain(|t| now.duration_since(*t) < window);
        e.push(now);
        if e.len() as u32 > self.config.community_regs_per_window {
            self.escalate_ban(ip, now);
            return false;
        }
        true
    }

    pub fn banned_count(&self) -> usize {
        self.bans.len()
    }

    pub fn clean(&mut self) {
        let now = Instant::now();
        let msg_window = Duration::from_secs(300);
        let conn_window = Duration::from_secs(300);
        self.msgs.retain(|_, v| { v.retain(|t| now.duration_since(*t) < msg_window); !v.is_empty() });
        self.conns.retain(|_, v| { v.retain(|t| now.duration_since(*t) < conn_window); !v.is_empty() });
        self.bans.retain(|_, t| *t > now);
        self.comm_regs.retain(|_, v| {
            v.retain(|t| now.duration_since(*t) < Duration::from_secs(self.config.community_reg_window_secs));
            !v.is_empty()
        });
        // Prune offense records for IPs with expired bans
        self.offenses.retain(|ip, _| {
            self.bans.contains_key(ip) || {
                // Keep offense count if banned recently, otherwise decay
                true  // keep indefinitely, just capped by MAX_ENTRIES below
            }
        });
        // Trim oversized maps
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
        if self.offenses.len() > MAX_ENTRIES {
            let key = self.offenses.keys().next().cloned();
            if let Some(k) = key { self.offenses.remove(&k); }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> RateLimitConfig {
        RateLimitConfig {
            messages_per_sec: 5,
            connections_per_min: 3,
            ban_duration_secs: 10,
            community_regs_per_window: 2,
            community_reg_window_secs: 60,
            graduated_ban_durations_secs: vec![5, 10, 30],
        }
    }

    #[test]
    fn test_check_msg_within_limit() {
        let mut rl = RateLimiter::new(test_config());
        for _ in 0..5 {
            assert!(rl.check_msg("192.168.1.1"), "msg within limit should pass");
        }
    }

    #[test]
    fn test_check_msg_exceeds_limit() {
        let mut rl = RateLimiter::new(test_config());
        for _ in 0..5 {
            rl.check_msg("192.168.1.1");
        }
        assert!(!rl.check_msg("192.168.1.1"), "6th msg should be rate-limited");
    }

    #[test]
    fn test_check_msg_bans_on_flood() {
        let config = RateLimitConfig {
            messages_per_sec: 1,
            connections_per_min: 30,
            ban_duration_secs: 10,
            community_regs_per_window: 5,
            community_reg_window_secs: 60,
            graduated_ban_durations_secs: vec![5, 10, 30],
        };
        let mut rl = RateLimiter::new(config);
        for _ in 0..4 {
            rl.check_msg("192.168.1.2");
        }
        assert!(!rl.check_msg("192.168.1.2"), "banned IP should be blocked");
        assert_eq!(rl.offenses.len(), 1, "should record offense");
    }

    #[test]
    fn test_graduated_ban_escalates() {
        let config = RateLimitConfig {
            messages_per_sec: 1,
            connections_per_min: 30,
            ban_duration_secs: 10,
            community_regs_per_window: 5,
            community_reg_window_secs: 60,
            graduated_ban_durations_secs: vec![1, 2, 3],
        };
        let mut rl = RateLimiter::new(config);
        // First offense: tier 1 (1 second)
        for _ in 0..4 {
            rl.check_msg("10.0.0.1");
        }
        assert_eq!(rl.offenses.get("10.0.0.1"), Some(&1));
        // Wait for ban to expire
        std::thread::sleep(Duration::from_secs(2));
        rl.clean();
        // Second offense: tier 2 (2 seconds)
        for _ in 0..4 {
            rl.check_msg("10.0.0.1");
        }
        assert_eq!(rl.offenses.get("10.0.0.1"), Some(&2));
    }

    #[test]
    fn test_check_conn_within_limit() {
        let mut rl = RateLimiter::new(test_config());
        for _ in 0..3 {
            assert!(rl.check_conn("10.0.0.1"), "conn within limit should pass");
        }
        assert!(!rl.check_conn("10.0.0.1"), "4th connection should be rejected");
    }

    #[test]
    fn test_different_ips_independent() {
        let mut rl = RateLimiter::new(test_config());
        for _ in 0..5 {
            assert!(rl.check_msg("1.1.1.1"));
        }
        assert!(!rl.check_msg("1.1.1.1"), "IP1 should be limited");
        assert!(rl.check_msg("2.2.2.2"), "IP2 should still be allowed");
    }

    #[test]
    fn test_community_reg_limit() {
        let config = RateLimitConfig {
            messages_per_sec: 20,
            connections_per_min: 30,
            ban_duration_secs: 10,
            community_regs_per_window: 2,
            community_reg_window_secs: 60,
            graduated_ban_durations_secs: vec![5, 10, 30],
        };
        let mut rl = RateLimiter::new(config);
        assert!(rl.check_community_reg("10.0.0.1"));
        assert!(rl.check_community_reg("10.0.0.1"));
        assert!(!rl.check_community_reg("10.0.0.1"), "3rd reg should be rejected");
    }

    #[test]
    fn test_clean_removes_bans() {
        let config = RateLimitConfig {
            messages_per_sec: 1,
            connections_per_min: 30,
            ban_duration_secs: 1,
            community_regs_per_window: 5,
            community_reg_window_secs: 60,
            graduated_ban_durations_secs: vec![1],
        };
        let mut rl = RateLimiter::new(config);
        for _ in 0..4 {
            rl.check_msg("1.1.1.1");
        }
        assert!(!rl.check_msg("1.1.1.1"), "should be banned");
        std::thread::sleep(Duration::from_millis(1200));
        rl.clean();
        assert!(rl.check_msg("1.1.1.1"), "ban should expire after clean");
    }

    #[test]
    fn test_graduated_ban_reaches_tier_three() {
        let config = RateLimitConfig {
            messages_per_sec: 1,
            connections_per_min: 30,
            ban_duration_secs: 10,
            community_regs_per_window: 5,
            community_reg_window_secs: 60,
            graduated_ban_durations_secs: vec![1, 2, 3],
        };
        let mut rl = RateLimiter::new(config);
        // Offense 1 → tier 1
        for _ in 0..4 { rl.check_msg("10.0.0.1"); }
        assert_eq!(rl.offenses.get("10.0.0.1"), Some(&1));
        std::thread::sleep(Duration::from_secs(2)); rl.clean();
        // Offense 2 → tier 2
        for _ in 0..4 { rl.check_msg("10.0.0.1"); }
        assert_eq!(rl.offenses.get("10.0.0.1"), Some(&2));
        std::thread::sleep(Duration::from_secs(3)); rl.clean();
        // Offense 3 → tier 3
        for _ in 0..4 { rl.check_msg("10.0.0.1"); }
        assert_eq!(rl.offenses.get("10.0.0.1"), Some(&3));
    }

    #[test]
    fn test_offense_count_persists_after_ban_expiry() {
        let config = RateLimitConfig {
            messages_per_sec: 1,
            connections_per_min: 30,
            ban_duration_secs: 1,
            community_regs_per_window: 5,
            community_reg_window_secs: 60,
            graduated_ban_durations_secs: vec![1, 5, 30],
        };
        let mut rl = RateLimiter::new(config);
        // First offense
        for _ in 0..4 { rl.check_msg("10.0.0.2"); }
        assert_eq!(rl.offenses.get("10.0.0.2"), Some(&1));
        std::thread::sleep(Duration::from_secs(2)); rl.clean();
        // Ban expired, but offense count persists
        assert_eq!(rl.offenses.get("10.0.0.2"), Some(&1));
        for _ in 0..4 { rl.check_msg("10.0.0.2"); }
        assert_eq!(rl.offenses.get("10.0.0.2"), Some(&2));
    }

    #[test]
    fn test_clean_preserves_offense_records() {
        let config = RateLimitConfig {
            messages_per_sec: 1,
            connections_per_min: 30,
            ban_duration_secs: 1,
            community_regs_per_window: 5,
            community_reg_window_secs: 60,
            graduated_ban_durations_secs: vec![1, 5],
        };
        let mut rl = RateLimiter::new(config);
        // Trigger a ban to record offense
        for _ in 0..4 { rl.check_msg("10.0.0.3"); }
        assert!(rl.offenses.contains_key("10.0.0.3"));
        std::thread::sleep(Duration::from_secs(2));
        rl.clean(); // ban expires but offenses persist
        assert!(rl.offenses.contains_key("10.0.0.3"), "offense count persists after ban expiry");
    }
}
