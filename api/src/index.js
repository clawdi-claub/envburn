import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';
import db from './db.js';
import { generateKey, encrypt, decrypt } from './crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, '..', '..', 'web');

const app = new Hono();

app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'envburn' }));

// Serve static web files
const indexHtml = readFileSync(join(WEB_DIR, 'index.html'), 'utf8');
const secretHtml = readFileSync(join(WEB_DIR, 'secret.html'), 'utf8');
const pricingHtml = (() => { try { return readFileSync(join(WEB_DIR, 'pricing.html'), 'utf8'); } catch { return null; } })();

app.get('/', (c) => c.html(indexHtml));
app.get('/s/:id', (c) => c.html(secretHtml));
if (pricingHtml) app.get('/pricing', (c) => c.html(pricingHtml));

// Create a secret
app.post('/api/secrets', async (c) => {
  const body = await c.req.json();
  const { content, ttl = 3600, views = 1, burnAfterRead = true } = body;

  if (!content || typeof content !== 'string') {
    return c.json({ error: 'content is required' }, 400);
  }

  if (content.length > 100_000) {
    return c.json({ error: 'content too large (max 100KB)' }, 400);
  }

  const maxTTL = 7 * 24 * 3600; // 7 days max
  const safeTTL = Math.min(Math.max(ttl, 300), maxTTL); // 5min to 7 days
  const safeViews = Math.min(Math.max(views, 1), 100);

  const id = nanoid(12);
  const key = generateKey();
  const { encrypted: encryptedData, nonce } = encrypt(content, key);

  const expiresAt = Math.floor(Date.now() / 1000) + safeTTL;

  db.prepare(`
    INSERT INTO secrets (id, encrypted_data, nonce, burn_after_read, expires_at, views_remaining)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, encryptedData, nonce, burnAfterRead ? 1 : 0, expiresAt, safeViews);

  // Return the ID + key. Key is NEVER stored server-side.
  const shareUrl = `${getBaseUrl(c)}/s/${id}#${key}`;

  return c.json({
    id,
    key,
    url: shareUrl,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    burnAfterRead,
    viewsRemaining: safeViews,
  }, 201);
});

// Retrieve (and optionally burn) a secret
app.get('/api/secrets/:id', (c) => {
  const { id } = c.req.param();
  const key = c.req.query('key');

  if (!key) {
    return c.json({ error: 'key is required' }, 400);
  }

  const row = db.prepare(`
    SELECT * FROM secrets
    WHERE id = ? AND expires_at > unixepoch() AND burned_at IS NULL AND views_remaining > 0
  `).get(id);

  if (!row) {
    return c.json({ error: 'Secret not found, expired, or already burned' }, 404);
  }

  let plaintext;
  try {
    plaintext = decrypt(row.encrypted_data, row.nonce, key);
  } catch {
    return c.json({ error: 'Invalid decryption key' }, 403);
  }

  // Decrement views / burn
  const newViews = row.views_remaining - 1;
  if (newViews <= 0 || row.burn_after_read) {
    db.prepare('UPDATE secrets SET burned_at = unixepoch(), views_remaining = 0 WHERE id = ?').run(id);
  } else {
    db.prepare('UPDATE secrets SET views_remaining = ? WHERE id = ?').run(newViews, id);
  }

  return c.json({
    content: plaintext,
    burned: newViews <= 0 || !!row.burn_after_read,
    viewsRemaining: Math.max(0, newViews),
  });
});

// Check if secret exists (without revealing content)
app.get('/api/secrets/:id/exists', (c) => {
  const { id } = c.req.param();
  const row = db.prepare(`
    SELECT id FROM secrets
    WHERE id = ? AND expires_at > unixepoch() AND burned_at IS NULL AND views_remaining > 0
  `).get(id);

  return c.json({ exists: !!row }, row ? 200 : 404);
});

// Delete a secret manually
app.delete('/api/secrets/:id', (c) => {
  const { id } = c.req.param();
  const result = db.prepare('UPDATE secrets SET burned_at = unixepoch(), views_remaining = 0 WHERE id = ? AND burned_at IS NULL').run(id);
  return result.changes > 0
    ? c.json({ burned: true })
    : c.json({ error: 'Secret not found or already burned' }, 404);
});

function getBaseUrl(c) {
  return process.env.BASE_URL || `${c.req.url.split('/api')[0]}`;
}

const port = parseInt(process.env.PORT || '3000', 10);
console.log(`🔥 EnvBurn API running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
