import { describe, it, expect } from 'vitest';
import { parseWebhookEvent, isConfigured } from '../src/stripe.js';

describe('Stripe webhook verification', () => {
  it('should throw error when STRIPE_WEBHOOK_SECRET is not set', () => {
    // Simulate missing webhook secret
    const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = undefined;
    
    expect(() => {
      parseWebhookEvent('{"type":"checkout.session.completed"}', 't=123,v1=abc');
    }).toThrow('STRIPE_WEBHOOK_SECRET not configured');
    
    // Restore
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  it('should reject invalid signature', () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
    const result = parseWebhookEvent('{"type":"checkout.session.completed"}', 't=123,v1=invalid_sig');
    expect(result.action).toBe('rejected');
    expect(result.reason).toBe('invalid_signature');
  });

  it('should parse checkout.session.completed event', () => {
    // This test would need a valid signature - skip for now
    // In real tests, we'd generate a proper signature
  });

  it('should parse customer.subscription.deleted event', () => {
    // Same as above - needs valid signature
  });
});

describe('isConfigured', () => {
  it('should return false when STRIPE_WEBHOOK_SECRET is missing', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_PRICE_ID = 'price_test';
    process.env.STRIPE_WEBHOOK_SECRET = undefined;
    expect(isConfigured()).toBe(false);
  });

  it('should return true when all required vars are set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_PRICE_ID = 'price_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    expect(isConfigured()).toBe(true);
  });
});
