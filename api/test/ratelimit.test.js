import { describe, it, expect } from 'vitest';
import { rateLimit } from '../src/ratelimit.js';

function mockCtx(ip) {
  var headers = {};
  return {
    req: {
      header: function(name) {
        if (name === 'x-forwarded-for') return ip || null;
        return null;
      }
    },
    header: function(k, v) { headers[k] = v; },
    json: function(data, status) { return { data, status }; },
    _headers: headers,
  };
}

describe('Rate limiting', () => {
  it('allows requests under limit', async () => {
    var limiter = rateLimit({ prefix: 'rl-test-1', window: 60000, max: 5 });
    var called = false;
    await limiter(mockCtx('10.0.0.1'), () => { called = true; });
    expect(called).toBe(true);
  });

  it('blocks requests over limit', async () => {
    var limiter = rateLimit({ prefix: 'rl-test-2', window: 60000, max: 2 });
    var ctx = mockCtx('10.0.0.2');
    await limiter(ctx, () => {});
    await limiter(ctx, () => {});
    var result = await limiter(ctx, () => {});
    expect(result.status).toBe(429);
  });

  it('tracks different IPs separately', async () => {
    var limiter = rateLimit({ prefix: 'rl-test-3', window: 60000, max: 1 });
    await limiter(mockCtx('10.0.0.3'), () => {});
    var blocked = await limiter(mockCtx('10.0.0.3'), () => {});
    expect(blocked.status).toBe(429);

    var called = false;
    await limiter(mockCtx('10.0.0.4'), () => { called = true; });
    expect(called).toBe(true);
  });

  it('normalizes IPv6-mapped IPv4', async () => {
    var limiter = rateLimit({ prefix: 'rl-test-4', window: 60000, max: 1 });
    await limiter(mockCtx('::ffff:10.0.0.5'), () => {});
    var blocked = await limiter(mockCtx('10.0.0.5'), () => {});
    expect(blocked.status).toBe(429);
  });

  it('takes first IP from x-forwarded-for chain', async () => {
    var limiter = rateLimit({ prefix: 'rl-test-5', window: 60000, max: 1 });
    await limiter(mockCtx('1.1.1.1, 2.2.2.2, 3.3.3.3'), () => {});
    var blocked = await limiter(mockCtx('1.1.1.1'), () => {});
    expect(blocked.status).toBe(429);
  });

  it('sets rate limit headers', async () => {
    var limiter = rateLimit({ prefix: 'rl-test-6', window: 60000, max: 10 });
    var ctx = mockCtx('10.0.0.6');
    await limiter(ctx, () => {});
    expect(ctx._headers['X-RateLimit-Limit']).toBe('10');
    expect(ctx._headers['X-RateLimit-Remaining']).toBe('9');
  });
});
