import Fastify from 'fastify';

import { prisma } from './db.js';
import { ngoRoutes } from './routes/ngos.js';

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  });

  app.register(ngoRoutes);

  return app;
}
