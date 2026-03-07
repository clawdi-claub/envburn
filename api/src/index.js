import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { nanoid } from 'nanoid';
import db, { getSubscriber, upsertSubscriber, downgradeByCustomerId, isPro, isEventProcessed, markEventProcessed, generateProCode, setProCode, getProCode, verifyProCode } from './db.js';
import { generateKey, encrypt, decrypt } from './crypto.js';
import { createCheckoutSession, parseWebhookEvent, isConfigured, stripeRequest } from './stripe.js';
import { rateLimit } from './ratelimit.js';

import { Resend } from 'resend';

var __dirname = dirname(fileURLToPath(import.meta.url));

async function sendProCodeEmail(email, code) {
  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.log('RESEND_API_KEY not set, skipping email. Pro code for', email, ':', code); return; }
  var resend = new Resend(apiKey);
  await resend.emails.send({
    from: 'EnvBurn <noreply@envburn.com>',
    to: email,
    subject: 'Your EnvBurn Pro Code',
    html: [
      '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0F172A;color:#F8FAFC;border-radius:12px">',
      '<h1 style="font-size:20px;margin:0 0 8px">Your Pro Code</h1>',
      '<p style="color:#CBD5E1;font-size:14px;margin:0 0 24px">Use this code with your email to unlock Pro features.</p>',
      '<div style="background:#1E293B;border:1px solid #334155;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px">',
      '<span style="font-size:32px;font-weight:800;letter-spacing:8px;color:#22C55E">' + code + '</span>',
      '</div>',
      '<p style="color:#64748B;font-size:12px;margin:0">Keep this code safe. You\'ll need it each time you use EnvBurn with your Pro email.</p>',
      '</div>',
    ].join(''),
  });
}
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
  free:  { maxSize: 100000, maxTTL: 3600, maxViews: 3 },
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

// --- Check Pro status (requires email + pro_code for Pro unlock) ---
app.post('/api/account/check', async function(c) {
  var body = await c.req.json();
  var email = body.email ? body.email.toLowerCase().trim() : null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return c.json({ error: 'Valid email required' }, 400);
  var proCode = body.pro_code ? String(body.pro_code).trim() : null;
  var hasPro = isPro(email);
  // Pro requires valid code
  if (hasPro && proCode && verifyProCode(email, proCode)) {
    return c.json({ tier: 'pro', limits: getLimits(email), needsCode: false });
  }
  if (hasPro && !proCode) {
    return c.json({ tier: 'pending_code', limits: getLimits(null), needsCode: true });
  }
  if (hasPro && proCode && !verifyProCode(email, proCode)) {
    return c.json({ tier: 'pending_code', limits: getLimits(null), needsCode: true, error: 'Invalid Pro code' });
  }
  return c.json({ tier: 'free', limits: getLimits(email), needsCode: false });
});

// GET /api/account/:email - Check tier by email (for client-side validation)
app.get('/api/account/:email', async function(c) {
  var email = c.req.param('email');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return c.json({ error: 'Valid email required' }, 400);
  }
  email = email.toLowerCase().trim();
  return c.json({
    tier: isPro(email) ? 'pro' : 'free',
    limits: getLimits(email),
  });
});

// --- Create a secret ---
app.post('/api/secrets', async function(c) {
  var body = await c.req.json();
  var content = body.content;
  var rawEmail = body.email ? body.email.toLowerCase().trim() : null;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var email = (rawEmail && EMAIL_RE.test(rawEmail)) ? rawEmail : null;
  var proCode = body.pro_code ? String(body.pro_code).trim() : null;
  // Only grant Pro limits if valid code provided
  var effectiveEmail = (email && proCode && verifyProCode(email, proCode)) ? email : null;
  var ttl = body.ttl || 3600;
  var views = body.views || 1;
  var burnAfterRead = body.burnAfterRead !== undefined ? body.burnAfterRead : true;

  if (!content || typeof content !== 'string') {
    return c.json({ error: 'content is required' }, 400);
  }

  var limits = getLimits(effectiveEmail);

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
    tier: effectiveEmail ? 'pro' : 'free',
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
      // Fetch customer email from Stripe
      var email = null;
      try {
        var customer = await stripeRequest('/customers/' + ev.customerId, 'GET');
        email = customer.email ? customer.email.toLowerCase().trim() : null;
      } catch (e) { console.error('Failed to fetch customer email:', e.message); }
      if (!email) {
        console.error('No email found for customer:', ev.customerId);
        if (ev.eventId) markEventProcessed(ev.eventId);
        return c.json({ received: true, error: 'no_email' });
      }
      upsertSubscriber(email, ev.customerId, ev.subscriptionId, 'pro');
      var code = generateProCode();
      setProCode(email, code);
      console.log('Pro activated:', email, 'code:', code);
      // Send pro code via email (best-effort)
      sendProCodeEmail(email, code).catch(function(e) { console.error('Failed to send pro code email:', e.message); });
    } else if (ev.action === 'deactivate') {
      downgradeByCustomerId(ev.customerId);
      console.log('Pro deactivated:', ev.customerId);
    } else if (ev.action === 'reactivate') {
      // Re-activate: find subscriber by customer ID, set back to pro
      var row = db.prepare('SELECT email FROM subscribers WHERE stripe_customer_id = ?').get(ev.customerId);
      if (row) {
        upsertSubscriber(row.email, ev.customerId, ev.subscriptionId, 'pro');
        console.log('Pro reactivated:', row.email);
      }
    } else if (ev.action === 'payment_failed') {
      console.log('Payment failed for customer:', ev.customerId, '— waiting for subscription status change');
    }

    if (ev.eventId) markEventProcessed(ev.eventId);
    return c.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    return c.json({ error: 'webhook_config_error', message: err.message }, 503);
  }
});

