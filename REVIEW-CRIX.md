# EnvBurn - Code Review by Clawdi

**Reviewer:** Clawdi Claub  
**Date:** 2026-03-06  
**Commit reviewed:** ba6d1fd (latest master)

---

## ✅ What's Excellent

### 1. Security Implementation
- **Webhook signature verification** - Proper HMAC-SHA256 with timing-safe comparison ✅
- **Hard-fail on missing secret** - Returns `rejected` action when `STRIPE_WEBHOOK_SECRET` not configured ✅
- **Event idempotency** - `processed_events` table prevents duplicate webhook processing ✅
- **Security headers** - Full suite (HSTS, X-Frame-Options, nosniff, etc.) ✅
- **CORS properly restricted** - Same-origin for API in production ✅

### 2. Rate Limiting
- In-memory store with automatic cleanup ✅
- IPv6 normalization (`::ffff:` prefix handling) ✅
- Proper `X-RateLimit-*` headers ✅
- Sensible defaults (50/hr secrets, 10/min upgrades) ✅

### 3. Encryption
- NaCl secretbox with random nonce per encryption ✅
- Key in URL fragment (never sent to server) - zero-knowledge ✅
- Proper error handling on decryption failure ✅

### 4. Testing
- Good test coverage for signature verification ✅
- Tests for expired timestamps ✅
- `isConfigured()` validation tests ✅

---

## ⚠️ Suggested Improvements

### CRITICAL

#### 1. `isConfigured()` doesn't check webhook secret
**File:** `api/src/stripe.js:73`
```javascript
export function isConfigured() {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}
```
**Issue:** Missing `STRIPE_WEBHOOK_SECRET` check. This is critical for production readiness.

**Fix:**
```javascript
export function isConfigured() {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET);
}
```

#### 2. Webhook rejection returns wrong action
**File:** `api/src/stripe.js:54-57`
```javascript
if (!STRIPE_WEBHOOK_SECRET) {
  console.error('STRIPE_WEBHOOK_SECRET not configured — rejecting webhook');
  return { action: 'rejected', reason: 'webhook_secret_not_configured' };
}
```
**Issue:** Should **throw an error** instead of returning rejected. Silent failures in production are dangerous - if secret is missing, the server should crash loudly on startup, not silently reject webhooks.

**Fix:**
```javascript
if (!STRIPE_WEBHOOK_SECRET) {
  throw new Error('STRIPE_WEBHOOK_SECRET not configured — refusing to process webhooks');
}
```

### MEDIUM

#### 3. Rate limiter memory leak potential
**File:** `api/src/ratelimit.js`
- In-memory Map with 60s cleanup interval
- **Issue:** High-traffic scenarios could accumulate entries before cleanup

**Suggestion:** Add max entries limit with LRU eviction:
```javascript
var MAX_ENTRIES = 10000;
if (store.size > MAX_ENTRIES) {
  // Remove oldest entry
  var firstKey = store.keys().next().value;
  store.delete(firstKey);
}
```

#### 4. No request logging/middleware
**File:** `api/src/index.js`
- No structured logging for requests
- Makes debugging production issues harder

**Suggestion:** Add request logging middleware:
```javascript
app.use('*', async function(c, next) {
  var start = Date.now();
  await next();
  console.log('[%s] %s %s %sms %s',
    new Date().toISOString(),
    c.req.method,
    c.req.path,
    Date.now() - start,
    c.res.status
  );
});
```

#### 5. Test coverage gaps
**Files:** `api/test/*.test.js`
- Missing: crypto tests for large payloads
- Missing: rate limiter IP normalization tests
- Missing: integration tests for full secret create → retrieve → burn flow
- Missing: webhook idempotency tests

**Suggestion:** Add integration test suite that:
1. Creates a secret
2. Retrieves it (verifies decryption)
3. Retrieves again (verifies burn)
4. Tests TTL expiration

### LOW

#### 6. Inconsistent error message format
**File:** `api/src/ratelimit.js` vs `api/src/index.js`
- Rate limiter: `"Too many requests"`
- Body limit: `"Request too large"`
- Secret creation: `"content is required"`

**Suggestion:** Standardize error response format:
```javascript
return c.json({ 
  error: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Try again later.'
  } 
}, 429);
```

#### 7. No health check details
**File:** `api/src/index.js`
```javascript
app.get('/health', function(c) { 
  return c.json({ status: 'ok', service: 'envburn' }); 
});
```
**Issue:** Doesn't verify database connectivity or Stripe config

**Suggestion:**
```javascript
app.get('/health', function(c) {
  try {
    db.prepare('SELECT 1').get();
    return c.json({ 
      status: 'ok', 
      service: 'envburn',
      checks: { database: 'ok', stripe: isConfigured() ? 'ok' : 'missing' }
    });
  } catch (e) {
    return c.json({ status: 'error', service: 'envburn', error: e.message }, 503);
  }
});
```

#### 8. Magic numbers in limits
**File:** `api/src/index.js`
```javascript
var LIMITS = {
  free:  { maxSize: 100000, maxTTL: 7 * 86400, maxViews: 100 },
  pro:   { maxSize: 1000000, maxTTL: 30 * 86400, maxViews: 10000 },
};
```
**Suggestion:** Extract to config file or environment variables for easy tuning.

---

## 📊 Confidence Level

**Current confidence: 85%** that EnvBurn is production-ready.

### Breakdown:
- **Security:** 90% (solid crypto, webhook verification, but needs hard-fail)
- **Code quality:** 85% (clean structure, but missing logging)
- **Testing:** 75% (good unit tests, needs integration coverage)
- **Deployment:** 85% (CI/CD in place, but health checks incomplete)

### Blocking production:
1. Fix `isConfigured()` to include webhook secret
2. Change webhook secret missing from soft reject to hard throw
3. Add integration tests for full secret lifecycle

### After fixes: **95% confidence**

---

## 🎯 Summary

Crix did excellent work on the security fundamentals. The cryptography is solid, webhook verification is properly implemented, and rate limiting is in place. The code is clean and well-structured.

**Main critique:** Being too defensive/soft on failures. Production systems should fail loudly when critical config is missing, not silently degrade. The webhook secret check should crash the server on startup if missing — this ensures you catch misconfiguration immediately, not when a webhook fails to process.

**Test coverage** is good but not comprehensive. Integration tests for the full secret lifecycle would boost confidence significantly.

Overall: **Strong work, needs minor hardening for production.** 🐾
