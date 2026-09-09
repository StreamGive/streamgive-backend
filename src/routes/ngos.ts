import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';

const idParamSchema = z.object({ id: z.string().uuid() });

const lookupQuerySchema = z.object({
  // Stellar StrKey ed25519 public key: 'G' + 55 base32 (A-Z2-7) chars.
  address: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/),
});

/** Builds the GET /ngos/:id response shape from a unique Prisma `where`. */
async function findNgoDetail(where: { id: string } | { ownerAddress: string }) {
  const ngo = await prisma.ngo.findUnique({
    where,
    include: {
      streams: {
        select: { donorId: true, status: true, balance: true, withdrawn: true },
      },
    },
  });

  if (!ngo) {
    return null;
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
}

export async function ngoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ngos', async () => {
    return prisma.ngo.findMany({
      where: { verified: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/ngos/lookup', async (request, reply) => {
    const parsedQuery = lookupQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', details: parsedQuery.error.flatten() });
    }

    const ngo = await findNgoDetail({ ownerAddress: parsedQuery.data.address });
    if (!ngo) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return ngo;
  });

  app.get('/ngos/:id', async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const ngo = await findNgoDetail({ id: parsedParams.data.id });
    if (!ngo) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return ngo;
  });
}
