// Simple in-memory rate limiter
// window: time window in ms, max: max requests per window
var store = new Map();
var MAX_ENTRIES = parseInt(process.env.RATE_LIMIT_MAX_ENTRIES || '10000', 10);

// Cleanup interval: 60s, configurable via env
var CLEANUP_INTERVAL_MS = parseInt(process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS || '60000', 10);

setInterval(function() {
  var now = Date.now();
  store.forEach(function(v, k) {
    if (now - v.start > v.window) store.delete(k);
  });
  // Prevent memory leak: evict oldest entries if over cap
  if (store.size > MAX_ENTRIES) {
    var entries = Array.from(store.entries());
    entries.sort(function(a, b) { return a[1].start - b[1].start; });
    var toDelete = entries.slice(0, entries.length - MAX_ENTRIES);
    toDelete.forEach(function(e) { store.delete(e[0]); });
  }
}, CLEANUP_INTERVAL_MS);

export function rateLimit(opts) {
  var windowMs = opts.window || 60000;
  var max = opts.max || 60;
  var message = opts.message || 'Too many requests';

  return async function(c, next) {
    // Use x-forwarded-for only behind trusted proxy (Render sets this); take first IP
    var xff = c.req.header('x-forwarded-for');
    var ip = xff ? xff.split(',')[0].trim() : (c.req.header('x-real-ip') || 'unknown');
    // Normalize IPv6-mapped IPv4
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    var key = opts.prefix + ':' + ip;
    var now = Date.now();

    var entry = store.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { count: 0, start: now, window: windowMs };
      store.set(key, entry);
    }
    entry.count++;

    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      return c.json({ error: message }, 429);
    }
    await next();
  };
}
