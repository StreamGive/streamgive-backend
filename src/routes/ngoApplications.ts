import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { prisma } from '../db.js';
import { requireAdminSignature } from '../middleware/adminAuth.js';

const applicationSchema = z.object({
  ownerAddress: z.string().regex(/^G[A-Z2-7]{55}$/),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  website: z.string().url().optional(),
  contactEmail: z.string().email(),
  country: z.string().max(100).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

const statusQuerySchema = z.object({
  // Stellar StrKey ed25519 public key: 'G' + 55 base32 (A-Z2-7) chars.
  // Same regex as GET /ngos/lookup.
  ownerAddress: z.string().regex(/^G[A-Z2-7]{55}$/),
});

const reviewBodySchema = z.object({
  reviewNote: z.string().max(2000).optional(),
});

/** The two states an application can be reviewed into — the terminal pair of
 *  `NgoApplicationStatus`, whose only other value is the `PENDING` they are
 *  reachable from. */
type ReviewDecision = 'APPROVED' | 'REJECTED';

/**
 * Builds the handler behind `POST /ngo-applications/:id/approve` and
 * `POST /ngo-applications/:id/reject`. Both routes go through this one
 * function so the two decisions cannot drift apart in how they are applied.
 *
 * `NgoApplication.status` is a three-state machine with exactly one legal
 * transition: `PENDING -> APPROVED | REJECTED`. Both targets are terminal —
 * a recorded decision is the record of what this review concluded, and
 * nothing reachable through these routes may change it afterwards:
 *
 *  - Approving an application that was rejected (or the reverse) would let a
 *    later call silently overwrite an earlier decision and its review note,
 *    leaving no trace that the outcome had ever been anything else. That
 *    decision is what an admin acts on, and what an applicant is told by
 *    `GET /ngo-applications/status`, so rewriting it is data loss, not an
 *    edit.
 *  - Neither route is single-use. The admin signature is bound to
 *    method + url + timestamp rather than to an application (see
 *    `middleware/adminAuth.ts`), so a captured request stays replayable for
 *    the length of the clock-skew window, and an admin dashboard retrying a
 *    request it never saw the answer to is an ordinary accident.
 *
 * So "is it still pending?" is folded into the UPDATE itself —
 * `WHERE id = $id AND status = 'PENDING'` — instead of being a separate read.
 * Postgres re-evaluates that predicate against the latest committed row when
 * a concurrent writer holds the row lock, so if two reviews race, exactly one
 * matches and the loser updates zero rows: a compare-and-swap. A separate
 * read-then-write cannot do that — two callers both read `PENDING` and both
 * write — so a double-click, a dashboard retry, or a replayed signature could
 * still overwrite a decision. (The check these handlers used to carry sat
 * *after* the `UPDATE` had been sent, so it was unreachable, and it read an
 * `application` variable that no longer existed.)
 *
 * `updateMany` also cannot raise the "record not found" error that `update`
 * does when no row matches, so the two reasons for matching nothing are told
 * apart by one follow-up read and reported as 404 and 409 respectively. That
 * read returns only the status: the applicant's contact details and the
 * reviewer's note are never echoed on the failure path or written to the log.
 */
function reviewHandler(decision: ReviewDecision) {
  return async function reviewApplication(request: FastifyRequest, reply: FastifyReply) {
    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { id } = parsedParams.data;

    const parsed = reviewBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    // Nothing but a PENDING row matches, so this is the only write in the
    // system that can move an application out of PENDING.
    const { count } = await prisma.ngoApplication.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: decision, reviewNote: parsed.data.reviewNote },
    });

    if (count === 0) {
      // Either no application has that id, or it is no longer awaiting
      // review. `updateMany` matched nothing either way.
      const existing = await prisma.ngoApplication.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!existing) {
        return reply.code(404).send({ error: 'not_found' });
      }

      // id and status only: the reviewer's note and the applicant's contact
      // details stay out of the logs.
      request.log.warn(
        { applicationId: id, currentStatus: existing.status, attempted: decision },
        'refused to review an application that is no longer pending',
      );

      // The recorded decision and its note are left exactly as they were.
      // `status` is included so a caller that retried can tell "your review
      // already landed" from "someone else got there first".
      return reply.code(409).send({ error: 'already_reviewed', status: existing.status });
    }

    // Re-read so the response is the committed row rather than a locally
    // assembled one. Only the winner of the compare-and-swap reaches here,
    // and nothing else can change this row's status afterwards, so this
    // cannot come back empty unless the row is gone.
    const application = await prisma.ngoApplication.findUnique({ where: { id } });
    if (!application) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return application;
  };
}

