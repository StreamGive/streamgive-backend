import { describe, expect, it } from 'vitest';

import { buildServer } from '../../src/server.js';

describe('Global Error Handler', () => {
  it('normalizes unhandled exceptions into { error: "..." } shape without leaking internal details', async () => {
    const app = buildServer();

    app.get('/test-error', async () => {
      throw new Error('Database connection secret details');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/test-error',
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toEqual({ error: 'internal_server_error' });
    expect(JSON.stringify(body)).not.toContain('Database connection secret details');

    await app.close();
  });

  it('maps 413 status code to { error: "payload_too_large" }', async () => {
    const app = buildServer();

    app.post('/test-payload-limit', { bodyLimit: 50 }, async () => {
      return { ok: true };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/test-payload-limit',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ data: 'x'.repeat(100) }),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: 'payload_too_large' });

    await app.close();
  });

  it('maps 429 status code to { error: "rate_limited" }', async () => {
    const originalMax = process.env.RATE_LIMIT_MAX;
    const originalWindow = process.env.RATE_LIMIT_WINDOW;
    process.env.RATE_LIMIT_MAX = '1';
    process.env.RATE_LIMIT_WINDOW = '1 minute';

    const app = buildServer();

    const first = await app.inject({
      method: 'GET',
      url: '/v1/indexer/status',
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'GET',
      url: '/v1/indexer/status',
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ error: 'rate_limited' });

    await app.close();

    if (originalMax === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = originalMax;
    if (originalWindow === undefined) delete process.env.RATE_LIMIT_WINDOW;
    else process.env.RATE_LIMIT_WINDOW = originalWindow;
  });

  it('maps 415 status code to { error: "unsupported_media_type" }', async () => {
    const app = buildServer();

    app.post('/test-415', async () => {
      const err = new Error('Unsupported Media Type') as Error & { statusCode: number };
      err.statusCode = 415;
      throw err;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/test-415',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({ error: 'unsupported_media_type' });

    await app.close();
  });
});
