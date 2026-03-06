import { describe, it, expect } from 'vitest';
import { getSubscriber, upsertSubscriber, downgradeByCustomerId, isPro, isEventProcessed, markEventProcessed } from '../src/db.js';

describe('Subscriber management', () => {
  var testEmail = 'dbtest-' + Date.now() + '@test.com';

  it('returns null for unknown subscriber', () => {
    expect(getSubscriber('nonexistent@test.com')).toBeUndefined();
  });

  it('isPro returns false for unknown email', () => {
    expect(isPro('nonexistent@test.com')).toBe(false);
  });

  it('isPro returns false for null email', () => {
    expect(isPro(null)).toBe(false);
  });

  it('upserts and retrieves subscriber', () => {
    upsertSubscriber(testEmail, 'cus_test', 'sub_test', 'pro');
    var sub = getSubscriber(testEmail);
    expect(sub.email).toBe(testEmail);
    expect(sub.tier).toBe('pro');
    expect(sub.stripe_customer_id).toBe('cus_test');
  });

  it('isPro returns true after upgrade', () => {
    expect(isPro(testEmail)).toBe(true);
  });

  it('downgrades by customer ID', () => {
    downgradeByCustomerId('cus_test');
    expect(isPro(testEmail)).toBe(false);
    expect(getSubscriber(testEmail).tier).toBe('free');
  });

  it('upsert updates existing subscriber', () => {
    upsertSubscriber(testEmail, 'cus_new', 'sub_new', 'pro');
    var sub = getSubscriber(testEmail);
    expect(sub.stripe_customer_id).toBe('cus_new');
    expect(sub.tier).toBe('pro');
  });
});

describe('Event idempotency', () => {
  var eventId = 'evt_test_' + Date.now();

  it('returns false for unprocessed event', () => {
    expect(isEventProcessed(eventId)).toBe(false);
  });

  it('marks event as processed', () => {
    markEventProcessed(eventId);
    expect(isEventProcessed(eventId)).toBe(true);
  });

  it('handles duplicate markEventProcessed gracefully', () => {
    expect(() => markEventProcessed(eventId)).not.toThrow();
  });
});
