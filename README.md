# EnvBurn 🔥

Self-destructing secret sharing for developers. Like WeTransfer, but for your `.env` files.

## Features

- 🔐 **Client-side encryption** - Your secrets are encrypted with NaCl before leaving your browser
- ⏳ **Auto-destruct** - Links expire after viewing or when the timer runs out
- 🚫 **Zero signup** - No accounts, no tracking, no hassle
- 🔥 **Burn after reading** - Each secret can be set to self-destruct on first view

## Quick Start

```bash
# Clone and install
git clone https://github.com/yourusername/envburn.git
cd envburn/api
npm install

# Run locally
npm start
```

Visit http://localhost:3000

## API Usage

### Create a secret

```bash
curl -X POST http://localhost:3000/api/secrets \
  -H "Content-Type: application/json" \
  -d '{"content": "DATABASE_URL=postgres://...", "ttl": 3600, "views": 1}'
```

Response:
```json
{
  "id": "abc123",
  "key": "encryptionKey",
  "url": "http://localhost:3000/s/abc123#encryptionKey",
  "expiresAt": "2026-02-27T20:56:17.000Z"
}
```

### Retrieve a secret

```bash
curl "http://localhost:3000/api/secrets/abc123?key=encryptionKey"
```

## Deployment

### Render (Free Tier)

1. Fork this repo
2. Create a new Web Service on Render
3. Connect your forked repo
4. Deploy!

Or use `render.yaml` for blueprint deployment.

### Docker

```bash
docker build -t envburn .
docker run -p 3000:3000 -v envburn-data:/app/data envburn
```

## Tech Stack

- **Backend**: Node.js + Hono + SQLite
- **Encryption**: NaCl (tweetnacl)
- **Frontend**: Vanilla HTML/JS
- **Deployment**: Docker + Render

## Pricing (Planned)

- **Free**: 10 secret shares/month
- **Pro ($9/mo)**: Unlimited shares, custom TTL
- **Team ($29/mo)**: Audit logs, CLI tool, priority support

## License

MIT
