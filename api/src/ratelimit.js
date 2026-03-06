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
    var ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    ip = ip.split(',')[0].trim();
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
