// Stripe integration for EnvBurn Pro ($2/mo)

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const BASE_URL = process.env.BASE_URL || 'https://envburn.onrender.com';

async function stripeRequest(path, method, body) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
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
    'success_url': BASE_URL + '/pro/success?email={CHECKOUT_SESSION_ID}',
    'cancel_url': BASE_URL + '/pricing',
    'metadata[product]': 'envburn_pro',
    'allow_promotion_codes': 'true',
  });
}

export async function handleWebhook(rawBody) {
  const event = JSON.parse(rawBody);
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      return { action: 'activate', email: s.customer_email, customerId: s.customer, subscriptionId: s.subscription };
    }
    case 'customer.subscription.deleted': {
      return { action: 'deactivate', customerId: event.data.object.customer };
    }
  }
  return { action: 'none' };
}

export function isConfigured() {
  return !!(STRIPE_SECRET_KEY && process.env.STRIPE_ENVBURN_PRICE_ID);
}
