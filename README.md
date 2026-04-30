# E2EE Team Pins

End-to-end encrypted collaborative map application. Teams place pins and draw shapes on a shared Leaflet map. All data is encrypted client-side — the server stores only ciphertext.

## Architecture

```
Browser (SPA)
├── main.js / widget.js          ← UI + Supabase client
├── core/pkg/e2e_core_bg.wasm    ← Rust crypto (X25519, ChaCha20Poly1305)
└── Supabase
    ├── Auth (email/password or Matrix JWT)
    ├── PostgreSQL (encrypted pins, drawings, teams)
    └── Realtime (live sync across tabs)
```

**Crypto:** Rust compiled to WASM via wasm-bindgen. Team keypairs use X25519 + ECIES for DEK wrapping. Pins/drawings encrypted with ChaCha20Poly1305 AEAD.

## Features

- Encrypted map pins (title, note, lat/lng)
- Encrypted drawings (polygon, line, rectangle, circle)
- Multi-team with invite tokens
- Roles: administrator, moderator, member
- Public/private pins — guests see only public pins
- Matrix widget integration (auto-login via OpenID)
- Realtime sync across sessions (Supabase Realtime)

## Prerequisites

- [Rust](https://rustup.rs) + `wasm-pack` (`cargo install wasm-pack`)
- [Node.js](https://nodejs.org) 18+
- [Supabase](https://supabase.com) project

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd team-pins
npm install
```

### 2. Configure Supabase

Copy `.env.example` or create `.env`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Run `supabase-schema.sql` in your Supabase SQL Editor to create all tables and RLS policies.

Create an account with supabase. On the left hand side look for the [>] icon.
Paste the contents of supabase-schema.sql into the SQL editor.

Enable auth providers in Supabase: **Email/Password** (disable email confirmation for testing).

### 3. Build WASM

```bash
cd core
wasm-pack build --target web
cd ..
```

### 4. Dev server

```bash
npm run dev
```

Opens at `http://localhost:5173`. Map loads immediately. Sign in to create pins.

### 5. Production build

```bash
npm run build
```

Serves from `dist/`. Pair with any static file server.

## Matrix Widget

The app can run as a widget inside Element and other Matrix clients.

### Widget mode

Add to a room: `/addwidget https://yourserver.com/?widget`

### Auth proxy

The proxy (`map-proxy/`) handles both hosting and Matrix OpenID

```
cd map-proxy
cargo run --release
```

Serves static files from `../team-pins/dist/` and the `/auth` endpoint on port 3030.

Replace `CHANGE_ME` in `src/main.rs` with your Supabase JWT secret (Settings → API → JWT Secret) or set it as an environoment variable.

### Cloudflare

Point a domain at `localhost:3030` via Cloudflare Tunnel or Cloudflare Workers.

## Roles and access

| Role | View private | Create pins | Release pins | Manage team |
|---|---|---|---|---|
| Guest (no auth) | Public only | No | No | No |
| Member | All | Yes | No | No |
| Moderator | All | Yes | Yes | No |
| Administrator | All | Yes | Yes | Yes |

First user to join a team becomes administrator. Invite tokens control membership for protected teams.

## Database tables

| Table | Purpose |
|---|---|
| `encrypted_pins` | ChaCha20Poly1305-encrypted pin data |
| `encrypted_drawings` | Encrypted GeoJSON shapes |
| `team_secrets` | X25519 keypair per team |
| `team_dek` | ECIES-wrapped data encryption key |
| `team_members` | User membership and roles |
| `team_settings` | Per-team configuration |
| `team_invites` | Single-use join tokens |

## Project structure

```
team-pins/
├── index.html              # SPA shell
├── main.js                 # Application logic
├── widget.js               # Matrix Widget API client
├── style.css               # Layout and overlay styles
├── vite.config.js          # Vite config
├── supabase-schema.sql     # Full database schema
├── core/                   # Rust WASM crypto
│   ├── Cargo.toml
│   └── src/lib.rs
└── map-proxy/              # Matrix → Supabase auth proxy
    ├── Cargo.toml
    └── src/main.rs
```

## License

MIT
