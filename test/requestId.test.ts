import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerRequestIdHeader, requestIdOptions } from '../src/requestId.js';

function buildTestServer() {
  const app = Fastify(requestIdOptions);
  registerRequestIdHeader(app);
  app.get('/test', async () => ({ ok: true }));
  return app;
}

describe('request id correlation', () => {
  const apps: ReturnType<typeof buildTestServer>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('echoes a caller-supplied x-request-id', async () => {
    const app = buildTestServer();
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-request-id': 'client-request-123' },
    });

    expect(response.headers['x-request-id']).toBe('client-request-123');
  });

  it('generates an x-request-id when the caller omits it', async () => {
    const app = buildTestServer();
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