export async function ngoApplicationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/ngo-applications',
    // Public write endpoint — tighter than the global default since it's
    // the most spam-prone route in the API.
    {
      config: {
        rateLimit: {
          max: Number(process.env.RATE_LIMIT_APPLICATION_MAX ?? 5),
          timeWindow: process.env.RATE_LIMIT_APPLICATION_WINDOW ?? '1 minute',
        },
      },
    },
    async (request, reply) => {
      const parsed = applicationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
      }

      const existingApp = await prisma.ngoApplication.findFirst({
        where: {
          ownerAddress: parsed.data.ownerAddress,
          status: { in: ['PENDING', 'APPROVED'] },
        },
      });
      if (existingApp) {
        if (existingApp.status === 'APPROVED') {
          return reply.code(409).send({ error: 'already_approved' });
        }
        return reply.code(409).send({ error: 'application_already_pending' });
      }

      const application = await prisma.ngoApplication.create({ data: parsed.data });
      return reply.code(201).send(application);
    },
  );

  // Public read endpoint: an applicant can check their own review status
  // without an admin signature. Deliberately returns only the review
  // outcome and timestamps — never the contact details or description
  // submitted with the application, since anyone who knows (or guesses) an
  // address could otherwise read them.
  app.get('/ngo-applications/status', async (request, reply) => {
    const parsed = statusQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const application = await prisma.ngoApplication.findFirst({
      where: { ownerAddress: parsed.data.ownerAddress },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true, updatedAt: true },
    });
    if (!application) {
      return reply.code(404).send({ error: 'not_found' });
    }

    return application;
  });

  // Admin dashboard endpoint: returns application counts grouped by
  // status so the client doesn't have to fetch and count applications
  // itself. Must be registered before the /:id route so 'stats' isn't
  // swallowed as an id and rejected by the UUID param validation.
  app.get('/ngo-applications/stats', { preHandler: requireAdminSignature }, async () => {
    const grouped = await prisma.ngoApplication.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0 } as Record<string, number>;
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }

    const total = counts.PENDING + counts.APPROVED + counts.REJECTED;

    return {
      counts: {
        PENDING: counts.PENDING,
        APPROVED: counts.APPROVED,
        REJECTED: counts.REJECTED,
      },
      total,
    };
  });

  app.get('/ngo-applications', { preHandler: requireAdminSignature }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    }

    const where = parsed.data.status ? { status: parsed.data.status } : {};

    const [applications, total] = await Promise.all([
      prisma.ngoApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parsed.data.limit,
        skip: parsed.data.offset,
      }),
      prisma.ngoApplication.count({ where }),
    ]);

    return {
      applications,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    };
  });

  app.get(
    '/ngo-applications/:id',
    { preHandler: requireAdminSignature },
    async (request, reply) => {
      const parsedParams = idParamSchema.safeParse(request.params);
      if (!parsedParams.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      const application = await prisma.ngoApplication.findUnique({
        where: { id: parsedParams.data.id },
      });
      if (!application) {
        return reply.code(404).send({ error: 'not_found' });
      }

      return application;
    },
  );

  app.post(
    '/ngo-applications/:id/approve',
    { preHandler: requireAdminSignature },
    reviewHandler('APPROVED'),
  );

  app.post(
    '/ngo-applications/:id/reject',
    { preHandler: requireAdminSignature },
    reviewHandler('REJECTED'),
  );
}
