import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function ngoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ngos', async () => {
    return prisma.ngo.findMany({
      where: { verified: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/ngos/:id', async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { id } = parsedParams.data;

    const ngo = await prisma.ngo.findUnique({
      where: { id },
      include: {
        streams: {
          select: { donorId: true, status: true, balance: true, withdrawn: true },
        },
      },
    });

    if (!ngo) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const { streams, ...profile } = ngo;

    // `balance + withdrawn` per stream is what's actually been committed to
    // this NGO (deposits plus top-ups, net of anything refunded back to a
    // donor on cancel) — not the same as the original deposit once top-ups
    // or cancellations have happened.
    const totalCommitted = streams.reduce(
      (sum, s) => sum + BigInt(s.balance) + BigInt(s.withdrawn),
      0n,
    );
    const totalWithdrawn = streams.reduce((sum, s) => sum + BigInt(s.withdrawn), 0n);

    return {
      ...profile,
      stats: {
        totalCommitted: totalCommitted.toString(),
        totalWithdrawn: totalWithdrawn.toString(),
        activeStreamCount: streams.filter((s) => s.status === 'ACTIVE').length,
        donorCount: new Set(streams.map((s) => s.donorId)).size,
      },
    };
  });
}
