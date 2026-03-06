import { createHmac, timingSafeEqual } from 'crypto';

var STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
var STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
var BASE_URL = process.env.BASE_URL || 'https://envburn.onrender.com';

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

async function stripeRequest(path, method, body) {
  var res = await fetch('https://api.stripe.com/v1' + path, {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
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
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured — rejecting webhook');
    return { action: 'rejected', reason: 'webhook_secret_not_configured' };
  }
  if (!verifySignature(rawBody, signature, STRIPE_WEBHOOK_SECRET)) {
    console.error('Stripe webhook signature verification failed');
    return { action: 'rejected', reason: 'invalid_signature' };
  }

  var event = JSON.parse(rawBody);
  var eventId = event.id || null;
  switch (event.type) {
    case 'checkout.session.completed': {
      var s = event.data.object;
      return { action: 'activate', eventId: eventId, email: s.customer_email, customerId: s.customer, subscriptionId: s.subscription };
    }
    case 'customer.subscription.deleted': {
      return { action: 'deactivate', eventId: eventId, customerId: event.data.object.customer };
    }
    default:
      return { action: 'none', eventId: eventId };
  }
}

export function isConfigured() {
  return !!(STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}
