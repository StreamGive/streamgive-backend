import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/routes/ngoApplications.js', () => ({
  ngoApplicationRoutes: async () => {},
}));

import { buildServer } from '../src/server.js';

describe('GET /metrics', () => {
  it('returns Prometheus text with HTTP and indexer metrics', async () => {
    const app = buildServer();

    await app.inject({ method: 'GET', url: '/not-a-route' });
    const response = await app.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('# TYPE streamgive_http_requests_total counter');
    expect(response.body).toContain(
      'streamgive_http_requests_total{method="GET",route="unmatched",status_code="404"}',
    );
    expect(response.body).toContain('# TYPE streamgive_http_request_duration_seconds summary');
    expect(response.body).toContain('# TYPE streamgive_indexer_lag_ledgers gauge');
    expect(response.body).toContain('streamgive_indexer_checkpoint_ledger 0');
    expect(response.body).toContain('# TYPE streamgive_notification_deliveries_total counter');

    await app.close();
  });
});
