import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyServerOptions } from 'fastify';

// Fastify includes request.id in the child logger bound to every request.
// Honour a caller-supplied id so logs can be correlated across services,
// and use an unpredictable id when the request starts here.
export const requestIdOptions = {
  requestIdHeader: 'x-request-id',
  genReqId: () => randomUUID(),
} satisfies Pick<FastifyServerOptions, 'requestIdHeader' | 'genReqId'>;

export function registerRequestIdHeader(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
}
