import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyServerOptions, RawRequestDefaultExpression } from 'fastify';

// Fastify includes request.id in the child logger bound to every request.
// Honour a caller-supplied id so logs can be correlated across services,
// and use an unpredictable id when the request starts here.
//
// The caller-supplied header is validated: only values matching
// /^[A-Za-z0-9._-]{1,128}$/ are accepted. An oversized or malformed
// value (newlines, control characters, etc.) is ignored and a fresh UUID
// is generated instead, preventing log forging and log bloat.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export const requestIdOptions = {
  requestIdHeader: 'x-request-id',
  genReqId: (req: RawRequestDefaultExpression) => {
    const header = req.headers['x-request-id'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value && REQUEST_ID_PATTERN.test(value)) {
      return value;
    }
    return randomUUID();
  },
} satisfies Pick<FastifyServerOptions, 'requestIdHeader' | 'genReqId'>;

export function registerRequestIdHeader(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
}
