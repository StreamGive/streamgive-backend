import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';

export async function ngoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ngos', async () => {
    return prisma.ngo.findMany({
      where: { verified: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
}
