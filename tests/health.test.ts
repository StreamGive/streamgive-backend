import { buildApp } from '../src/app';
import { db } from '../src/db';
import { FastifyInstance } from 'fastify';

describe('Health endpoint', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return 200 with ok status when DB is available', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'ok' });
    });

    it('should return 503 with error status when DB is unavailable', async () => {
      // Mock DB query failure
      const originalQuery = db.query;
      db.query = jest.fn().mockRejectedValue(new Error('DB connection failed'));

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.payload)).toEqual({
        status: 'error',
        database: 'unreachable',
      });

      // Restore original query
      db.query = originalQuery;
    });
  });
});