import { createHmac, timingSafeEqual } from 'crypto';

var BASE_URL = process.env.BASE_URL || 'https://envburn.onrender.com';

function getStripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY;
}

function getWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET;
}

function verifySignature(payload, sigHeader, secret) {
  if (!secret || !sigHeader) return false;
  var parts = {};
  sigHeader.split(',').forEach(function(item) {
    var kv = item.split('=');
    if (kv[0] === 't') parts.t = kv[1];
    if (kv[0] === 'v1' && !parts.v1) parts.v1 = kv[1];
  });
  if (!parts.t || !parts.v1) return false;
  var age = Math.floor(Date.now() / 1000) - parseInt(parts.t);
  if (age > 300) return false;
  var expected = createHmac('sha256', secret)
    .update(parts.t + '.' + payload)
    .digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch (e) {
    return false;
  }
}

export async function stripeRequest(path, method, body) {
  var key = getStripeSecretKey();
  var res = await fetch('https://api.stripe.com/v1' + path, {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return res.json();
}

export async function createCheckoutSession(email, priceId) {
  return stripeRequest('/checkout/sessions', 'POST', {
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'customer_email': email,
    'success_url': BASE_URL + '/pro/success?session_id={CHECKOUT_SESSION_ID}',
    'cancel_url': BASE_URL + '/#pricing',
    'metadata[product]': 'envburn_pro',
    'allow_promotion_codes': 'true',
  });
}

export function parseWebhookEvent(rawBody, signature) {
  // CRITICAL: Hard fail if webhook secret not configured
  var webhookSecret = getWebhookSecret();
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured — refusing to process webhooks');
  }
  if (!verifySignature(rawBody, signature, webhookSecret)) {
    console.error('Stripe webhook signature verification failed');
    return { action: 'rejected', reason: 'invalid_signature' };
  }

  var event = JSON.parse(rawBody);
  var eventId = event.id || null;
  switch (event.type) {
    case 'customer.subscription.created': {
      var sub = event.data.object;
      return { action: 'activate', eventId: eventId, customerId: sub.customer, subscriptionId: sub.id };
    }
    case 'customer.subscription.deleted': {
      return { action: 'deactivate', eventId: eventId, customerId: event.data.object.customer };
    }
    case 'customer.subscription.updated': {
      var sub = event.data.object;
      // Downgrade on any non-active status (past_due, unpaid, paused, canceled)
      if (sub.status !== 'active' && sub.status !== 'trialing') {
        return { action: 'deactivate', eventId: eventId, customerId: sub.customer };
      }
      // Re-activate if subscription becomes active again (e.g. payment retry succeeds)
      return { action: 'reactivate', eventId: eventId, customerId: sub.customer, subscriptionId: sub.id };
    }
    case 'invoice.payment_failed': {
      // Log but don't immediately downgrade — subscription.updated will handle status change
      return { action: 'payment_failed', eventId: eventId, customerId: event.data.object.customer };
    }
    default:
      return { action: 'none', eventId: eventId };
  }
}

export function isConfigured() {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET);
}
