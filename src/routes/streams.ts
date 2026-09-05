import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';

const querySchema = z.object({
  // Stellar StrKey ed25519 public key: 'G' + 55 base32 (A-Z2-7) chars.
  donor: z
    .string()
    .regex(/^G[A-Z2-7]{55}$/)
    .optional(),
  ngo: z.string().uuid().optional(),
});

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/streams', async (request, reply) => {
    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', details: parsedQuery.error.flatten() });
    }
    // `donor` filters by wallet address (donors have no public directory of
    // their own); `ngo` filters by the NGO's internal id, matching what
    // GET /ngos and /ngos/:id expose.
    const { donor, ngo } = parsedQuery.data;

    const streams = await prisma.stream.findMany({
      where: {
        ...(donor ? { donor: { address: donor } } : {}),
        ...(ngo ? { ngoId: ngo } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        donor: { select: { address: true } },
        ngo: { select: { id: true, name: true, ownerAddress: true } },
      },
    });

    // onChainId is a BigInt; Fastify's default JSON.stringify serializer
    // (no response schema is defined yet) throws on BigInt, so it has to
    // go out as a string.
    return streams.map(({ onChainId, ...rest }) => ({
      ...rest,
      onChainId: onChainId.toString(),
    }));
  });
}
