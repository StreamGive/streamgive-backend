import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';

const applicationSchema = z.object({
  ownerAddress: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  website: z.string().url().optional(),
  contactEmail: z.string().email(),
  country: z.string().max(100).optional(),
});

export async function ngoApplicationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ngo-applications', async (request, reply) => {
    const parsed = applicationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const existingPending = await prisma.ngoApplication.findFirst({
      where: { ownerAddress: parsed.data.ownerAddress, status: 'PENDING' },
    });
    if (existingPending) {
      return reply.code(409).send({ error: 'application_already_pending' });
    }

    const application = await prisma.ngoApplication.create({ data: parsed.data });
    return reply.code(201).send(application);
  });
}
