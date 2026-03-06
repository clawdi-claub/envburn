import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { parseWebhookEvent, isConfigured } from '../src/stripe.js';

function makeSignature(payload, secret) {
  var t = Math.floor(Date.now() / 1000);
  var sig = createHmac('sha256', secret).update(t + '.' + payload).digest('hex');
  return 't=' + t + ',v1=' + sig;
}

describe('parseWebhookEvent', () => {
  it('throws error when STRIPE_WEBHOOK_SECRET is not configured', () => {
    var orig = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    var body = JSON.stringify({ type: 'checkout.session.completed', id: 'evt_1' });
    expect(() => parseWebhookEvent(body, 't=123,v1=abc')).toThrow('STRIPE_WEBHOOK_SECRET not configured');
    if (orig) process.env.STRIPE_WEBHOOK_SECRET = orig;
  });

  it('rejects when signature is invalid', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    var body = JSON.stringify({ type: 'checkout.session.completed', id: 'evt_1', data: { object: {} } });
    var result = parseWebhookEvent(body, 't=123,v1=invalid');
    expect(result.action).toBe('rejected');
  });

  it('rejects when signature header is missing', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    var result = parseWebhookEvent('{}', null);
    expect(result.action).toBe('rejected');
  });

  it('rejects expired timestamp', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    var result = parseWebhookEvent('{}', 't=' + (Math.floor(Date.now() / 1000) - 600) + ',v1=x');
    expect(result.action).toBe('rejected');
  });

  it('activates on checkout.session.completed', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    var body = JSON.stringify({ 
      type: 'checkout.session.completed', 
      id: 'evt_test', 
      data: { 
        object: { 
          customer_email: 'test@example.com', 
          customer: 'cus_test', 
          subscription: 'sub_test' 
        } 
      } 
    });
    var sig = makeSignature(body, 'whsec_test');
    var result = parseWebhookEvent(body, sig);
    expect(result.action).toBe('activate');
    expect(result.email).toBe('test@example.com');
  });

  it('deactivates on customer.subscription.deleted', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    var body = JSON.stringify({ 
      type: 'customer.subscription.deleted', 
      id: 'evt_test', 
      data: { object: { customer: 'cus_test' } }
    });
    var sig = makeSignature(body, 'whsec_test');
    var result = parseWebhookEvent(body, sig);
    expect(result.action).toBe('deactivate');
  });
});

describe('isConfigured', () => {
  it('returns false when STRIPE_SECRET_KEY is missing', () => {
    var origKey = process.env.STRIPE_SECRET_KEY;
    var origPrice = process.env.STRIPE_PRICE_ID;
    var origWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_PRICE_ID = 'price_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    expect(isConfigured()).toBe(false);
    if (origKey) process.env.STRIPE_SECRET_KEY = origKey;
    if (origPrice) process.env.STRIPE_PRICE_ID = origPrice;
    if (origWebhook) process.env.STRIPE_WEBHOOK_SECRET = origWebhook;
  });

  it('returns false when STRIPE_PRICE_ID is missing', () => {
    var origKey = process.env.STRIPE_SECRET_KEY;
    var origPrice = process.env.STRIPE_PRICE_ID;
    var origWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    delete process.env.STRIPE_PRICE_ID;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    expect(isConfigured()).toBe(false);
    if (origKey) process.env.STRIPE_SECRET_KEY = origKey;
    if (origPrice) process.env.STRIPE_PRICE_ID = origPrice;
    if (origWebhook) process.env.STRIPE_WEBHOOK_SECRET = origWebhook;
  });

  it('returns false when STRIPE_WEBHOOK_SECRET is missing', () => {
    var origKey = process.env.STRIPE_SECRET_KEY;
    var origPrice = process.env.STRIPE_PRICE_ID;
    var origWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_PRICE_ID = 'price_test';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(isConfigured()).toBe(false);
    if (origKey) process.env.STRIPE_SECRET_KEY = origKey;
    if (origPrice) process.env.STRIPE_PRICE_ID = origPrice;
    if (origWebhook) process.env.STRIPE_WEBHOOK_SECRET = origWebhook;
  });

  it('returns true when all required vars are set', () => {
    var origKey = process.env.STRIPE_SECRET_KEY;
    var origPrice = process.env.STRIPE_PRICE_ID;
    var origWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_PRICE_ID = 'price_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    expect(isConfigured()).toBe(true);
    if (origKey) process.env.STRIPE_SECRET_KEY = origKey;
    if (origPrice) process.env.STRIPE_PRICE_ID = origPrice;
    if (origWebhook) process.env.STRIPE_WEBHOOK_SECRET = origWebhook;
  });
});
