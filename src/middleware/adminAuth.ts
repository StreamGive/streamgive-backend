import { Keypair } from '@stellar/stellar-sdk';
import type { FastifyReply, FastifyRequest } from 'fastify';

const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Verifies the caller controls ADMIN_ADDRESS's keypair, without a private
 * key ever crossing the wire: the client signs
 * `${method}:${url}:${timestamp}` with their Stellar wallet and sends the
 * pieces as headers. The timestamp both binds the signature to this one
 * request and bounds replay — a captured header set is only useful for a
 * few minutes.
 */
export async function requireAdminSignature(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!ADMIN_ADDRESS) {
    reply.code(503).send({ error: 'admin_auth_not_configured' });
    return;
  }

  const address = request.headers['x-admin-address'];
  const signatureB64 = request.headers['x-admin-signature'];
  const timestampHeader = request.headers['x-admin-timestamp'];

  if (
    typeof address !== 'string' ||
    typeof signatureB64 !== 'string' ||
    typeof timestampHeader !== 'string'
  ) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }

  if (address !== ADMIN_ADDRESS) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) {
    reply.code(401).send({ error: 'stale_signature' });
    return;
  }

  const payload = `${request.method}:${request.url}:${timestampHeader}`;

  try {
    const keypair = Keypair.fromPublicKey(address);
    const isValid = keypair.verify(Buffer.from(payload), Buffer.from(signatureB64, 'base64'));
    if (!isValid) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  } catch {
    reply.code(401).send({ error: 'unauthorized' });
  }
}
