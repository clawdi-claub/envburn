# EnvBurn - Production Readiness Checklist

## ✅ Code Security (COMPLETED)

- [x] **Stripe webhook signature verification** - Hard fail if `STRIPE_WEBHOOK_SECRET` missing
- [x] **Rate limiting** - 50/hr on `/api/secrets`, 10/min on `/api/upgrade`
- [x] **Security headers** - HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- [x] **CORS restricted** - API routes limited to same-origin
- [x] **Input validation** - Email validation, content size limits
- [x] **Zero-knowledge encryption** - NaCl client-side encryption (server never sees plaintext)

## 🔴 Environment Variables (REQUIRED BEFORE PRODUCTION)

Set these in Render dashboard (or your hosting provider):

```bash
# Stripe (REQUIRED)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...

# App config
BASE_URL=https://envburn.onrender.com
NODE_ENV=production

# Optional: Pro tier email (for notifications)
PRO_EMAIL=...
```

## 🔴 Stripe Configuration (REQUIRED)

1. **Create product in Stripe Dashboard:**
   - Name: EnvBurn Pro
   - Price: $2/month (recurring)
   - Copy the Price ID → `STRIPE_PRICE_ID`

2. **Get API keys:**
   - Settings → Developers → API keys
   - Secret key → `STRIPE_SECRET_KEY`

3. **Create webhook endpoint:**
   - Settings → Developers → Webhooks → Add endpoint
   - URL: `https://envburn.onrender.com/stripe/webhook`
   - Events to listen:
     - `checkout.session.completed`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - Copy Signing secret → `STRIPE_WEBHOOK_SECRET`

4. **Test payment flow:**
   - Use Stripe test mode first
   - Create test product with test price
   - Run through checkout flow
   - Verify webhook fires and Pro tier activates
   - Test cancellation flow

## 🔴 Email Configuration (OPTIONAL)

For Pro tier notifications:
```bash
PRO_EMAIL=your-email@example.com
```

## 🟡 Testing Checklist (BEFORE GOING LIVE)

- [ ] Health endpoint responds: `curl https://envburn.onrender.com/health`
- [ ] Create secret works (free tier)
- [ ] Create secret with Pro limits (after upgrade)
- [ ] Checkout flow completes successfully
- [ ] Webhook signature verification passes
- [ ] Pro tier activates after payment
- [ ] Cancellation downgrades tier correctly
- [ ] Rate limiting triggers at threshold
- [ ] Security headers present (check with curl -I)

## 🟡 Monitoring

After launch, monitor:
- Render logs for errors
- Stripe dashboard for failed payments
- Database size (WAL files)
- Rate limit hits (429 responses)

## 🚀 Deployment

Push to master triggers auto-deploy on Render. Verify:
1. Build completes successfully
2. Health check passes
3. No errors in deployment logs

---

**Last security audit:** 2026-03-06  
**Status:** Code ready, env vars pending configuration
