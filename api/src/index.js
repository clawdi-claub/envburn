import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';
import db, { getSubscriber, upsertSubscriber, downgradeByCustomerId, isPro, isEventProcessed, markEventProcessed } from './db.js';
import { generateKey, encrypt, decrypt } from './crypto.js';
import { createCheckoutSession, parseWebhookEvent, isConfigured } from './stripe.js';
import { rateLimit } from './ratelimit.js';

var __dirname = dirname(fileURLToPath(import.meta.url));
var WEB_DIR = join(__dirname, '..', '..', 'web');
var BASE_URL = process.env.BASE_URL || 'https://envburn.onrender.com';

var app = new Hono();

// Request logging middleware
app.use('*', async function(c, next) {
  var start = Date.now();
  await next();
  if (process.env.NODE_ENV !== 'test') {
    console.log('[%s] %s %s %sms %s',
      new Date().toISOString(),
      c.req.method,
      c.req.path,
      Date.now() - start,
      c.res.status
    );
  }
});

// Security headers
app.use('*', async function(c, next) {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// Body size limit (1MB)
app.use('*', async function(c, next) {
  var cl = c.req.header('content-length');
  if (cl && parseInt(cl) > 1048576) {
    return c.json({ error: 'Request too large' }, 413);
  }
  await next();
});

// CORS: restrict to same origin in production
app.use('/api/*', cors({
  origin: function(origin) {
    if (!origin) return true; // Allow non-browser requests (curl, server-to-server)
    if (origin === BASE_URL) return true;
    if (process.env.NODE_ENV !== 'production') return true;
    return false; // Explicitly deny other origins in production
  },
  allowMethods: ['GET', 'POST', 'DELETE'],
}));

// Rate limits
app.use('/api/secrets', rateLimit({ prefix: 'create', window: 3600000, max: 50, message: 'Too many secrets created. Try again later.' }));
app.use('/api/upgrade', rateLimit({ prefix: 'upgrade', window: 60000, max: 10, message: 'Too many requests.' }));

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
app.get('/health', function(c) {
  var dbOk = true;
  try { db.prepare('SELECT 1').get(); } catch (e) { dbOk = false; }
  var stripeOk = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET);
  var status = dbOk && stripeOk ? 'ok' : 'degraded';
  return c.json({
    status: status,
    service: 'envburn',
    db: dbOk ? 'ok' : 'error',
    stripe: stripeOk ? 'configured' : 'unconfigured',
  }, dbOk && stripeOk ? 200 : 503);
});

// --- Check Pro status (requires email in query, only returns tier + limits, no PII) ---
app.post('/api/account/check', async function(c) {
  var body = await c.req.json();
  var email = body.email ? body.email.toLowerCase().trim() : null;
  if (!email) return c.json({ error: 'Email required' }, 400);
  return c.json({
    tier: isPro(email) ? 'pro' : 'free',
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

// --- Delete (requires valid decryption key as proof of ownership) ---
app.delete('/api/secrets/:id', function(c) {
  var id = c.req.param('id');
  var key = c.req.query('key');
  if (!key) return c.json({ error: 'key is required for deletion' }, 400);

  var row = db.prepare(
    'SELECT encrypted_data, nonce FROM secrets WHERE id = ? AND burned_at IS NULL'
  ).get(id);
  if (!row) return c.json({ error: 'Secret not found or already burned' }, 404);

  try { decrypt(row.encrypted_data, row.nonce, key); }
  catch (e) { return c.json({ error: 'Invalid key — unauthorized' }, 403); }

  db.prepare('UPDATE secrets SET burned_at = unixepoch(), views_remaining = 0 WHERE id = ?').run(id);
  return c.json({ burned: true });
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
  try {
    var body = await c.req.text();
    var sig = c.req.header('stripe-signature');
    var ev = parseWebhookEvent(body, sig);

    if (ev.action === 'rejected') {
      return c.json({ error: ev.reason }, 400);
    }

    // Idempotency: skip already-processed events
    if (ev.eventId && isEventProcessed(ev.eventId)) {
      return c.json({ received: true, duplicate: true });
    }

    if (ev.action === 'activate') {
      upsertSubscriber(ev.email, ev.customerId, ev.subscriptionId, 'pro');
      console.log('Pro activated:', ev.email);
    } else if (ev.action === 'deactivate') {
      downgradeByCustomerId(ev.customerId);
      console.log('Pro deactivated:', ev.customerId);
    }

    if (ev.eventId) markEventProcessed(ev.eventId);
    return c.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    return c.json({ error: 'webhook_config_error', message: err.message }, 503);
  }
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

// CRITICAL: Fail fast in production if Stripe webhook secret is missing
if (process.env.NODE_ENV === 'production' && !process.env.STRIPE_WEBHOOK_SECRET) {
  console.error('FATAL: STRIPE_WEBHOOK_SECRET not configured in production. Refusing to start.');
  process.exit(1);
}

var port = parseInt(process.env.PORT || '3000', 10);
console.log('EnvBurn running on http://localhost:' + port);
serve({ fetch: app.fetch, port: port, hostname: '0.0.0.0' });
