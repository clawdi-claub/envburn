import { describe, it, expect } from 'vitest';

var BASE = 'http://localhost:' + (process.env.TEST_PORT || '3099');

// These tests require the server running on TEST_PORT.
// CI starts it before running these.

async function json(path, opts) {
  var res = await fetch(BASE + path, opts);
  return { status: res.status, body: await res.json() };
}

describe('API integration', () => {
  it('GET /health returns ok', async () => {
    var { status, body } = await json('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('POST /api/secrets creates a secret', async () => {
    var { status, body } = await json('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'MY_SECRET=hunter2' }),
    });
    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    expect(body.key).toBeDefined();
    expect(body.url).toContain('/s/');
    expect(body.url).toContain('#');
  });

  it('GET /api/secrets/:id retrieves and decrypts', async () => {
    var create = await json('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'RETRIEVE_TEST=yes', burnAfterRead: false, views: 5 }),
    });
    var { status, body } = await json('/api/secrets/' + create.body.id + '?key=' + encodeURIComponent(create.body.key));
    expect(status).toBe(200);
    expect(body.content).toBe('RETRIEVE_TEST=yes');
    expect(body.viewsRemaining).toBe(4);
  });

  it('GET /api/secrets/:id with wrong key returns 403', async () => {
    var create = await json('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'secret', burnAfterRead: false, views: 10 }),
    });
    // Generate a different valid base64 key
    var wrongKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    var { status } = await json('/api/secrets/' + create.body.id + '?key=' + encodeURIComponent(wrongKey));
    expect(status).toBe(403);
  });

  it('burn after read works', async () => {
    var create = await json('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'BURN_ME', burnAfterRead: true }),
    });
    // First read succeeds
    var r1 = await json('/api/secrets/' + create.body.id + '?key=' + encodeURIComponent(create.body.key));
    expect(r1.status).toBe(200);
    expect(r1.body.burned).toBe(true);
    // Second read fails
    var r2 = await json('/api/secrets/' + create.body.id + '?key=' + encodeURIComponent(create.body.key));
    expect(r2.status).toBe(404);
  });

  it('DELETE requires key', async () => {
    var create = await json('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'DELETE_ME', burnAfterRead: false, views: 10 }),
    });
    // Delete without key fails
    var r1 = await fetch(BASE + '/api/secrets/' + create.body.id, { method: 'DELETE' });
    expect(r1.status).toBe(400);

    // Delete with wrong key fails
    var r2 = await fetch(BASE + '/api/secrets/' + create.body.id + '?key=wrongkey', { method: 'DELETE' });
    expect([403, 500]).toContain(r2.status); // 500 if base64 decode fails, 403 if decryption fails

    // Delete with correct key succeeds
    var r3 = await fetch(BASE + '/api/secrets/' + create.body.id + '?key=' + encodeURIComponent(create.body.key), { method: 'DELETE' });
    expect(r3.status).toBe(200);
  });

  it('POST /api/secrets rejects empty content', async () => {
    var { status } = await json('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    });
    expect(status).toBe(400);
  });

  it('POST /api/secrets rejects oversized content', async () => {
    var { status } = await json('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'A'.repeat(200000) }),
    });
    expect(status).toBe(400);
  });

  it('GET /api/secrets/:id/exists works', async () => {
    var create = await json('/api/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'EXISTS_TEST', burnAfterRead: false, views: 10 }),
    });
    var { status, body } = await json('/api/secrets/' + create.body.id + '/exists');
    expect(status).toBe(200);
    expect(body.exists).toBe(true);

    var { status: s2 } = await json('/api/secrets/nonexistent123/exists');
    expect(s2).toBe(404);
  });

  it('POST /api/account/check returns tier', async () => {
    var { status, body } = await json('/api/account/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@test.com' }),
    });
    expect(status).toBe(200);
    expect(body.tier).toBe('free');
    expect(body.limits).toBeDefined();
  });

  it('POST /stripe/webhook rejects without signature', async () => {
    var res = await fetch(BASE + '/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ type: 'checkout.session.completed', id: 'evt_fake', data: { object: {} } }),
    });
    expect(res.status).toBe(400);
  });
});
