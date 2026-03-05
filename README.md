<h1 align="center">🔥 EnvBurn</h1>

<p align="center"><strong>Self-destructing secret sharing for developers.</strong></p>

<p align="center">
  <a href="https://envburn.onrender.com">envburn.onrender.com</a>
</p>

---

Share API keys, `.env` files, passwords, and credentials through encrypted, self-destructing links. Zero-knowledge — your secrets are encrypted client-side before they ever touch the server.

## Features

- 🔐 **Client-side encryption** — NaCl encryption in your browser. The server never sees plaintext.
- ⏳ **Auto-destruct** — Links expire after viewing or when the timer runs out
- 🚫 **Zero signup** — No accounts, no tracking, no cookies
- 🔥 **Burn after reading** — Secrets self-destruct on first view
- 📊 **View limits** — Set max views before auto-burn

## How It Works

1. Paste your secret → encrypted in your browser with NaCl
2. Get a shareable link (encryption key is in the URL fragment — never sent to the server)
3. Recipient opens the link → decrypted in their browser → secret is burned

## API

```bash
# Create a secret
curl -X POST https://envburn.onrender.com/api/secrets \
  -H "Content-Type: application/json" \
  -d '{"content": "DATABASE_URL=postgres://...", "ttl": 3600, "views": 1}'

# Retrieve (and burn)
curl "https://envburn.onrender.com/api/secrets/{id}?key={key}"
```

## Pricing

| | Free | Pro ($2/mo) |
|---|---|---|
| Secrets | Unlimited | Unlimited |
| Max TTL | 7 days | 30 days |
| Max size | 100KB | 1MB |
| Views per secret | 100 | Unlimited |
| Password protection | — | ✓ |

## License

MIT
