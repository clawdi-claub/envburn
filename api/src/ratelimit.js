// Simple in-memory rate limiter
// window: time window in ms, max: max requests per window
var store = new Map();

setInterval(function() {
  var now = Date.now();
  store.forEach(function(v, k) {
    if (now - v.start > v.window) store.delete(k);
  });
}, 60000);

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
