# 🔥 EnvBurn

Self-destructing secret sharing for developers.

## What is EnvBurn?

EnvBurn lets you share sensitive data (like .env files, API keys, passwords) using one-time, self-destructing links.

- **Zero-knowledge**: Keys are never stored on the server
- **Self-destructing**: Secrets burn after reading or when they expire
- **No signup required**: Paste, share, done

## Quick Start

### Docker

```bash
docker-compose up --build
```

### Fly.io

```bash
fly launch
fly deploy
```

### Local Development

```bash
cd api
npm install
npm start
```

## API

### Create Secret

```bash
POST /api/secrets
Content-Type: application/json

{
  "content": "API_KEY=secret123",
  "ttl": 3600,        // seconds (default: 1 hour)
  "views": 1,         // max views (default: 1)
  "burnAfterRead": true
}
```

Response:
```json
{
  "id": "abc123",
  "key": "encryption-key-here",
  "url": "https://envburn.dev/s/abc123#key",
  "expiresAt": "2026-02-27T..."
}
```

### Retrieve Secret

```bash
GET /api/secrets/:id?key=encryption-key-here
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `BASE_URL` - Public URL for generated links
- `DB_PATH` - SQLite database path

## Tech Stack

- Node.js + Hono (API)
- SQLite (Database)
- TweetNaCl (Encryption)
- Vanilla HTML/JS (Frontend)
