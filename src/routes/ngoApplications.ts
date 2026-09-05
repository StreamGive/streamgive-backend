import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';
import { requireAdminSignature } from '../middleware/adminAuth.js';

const applicationSchema = z.object({
  ownerAddress: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  website: z.string().url().optional(),
  contactEmail: z.string().email(),
  country: z.string().max(100).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

const reviewBodySchema = z.object({
  reviewNote: z.string().max(2000).optional(),
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

  app.get('/ngo-applications', { preHandler: requireAdminSignature }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    return prisma.ngoApplication.findMany({
      where: parsed.data.status ? { status: parsed.data.status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.post(
    '/ngo-applications/:id/approve',
    { preHandler: requireAdminSignature },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = reviewBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
      }

      try {
        return await prisma.ngoApplication.update({
          where: { id },
          data: { status: 'APPROVED', reviewNote: parsed.data.reviewNote },
        });
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    },
  );

  app.post(
    '/ngo-applications/:id/reject',
    { preHandler: requireAdminSignature },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = reviewBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
      }

      try {
        return await prisma.ngoApplication.update({
          where: { id },
          data: { status: 'REJECTED', reviewNote: parsed.data.reviewNote },
        });
      } catch {
        return reply.code(404).send({ error: 'not_found' });
      }
    },
  );
}
