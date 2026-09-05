import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { prisma } from './db.js';
import { impactRoutes } from './routes/impact.js';
import { ngoApplicationRoutes } from './routes/ngoApplications.js';
import { ngoRoutes } from './routes/ngos.js';
import { streamRoutes } from './routes/streams.js';

// pino-pretty runs its formatting on a separate worker thread; spawning
// one per Fastify instance is fine for a single long-running process, but
// the test suite calls buildServer() dozens of times, so it's skipped for
// NODE_ENV=test (which Vitest sets by default) as well as production.
const USE_PRETTY_LOGS = !['production', 'test'].includes(process.env.NODE_ENV ?? '');

export function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Structured JSON otherwise (production: for log aggregation; test:
      // to avoid the worker-thread overhead above) — pino-pretty is a
      // devDependency on purpose, since the production image never needs it.
      transport: USE_PRETTY_LOGS ? { target: 'pino-pretty' } : undefined,
    },
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  app.register(ngoRoutes);
  app.register(streamRoutes);
  app.register(impactRoutes);
  app.register(ngoApplicationRoutes);

  return app;
}
