import { describe, expect, it } from 'vitest';

import { buildServer } from '../src/server.js';

describe('OpenAPI documentation', () => {
  it('lists limit, cursor, sort, and q query parameters for /v1/ngos', async () => {
    const app = buildServer();
    await app.ready();

    const spec = app.swagger();
    const ngoGet = spec.paths?.['/v1/ngos']?.get;
    expect(ngoGet).toBeDefined();

    const queryParameters = (ngoGet?.parameters ?? []).filter(
      (param: { in?: string; name: string }) => param.in === 'query',
    );
    const parameterNames = queryParameters.map(
      (param: { in?: string; name: string }) => param.name,
    );

    expect(parameterNames).toContain('limit');
    expect(parameterNames).toContain('cursor');
    expect(parameterNames).toContain('sort');
    expect(parameterNames).toContain('q');

    await app.close();
  });
});
