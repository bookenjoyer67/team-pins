# piggPin Signal Relay

WebSocket signaling relay for piggPin with security features, community management, and mesh network bridges.

## Run Tests

```bash
# All tests (unit + E2E) — 51 total
cargo test

# Unit tests only (fast, no I/O, 39 tests)
cargo test --lib

# E2E tests only (WebSocket integration, 12 tests)
cargo test --test e2e_rooms --test e2e_pins --test e2e_store

# Single test
cargo test --test e2e_rooms test_join_and_welcome

# With logging
RUST_LOG=info cargo test -- --nocapture
```

## Run the Server

```bash
# Build
cargo build

# Run
RUST_LOG=info cargo run -- config.toml
```

## Test Coverage

| Group | Tests | What's covered |
|---|---|---|
| `messages.rs` | 16 | Protocol JSON messages, password hashing, auth challenge |
| `auth.rs` | 7 | Ed25519 signature verify, tampered/wrong-key rejection, membership |
| `rate.rs` | 7 | Message/connection rate limiting, ban/flood, community reg limits |
| `config.rs` | 7 | Default configs, per-component defaults, storage config |
| `rnode.rs` | 6 | KISS frame encode/decode round-trip, special chars, multi-frame |
| `e2e_rooms.rs` | 5 | WebSocket join/welcome, peer_joined/left, message relay, room isolation |
| `e2e_pins.rs` | 5 | Community register, push_delta/sync_request, since-filter, duplicate |
| `e2e_store.rs` | 2 | Direct PersistentStore round-trip, since filter, multi-pin |
| **Total** | **51** | |
