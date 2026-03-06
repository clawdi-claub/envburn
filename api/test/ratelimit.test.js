import { describe, it, expect } from 'vitest';
import { rateLimit } from '../src/ratelimit.js';

// Mock Hono context
function createMockContext(ip = '1.2.3.4') {
  return {
    req: {
      header: (name) => name === 'x-forwarded-for' ? ip : undefined
    },
    header: () => {},
    json: (data, status) => ({ data, status })
  };
}

describe('Rate limiting', () => {
  it('should allow requests under limit', async () => {
    const limiter = rateLimit({ prefix: 'test', window: 60000, max: 5 });
    const ctx = createMockContext();
    
    // First request should pass
    const result = await limiter(ctx, () => Promise.resolve());
    expect(result?.status).not.toBe(429);
  });

  it('should block requests over limit', async () => {
    const limiter = rateLimit({ prefix: 'test', window: 60000, max: 2 });
    const ctx = createMockContext();
    
    // First two requests pass
    await limiter(ctx, () => Promise.resolve());
    await limiter(ctx, () => Promise.resolve());
    
    // Third request should be blocked
    const result = await limiter(ctx, () => Promise.resolve());
    expect(result?.status).toBe(429);
    expect(result?.data?.error).toContain('Too many requests');
  });

  it('should track different IPs separately', async () => {
    const limiter = rateLimit({ prefix: 'test', window: 60000, max: 1 });
    
    const ctx1 = createMockContext('1.2.3.4');
    const ctx2 = createMockContext('5.6.7.8');
    
    // First IP hits limit
    await limiter(ctx1, () => Promise.resolve());
    const result1 = await limiter(ctx1, () => Promise.resolve());
    expect(result1?.status).toBe(429);
    
    // Second IP should still pass
    const result2 = await limiter(ctx2, () => Promise.resolve());
    expect(result2?.status).not.toBe(429);
  });
});
