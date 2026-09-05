import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';

const paramsSchema = z.object({ ngoId: z.string().uuid() });

/**
 * Public "impact" view for one NGO — a superset of /ngos/:id's profile
 * stats, framed around relative impact rather than admin/profile detail:
 * active vs. cancelled breakdown, and this NGO's share of everything ever
 * committed platform-wide. That platform-wide comparison is the reason
 * this isn't just folded into /ngos/:id — a plain profile page shouldn't
 * need to scan every stream on the platform to render.
 */
export async function impactRoutes(app: FastifyInstance): Promise<void> {
  app.get('/impact/:ngoId', async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { ngoId } = parsedParams.data;

    const ngo = await prisma.ngo.findUnique({
      where: { id: ngoId },
      include: {
        streams: { select: { status: true, balance: true, withdrawn: true, donorId: true } },
      },
    });

    if (!ngo) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const ngoCommitted = ngo.streams.reduce(
      (sum, s) => sum + BigInt(s.balance) + BigInt(s.withdrawn),
      0n,
    );
    const ngoWithdrawn = ngo.streams.reduce((sum, s) => sum + BigInt(s.withdrawn), 0n);

    // Scans every stream on the platform — fine at MVP scale, but this is
    // the first thing to replace with a maintained running total if the
    // streams table grows large.
    const allStreams = await prisma.stream.findMany({
      select: { balance: true, withdrawn: true },
    });
    const platformCommitted = allStreams.reduce(
      (sum, s) => sum + BigInt(s.balance) + BigInt(s.withdrawn),
      0n,
    );

    const platformSharePercent =
      platformCommitted > 0n ? Number((ngoCommitted * 10000n) / platformCommitted) / 100 : 0;

    return {
      ngoId: ngo.id,
      name: ngo.name,
      totalCommitted: ngoCommitted.toString(),
      totalWithdrawn: ngoWithdrawn.toString(),
      activeStreams: ngo.streams.filter((s) => s.status === 'ACTIVE').length,
      cancelledStreams: ngo.streams.filter((s) => s.status === 'CANCELLED').length,
      uniqueDonors: new Set(ngo.streams.map((s) => s.donorId)).size,
      platformSharePercent,
    };
  });
}
