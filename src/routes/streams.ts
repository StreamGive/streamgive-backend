import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.get('/streams', async (request) => {
    // `donor` filters by wallet address (donors have no public directory of
    // their own); `ngo` filters by the NGO's internal id, matching what
    // GET /ngos and /ngos/:id expose.
    const { donor, ngo } = request.query as { donor?: string; ngo?: string };

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
