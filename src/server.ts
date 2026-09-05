import Fastify from 'fastify';

import { prisma } from './db.js';
import { impactRoutes } from './routes/impact.js';
import { ngoRoutes } from './routes/ngos.js';
import { streamRoutes } from './routes/streams.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  app.register(ngoRoutes);
  app.register(streamRoutes);
  app.register(impactRoutes);

  return app;
}