// --- Pro success page ---
app.get('/pro/success', async function(c) {
  // Try to get pro code from session
  var sessionId = c.req.query('session_id');
  var proCode = '';
  var proEmail = '';
  if (sessionId && process.env.STRIPE_SECRET_KEY) {
    try {
      var Stripe = (await import('stripe')).default;
      var stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      var session = await stripe.checkout.sessions.retrieve(sessionId);
      proEmail = session.customer_email || session.customer_details?.email || '';
      if (proEmail) {
        var stored = getProCode(proEmail.toLowerCase().trim());
        if (stored) proCode = stored;
      }
    } catch(e) { console.error('Failed to retrieve checkout session:', e.message); }
  }
  return c.html([
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EnvBurn Pro — Activated</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">',
    '<style>',
    ':root{--bg:#0F172A;--surface:#1E293B;--border:#334155;--text:#F8FAFC;--text-secondary:#CBD5E1;--text-muted:#64748B;--accent:#22C55E;--accent-subtle:rgba(34,197,94,0.1);--radius-lg:16px}',
    '*{margin:0;padding:0;box-sizing:border-box}',
    'body{font-family:"Plus Jakarta Sans",system-ui,sans-serif;background:var(--bg);color:var(--text);display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}',
    '.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:48px;text-align:center;max-width:480px;width:100%;animation:fadeIn .4s ease}',
    '.icon{width:64px;height:64px;background:var(--accent-subtle);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}',
    '.icon svg{color:var(--accent);width:32px;height:32px}',
    'h1{font-size:1.5rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px}',
    '.badge{display:inline-block;background:var(--accent);color:var(--bg);font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:20px;letter-spacing:0.02em}',
    '.features{list-style:none;text-align:left;margin:20px 0;padding:0}',
    '.features li{color:var(--text-secondary);font-size:14px;padding:8px 0;border-bottom:1px solid rgba(51,65,85,0.5);display:flex;align-items:center;gap:10px}',
    '.features li:last-child{border-bottom:none}',
    '.features li svg{color:var(--accent);width:16px;height:16px;flex-shrink:0}',
    '.note{color:var(--text-muted);font-size:13px;margin-top:20px;line-height:1.6}',
    '.cta{display:inline-flex;align-items:center;gap:8px;margin-top:24px;padding:12px 28px;background:var(--accent);color:var(--bg);font-size:14px;font-weight:700;font-family:"Plus Jakarta Sans",system-ui,sans-serif;border:none;border-radius:10px;text-decoration:none;cursor:pointer;transition:background .2s}',
    '.cta:hover{background:#16A34A}',
    '@keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}',
    '</style></head><body>',
    '<div class="card">',
    '<div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>',
    '<span class="badge">PRO ACTIVATED</span>',
    '<h1>You\'re all set!</h1>',
    '<ul class="features">',
    '<li><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> 30-day secret expiry</li>',
    '<li><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Up to 1MB secret size</li>',
    '<li><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Up to 10,000 views per secret</li>',
    '<li><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Password protection</li>',
    '</ul>',
    (proCode ? [
      '<div style="background:#1E293B;border:1px solid #334155;border-radius:10px;padding:20px;margin:20px 0;text-align:center">',
      '<p style="color:#64748B;font-size:12px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Your Pro Code</p>',
      '<span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#22C55E">' + proCode + '</span>',
      '<p style="color:#64748B;font-size:12px;margin:10px 0 0">Save this code — you\'ll need it to unlock Pro features.</p>',
      '</div>',
    ].join('') : ''),
    '<p class="note">Use your email and Pro code when creating secrets to unlock Pro limits.' + (proCode ? ' We\'ve also emailed you the code.' : '') + '</p>',
    '<a href="/" class="cta"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg> Create a Secret</a>',
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
