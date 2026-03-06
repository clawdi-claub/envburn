var STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
var BASE_URL = process.env.BASE_URL || 'https://envburn.onrender.com';

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
    'cancel_url': BASE_URL + '/pricing',
    'metadata[product]': 'envburn_pro',
    'allow_promotion_codes': 'true',
  });
}

export function parseWebhookEvent(rawBody) {
  // TODO: add stripe signature verification for production
  var event = JSON.parse(rawBody);
  switch (event.type) {
    case 'checkout.session.completed': {
      var s = event.data.object;
      return { action: 'activate', email: s.customer_email, customerId: s.customer, subscriptionId: s.subscription };
    }
    case 'customer.subscription.deleted': {
      return { action: 'deactivate', customerId: event.data.object.customer };
    }
    default:
      return { action: 'none' };
  }
}

export function isConfigured() {
  return !!(STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}
