# QuickHelp

Lightweight 1:1 screen sharing for tech support. No accounts, no plugins — just share a link and go.

Built with Node.js, WebRTC, and WebSockets. Zero runtime dependencies beyond `ws`.

## How it works

1. One person clicks **Create Room** to generate a session link and room code.
2. They share the link (or code) with the other person, who joins via the link or clicks **Join Room** and enters the code.
3. Once both are connected, either person can share their screen, toggle their microphone, or open the chat.

Rooms are ephemeral — created on demand and deleted when both participants disconnect.

## Running locally

```bash
npm install
npm run dev       # starts on http://localhost:8383 with --watch
```

## Running with Docker

```bash
docker compose up --build
```

The app listens on port `8383` by default. Set `BASE_URL` to your public hostname so generated room links are correct:

```bash
BASE_URL=https://share.example.com docker compose up -d
```

## TURN server (optional)

WebRTC works peer-to-peer, but clients behind strict NAT or firewalls may need a TURN relay. Configure one via environment variables:

**coturn `use_auth_secret` mode (recommended):**

| Variable | Description |
|---|---|
| `TURN_URLS` | Comma-separated TURN/TURNS endpoints |
| `TURN_SECRET` | Shared secret — the server generates short-lived HMAC credentials automatically |

**Static credentials:**

| Variable | Description |
|---|---|
| `TURN_URLS` | Comma-separated TURN/TURNS endpoints |
| `TURN_USERNAME` | TURN username |
| `TURN_CREDENTIAL` | TURN password |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8383` | HTTP listen port |
| `BASE_URL` | `http://localhost:{PORT}` | Public base URL for room links |
| `TURN_URLS` | — | TURN/TURNS server endpoints |
| `TURN_SECRET` | — | coturn shared secret (HMAC credential mode) |
| `TURN_USERNAME` | — | TURN username (static credential mode) |
| `TURN_CREDENTIAL` | — | TURN password (static credential mode) |
