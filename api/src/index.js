import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';
import db, { getSubscriber, upsertSubscriber, downgradeByCustomerId, isPro } from './db.js';
import { generateKey, encrypt, decrypt } from './crypto.js';
import { createCheckoutSession, parseWebhookEvent, isConfigured } from './stripe.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var WEB_DIR = join(__dirname, '..', '..', 'web');
var BASE_URL = process.env.BASE_URL || 'https://envburn.onrender.com';

var app = new Hono();
app.use('*', cors());

// --- Limits ---
var LIMITS = {
  free:  { maxSize: 100000, maxTTL: 7 * 86400, maxViews: 100 },
  pro:   { maxSize: 1000000, maxTTL: 30 * 86400, maxViews: 10000 },
};

function getLimits(email) {
  return isPro(email) ? LIMITS.pro : LIMITS.free;
}

// --- Static files ---
app.get('/icons/*', function(c) {
  try {
    var data = readFileSync(join(WEB_DIR, 'public', c.req.path.slice(1)));
    var ext = c.req.path.split('.').pop();
    var types = { png: 'image/png', svg: 'image/svg+xml', json: 'application/json' };
    return c.body(data, { headers: { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' } });
  } catch (e) { return c.text('Not found', 404); }
});
app.get('/manifest.json', function(c) {
  try { return c.body(readFileSync(join(WEB_DIR, 'public', 'manifest.json')), { headers: { 'Content-Type': 'application/json' } }); }
  catch (e) { return c.text('Not found', 404); }
});
app.get('/robots.txt', function(c) { return c.text('User-agent: *\nAllow: /\nSitemap: ' + BASE_URL + '/sitemap.xml'); });
app.get('/sitemap.xml', function(c) {
  return c.body('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>' + BASE_URL + '/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>', { headers: { 'Content-Type': 'application/xml' } });
});

// --- Pages ---
var indexHtml = readFileSync(join(WEB_DIR, 'index.html'), 'utf8');
var secretHtml = readFileSync(join(WEB_DIR, 'secret.html'), 'utf8');
var pricingHtml = (function() { try { return readFileSync(join(WEB_DIR, 'pricing.html'), 'utf8'); } catch (e) { return null; } })();

app.get('/', function(c) { return c.html(indexHtml); });
app.get('/s/:id', function(c) { return c.html(secretHtml); });
if (pricingHtml) app.get('/pricing', function(c) { return c.html(pricingHtml); });
app.get('/health', function(c) { return c.json({ status: 'ok', service: 'envburn' }); });

// --- Check Pro status ---
app.get('/api/account/:email', function(c) {
  var email = decodeURIComponent(c.req.param('email')).toLowerCase();
  var sub = getSubscriber(email);
  return c.json({
    email: email,
    tier: sub ? sub.tier : 'free',
    limits: getLimits(email),
  });
});

// --- Create a secret ---
app.post('/api/secrets', async function(c) {
  var body = await c.req.json();
  var content = body.content;
  var email = body.email ? body.email.toLowerCase().trim() : null;
  var ttl = body.ttl || 3600;
  var views = body.views || 1;
  var burnAfterRead = body.burnAfterRead !== undefined ? body.burnAfterRead : true;

  if (!content || typeof content !== 'string') {
    return c.json({ error: 'content is required' }, 400);
  }

  var limits = getLimits(email);

  if (content.length > limits.maxSize) {
    return c.json({ error: 'Content too large (max ' + Math.round(limits.maxSize / 1000) + 'KB). Upgrade to Pro for 1MB.' }, 400);
  }

  var safeTTL = Math.min(Math.max(ttl, 300), limits.maxTTL);
  var safeViews = Math.min(Math.max(views, 1), limits.maxViews);

  var id = nanoid(12);
  var key = generateKey();
  var result = encrypt(content, key);

  var expiresAt = Math.floor(Date.now() / 1000) + safeTTL;

  db.prepare(
    'INSERT INTO secrets (id, encrypted_data, nonce, burn_after_read, expires_at, views_remaining, owner_email) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, result.encrypted, result.nonce, burnAfterRead ? 1 : 0, expiresAt, safeViews, email);

  var shareUrl = getBaseUrl(c) + '/s/' + id + '#' + key;

  return c.json({
    id: id,
    key: key,
    url: shareUrl,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    burnAfterRead: burnAfterRead,
    viewsRemaining: safeViews,
    tier: isPro(email) ? 'pro' : 'free',
  }, 201);
});

// --- Retrieve a secret ---
app.get('/api/secrets/:id', function(c) {
  var id = c.req.param('id');
  var key = c.req.query('key');
  if (!key) return c.json({ error: 'key is required' }, 400);

  var row = db.prepare(
    'SELECT * FROM secrets WHERE id = ? AND expires_at > unixepoch() AND burned_at IS NULL AND views_remaining > 0'
  ).get(id);

  if (!row) return c.json({ error: 'Secret not found, expired, or already burned' }, 404);

  var plaintext;
  try { plaintext = decrypt(row.encrypted_data, row.nonce, key); }
  catch (e) { return c.json({ error: 'Invalid decryption key' }, 403); }

  var newViews = row.views_remaining - 1;
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

// --- Check existence ---
app.get('/api/secrets/:id/exists', function(c) {
  var id = c.req.param('id');
  var row = db.prepare(
    'SELECT id FROM secrets WHERE id = ? AND expires_at > unixepoch() AND burned_at IS NULL AND views_remaining > 0'
  ).get(id);
  return c.json({ exists: !!row }, row ? 200 : 404);
});

// --- Delete ---
app.delete('/api/secrets/:id', function(c) {
  var id = c.req.param('id');
  var result = db.prepare('UPDATE secrets SET burned_at = unixepoch(), views_remaining = 0 WHERE id = ? AND burned_at IS NULL').run(id);
  return result.changes > 0
    ? c.json({ burned: true })
    : c.json({ error: 'Secret not found or already burned' }, 404);
});

// --- Stripe: upgrade ---
app.post('/api/upgrade', async function(c) {
  if (!isConfigured()) return c.json({ error: 'Payments not configured' }, 503);
  var body = await c.req.json();
  var email = body.email;
  if (!email) return c.json({ error: 'Email required' }, 400);
  var session = await createCheckoutSession(email.toLowerCase().trim(), process.env.STRIPE_PRICE_ID);
  if (session.url) return c.json({ url: session.url });
  return c.json({ error: session.error || 'Checkout failed', detail: session }, 500);
});

// --- Stripe: webhook ---
app.post('/stripe/webhook', async function(c) {
  var body = await c.req.text();
  var ev = parseWebhookEvent(body);

  if (ev.action === 'activate') {
    upsertSubscriber(ev.email, ev.customerId, ev.subscriptionId, 'pro');
    console.log('Pro activated:', ev.email);
  } else if (ev.action === 'deactivate') {
    downgradeByCustomerId(ev.customerId);
    console.log('Pro deactivated:', ev.customerId);
  }

  return c.json({ received: true });
});

// --- Pro success page ---
app.get('/pro/success', function(c) {
  return c.html([
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>EnvBurn Pro</title>',
    '<style>body{font-family:system-ui;background:#0f0f0f;color:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}',
    '.c{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:48px;text-align:center;max-width:420px}',
    'h1{background:linear-gradient(135deg,#ff6b6b,#feca57);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:16px}',
    'p{color:#aaa;line-height:1.6}a{color:#feca57}</style></head><body>',
    '<div class="c"><h1>Pro Activated!</h1>',
    '<p>30-day expiry, 1MB secrets, unlimited views.<br>Use the same email when creating secrets to unlock Pro limits.</p>',
    '<p style="margin-top:20px"><a href="/">Create a Secret &rarr;</a></p>',
    '</div></body></html>',
  ].join(''));
});

function getBaseUrl(c) {
  return process.env.BASE_URL || c.req.url.split('/api')[0];
}

var port = parseInt(process.env.PORT || '3000', 10);
console.log('EnvBurn running on http://localhost:' + port);
serve({ fetch: app.fetch, port: port });
