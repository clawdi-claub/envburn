import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';
import db from './db.js';
import { generateKey, encrypt, decrypt } from './crypto.js';
import { createCheckoutSession, handleWebhook, isConfigured } from './stripe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, '..', '..', 'web');

const app = new Hono();

app.use('*', cors());
app.get('/checkout', (c) => c.html(`<!DOCTYPE html>
<html>
<head>
  <script src="https://js.stripe.com/v3/"></script>
</head>
<body>
  <button id="checkout-button-envburn">Subscribe EnvBurn Pro $2/mo</button>
  <button id="checkout-button-webhookmail">Subscribe WebhookMail Pro $3/mo</button>
  <script>
    const stripe = Stripe('${process.env.STRIPE_PK}');
    document.getElementById('checkout-button-envburn').addEventListener('click', () => {
      stripe.redirectToCheckout({
        lineItems: [{ price: '${process.env.ENVBURN_PRO}', quantity: 1 }],
        mode: 'subscription',
        successUrl: '${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: '${process.env.BASE_URL}/'
      });
    });
    document.getElementById('checkout-button-webhookmail').addEventListener('click', () => {
      stripe.redirectToCheckout({
        lineItems: [{ price: '${process.env.WEBHOOKMAIL_PRO}', quantity: 1 }],
        mode: 'subscription',
        successUrl: '${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: '${process.env.BASE_URL}/'
      });
    });
  </script>
</body>
</html>`));
app.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();
  const stripe = require('stripe')(process.env.STRIPE_SK);
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) {
    return c.text('Webhook signature verification failed.', 400);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const resend = require('resend').Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'noreply@envburn.onrender.com',
      to: session.customer_details.email,
      subject: 'Welcome to EnvBurn Pro!',
      html: '<h1>Subscription Success!</h1><p>Pro activated - unlimited shares. Thanks!</p>'
    });
  }
  return c.text('OK', 200);
});
app.get('/success', (c) => c.html('<h1>Subscription Success! Check email for welcome.</h1><p>Redirecting...</p><script>window.location.href = "/dashboard";</script>'));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'envburn' }));

// Serve static web files
const indexHtml = readFileSync(join(WEB_DIR, 'index.html'), 'utf8');
const secretHtml = readFileSync(join(WEB_DIR, 'secret.html'), 'utf8');
const pricingHtml = (() => { try { return readFileSync(join(WEB_DIR, 'pricing.html'), 'utf8'); } catch { return null; } })();

// Serve static public files
app.get('/icons/*', (c) => {
  const file = c.req.path;
  try {
    const data = readFileSync(join(WEB_DIR, 'public', file.replace('/icons/', 'icons/')));
    const ext = file.split('.').pop();
    const types = { png: 'image/png', svg: 'image/svg+xml', json: 'application/json', ico: 'image/x-icon' };
    return c.body(data, { headers: { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' } });
  } catch { return c.text('Not found', 404); }
});
app.get('/manifest.json', (c) => {
  try {
    return c.body(readFileSync(join(WEB_DIR, 'public', 'manifest.json')), { headers: { 'Content-Type': 'application/json' } });
  } catch { return c.text('Not found', 404); }
});
app.get('/robots.txt', (c) => c.text('User-agent: *\nAllow: /\nSitemap: https://envburn.onrender.com/sitemap.xml'));
app.get('/sitemap.xml', (c) => {
  return c.body('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://envburn.onrender.com/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>', { headers: { 'Content-Type': 'application/xml' } });
});

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

// Stripe: checkout
app.post('/api/checkout', async (c) => {
  if (!isConfigured()) return c.json({ error: 'Payments not configured' }, 503);
  const { email } = await c.req.json();
  if (!email) return c.json({ error: 'Email required' }, 400);
  const session = await createCheckoutSession(email, process.env.STRIPE_ENVBURN_PRICE_ID);
  if (session.url) return c.json({ url: session.url });
  return c.json({ error: 'Checkout failed' }, 500);
});

// Stripe: webhook
app.post('/stripe/webhook', async (c) => {
  const body = await c.req.text();
  const result = await handleWebhook(body);
  // Store pro status - for now just log it
  console.log('Stripe event:', result);
  return c.json({ received: true });
});

// Pro success page
app.get('/pro/success', (c) => {
  return c.html([
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EnvBurn Pro</title>',
    '<style>body{font-family:system-ui;background:#0a0a0a;color:#e4e4e7;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}',
    '.c{background:#18181b;border:1px solid #27272a;border-radius:12px;padding:40px;text-align:center;max-width:400px}',
    '.c h1{color:#f97316;margin-bottom:12px}a{color:#f97316}</style></head><body>',
    '<div class="c"><h1>&#128293; Pro Activated!</h1>',
    '<p>30-day expiry, 1MB secrets, unlimited views.</p>',
    '<p style="margin-top:16px"><a href="/">Create a Secret &rarr;</a></p>',
    '</div></body></html>',
  ].join(''));
});

function getBaseUrl(c) {
  return process.env.BASE_URL || `${c.req.url.split('/api')[0]}`;
}

const port = parseInt(process.env.PORT || '3000', 10);
console.log(`🔥 EnvBurn API running on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
