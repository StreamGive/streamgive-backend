import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db';

export async function healthRoute(fastify: FastifyInstance, _opts: any, done: (err?: Error) => void) {
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok' };
    } catch (error) {
      reply.code(503);
      return { status: 'error', database: 'unreachable' };
    }
  });

  done();
}