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
  limit: z.coerce.number().int().min(1).max(100).default(100),
  // A stream id from a previous page's last item; results start right after it.
  cursor: z.string().uuid().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

const streamInclude = {
  donor: { select: { address: true } },
  ngo: { select: { id: true, name: true, ownerAddress: true } },
} as const;

// onChainId is a BigInt; Fastify's default JSON.stringify serializer (no
// response schema is defined yet) throws on BigInt, so it has to go out as
// a string.
function serializeStream<T extends { onChainId: bigint }>(stream: T) {
  const { onChainId, ...rest } = stream;
  return { ...rest, onChainId: onChainId.toString() };
}

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
    const { donor, ngo, limit, cursor } = parsedQuery.data;

    const streams = await prisma.stream.findMany({
      where: {
        ...(donor ? { donor: { address: donor } } : {}),
        ...(ngo ? { ngoId: ngo } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: streamInclude,
    });

    return streams.map(serializeStream);
  });

  app.get('/streams/:id', async (request, reply) => {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }

    const stream = await prisma.stream.findUnique({
      where: { id: parsedParams.data.id },
      include: streamInclude,
    });

    if (!stream) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return serializeStream(stream);
  });
}
