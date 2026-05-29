# Self-Hosting piggPin Relay

Run your own signal relay server for piggPin. The relay handles WebRTC signaling, community discovery, and encrypted map sharing. All data is encrypted client-side — the relay never sees your pins, keys, or content.

## Prerequisites

- **Rust** toolchain — [rustup.rs](https://rustup.rs)
- **Git**
- A server with a public IP or domain name
- An open port for WebSocket traffic (default: `9000`)

## Quick Start

```bash
git clone https://github.com/bookenjoyer67/team-pins.git
cd team-pins/signal-server
cp config.example.toml config.toml
# edit config.toml to your liking
cargo build --release
./target/release/piggpin-signal config.toml
```

The relay prints a banner with all running services on startup. Look for the WebSocket listener address to confirm it started correctly.

## Configuration

Edit `signal-server/config.toml`. Key settings:

```toml
[server]
port = 9000              # WebSocket + auto-detect HTTP share
bind_address = "0.0.0.0" # Listen on all interfaces

[security]
max_message_size = 10485760  # 10 MB
max_room_len = 64

[share]
max_shares = 1000            # Max concurrent share blobs
share_ttl_secs = 86400       # Default 24 hours
max_share_bytes = 209715200  # 200 MB payload limit
allowed_origin = "https://yoursite.com"  # CORS for share uploads
```

**Environment variables:**

| Variable | Effect |
|----------|--------|
| `RUST_LOG` | Log level: `info` (default), `debug`, `trace` |
| `MQTT_USERNAME` | Overrides `[mqtt].username` |
| `MQTT_PASSWORD` | Overrides `[mqtt].password` |

## TLS / Reverse Proxy

For `wss://` (secure WebSocket), run a reverse proxy in front of the relay.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name relay.yoursite.com;

    ssl_certificate     /etc/letsencrypt/live/relay.yoursite.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.yoursite.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

### Caddy

```
relay.yoursite.com {
    reverse_proxy 127.0.0.1:9000
}
```

Caddy handles TLS certificates automatically.

### Cloudflare Tunnel

If running on a home server without a public IP, use `cloudflared`:

```bash
cloudflared tunnel run --url http://localhost:9000
```

Set your client to `wss://<your-tunnel-hostname>`.

## Connecting the Frontend

1. Open piggPin and click the **Social** button (🌐 on the toolbar)
2. Click **⚡ Relay** to open ICE/TURN settings
3. Add your relay URL in the **Signal relay servers** section, e.g. `wss://relay.yoursite.com`
4. Click **Save**

The app will use your relay for signaling, community discovery, and map sharing.

## Systemd Service

Create `/etc/systemd/system/piggpin-signal.service`:

```ini
[Unit]
Description=piggPin Signal Relay
After=network.target

[Service]
Type=simple
User=piggpin
WorkingDirectory=/opt/piggpin/signal-server
ExecStart=/opt/piggpin/signal-server/target/release/piggpin-signal config.toml
Restart=always
RestartSec=10
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable piggpin-signal
sudo systemctl start piggpin-signal
sudo journalctl -u piggpin-signal -f   # view logs
```

## Persistent Data

The relay stores community data in `community_data.json` in the working directory. It snapshots every 5 seconds with an atomic write-then-rename pattern, keeping a `community_data.json.bak` backup.

No database setup is required — it's all file-based.

## Optional: Experimental Features

These features are available but experimental. Enable them in `config.toml`:

**MQTT Bridge (Meshtastic)** — Bridges Meshtastic radio mesh traffic into WebSocket rooms. Requires Meshtastic MQTT credentials.

```toml
[mqtt]
enabled = true
broker = "mqtt.meshtastic.org"
port = 8883
root_topic = "msh"
bridge_room = "mesh"
```

**RNode LoRa Bridge** — Bridges serial-connected RNode devices (LoRa radio) via KISS framing.

```toml
[rnode]
enabled = true
serial_port = "/dev/ttyUSB0"
baud_rate = 115200
bridge_room = "rnode"
```

**Peer Relay Federation** — Connect multiple relay instances for decentralized community discovery.

```toml
[peer_relays]
enabled = true
peer_urls = ["wss://other-relay.example.com"]
```

**Reticulum Bridge** — Reticulum transport stack for internet-scale mesh routing. Requires `[reticulum]` section in config.

## Firewall

| Port | Protocol | Required | Purpose |
|------|----------|----------|---------|
| 9000 | TCP | **Yes** | WebSocket signaling + auto-detect HTTP share |
| 9001 | TCP | No | Direct HTTP share upload/download |
| 443 | TCP | Yes (with TLS) | HTTPS/WSS through reverse proxy |

If using a reverse proxy, only port 443 needs to be public. Keep `9000` firewalled to localhost.

## Troubleshooting

**Relay won't start / port in use:**
```bash
sudo lsof -i :9000   # check what's using the port
```

**WebSocket connection refused:**
- Verify `bind_address = "0.0.0.0"` (not `127.0.0.1` unless proxied)
- Check firewall: `sudo ufw allow 9000`

**TLS / wss:// not working:**
- Verify the reverse proxy is forwarding the `Upgrade` and `Connection` headers
- Test with a plain `ws://` connection first to isolate the issue

**Enable debug logging:**
```bash
RUST_LOG=debug ./target/release/piggpin-signal config.toml
```

**Community data corruption:**
- Delete `community_data.json` to start fresh (all relay-hosted communities will be lost)
- Restore from `community_data.json.bak` if available

---

Made with 💸 by [bookenjoyer67](https://github.com/bookenjoyer67)
