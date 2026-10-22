import { timingSafeEqual } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';

import { prisma } from './db.js';
import { recordHttpRequest, renderMetrics } from './metrics.js';
import { getCheckpoint } from './indexer/checkpoint.js';
import { donorRoutes } from './routes/donors.js';
import { impactRoutes } from './routes/impact.js';
import { indexerStatusRoutes } from './routes/indexerStatus.js';
import { getLatestLedgerSequence } from './stellar/rpc.js';
import { ngoApplicationRoutes } from './routes/ngoApplications.js';
import { ngoRoutes } from './routes/ngos.js';
import { streamRoutes } from './routes/streams.js';
import { registerRequestIdHeader, requestIdOptions } from './requestId.js';
import { registerCompression } from './plugins/compression.js';

// pino-pretty runs its formatting on a separate worker thread; spawning
// one per Fastify instance is fine for a single long-running process, but
// the test suite calls buildServer() dozens of times, so it's skipped for
// NODE_ENV=test (which Vitest sets by default) as well as production.
const USE_PRETTY_LOGS = !['production', 'test'].includes(process.env.NODE_ENV ?? '');

/**
 * Compares the bearer token in constant time so response timing cannot be
 * used to discover METRICS_TOKEN one character at a time.
 */
function hasValidBearerToken(header: string | undefined, expectedToken: string): boolean {
  if (header === undefined) {
    return false;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) {
    return false;
  }

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export type TrustProxySetting =
  boolean | string | string[] | ((address: string, hop: number) => boolean);

/**
 * Parses the TRUST_PROXY environment variable into a valid Fastify trustProxy configuration.
 *
 * Behind a reverse proxy (such as Render's load balancer or Cloudflare), Fastify's
 * socket.remoteAddress is the proxy's IP. Without trustProxy enabled, @fastify/rate-limit
 * keys all clients to that single proxy IP, throttling all users collectively.
 *
 * Supported values:
 * - undefined or empty: defaults to `true` (enabling proxy trust by default behind Render)
 * - 'true': trusts all proxies, reading client IP from the first entry of X-Forwarded-For
 * - 'false': disables proxy trust, using socket remoteAddress
 * - integer string (e.g. '1', '2'): bounded hop count function trusting the specified number of proxy hops
 * - comma-separated list or single string: IP or CIDR ranges to trust
 */
export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  if (value === undefined || value.trim() === '') {
    return true;
  }
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  const num = Number(trimmed);
  if (!Number.isNaN(num) && Number.isInteger(num)) {
    if (num <= 0) {
      return false;
    }
    return (_address: string, hop: number) => hop < num;
  }
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return trimmed;
}

export interface BuildServerOptions {
  trustProxy?: TrustProxySetting;
}

export function buildServer(options?: BuildServerOptions) {
  const requestStartedAt = new WeakMap<object, bigint>();
  const trustProxySetting =
    options?.trustProxy !== undefined
      ? options.trustProxy
      : parseTrustProxy(process.env.TRUST_PROXY);

  const app = Fastify({
    ...requestIdOptions,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Structured JSON otherwise (production: for log aggregation; test:
      // to avoid the worker-thread overhead above) — pino-pretty is a
      // devDependency on purpose, since the production image never needs it.
      transport: USE_PRETTY_LOGS ? { target: 'pino-pretty' } : undefined,
    },
    // Behind a reverse proxy (e.g. Render's load balancer, Cloudflare), Fastify's
    // underlying socket remoteAddress is the proxy's IP. Without trustProxy enabled,
    // @fastify/rate-limit keys all requests to that shared proxy IP, throttling all
    // users collectively if one client is busy. Enabling trustProxy (or a bounded hop
    // count) ensures request.ip is read from X-Forwarded-For, properly isolating rate
    // limiting per client IP.
    trustProxy: trustProxySetting,
  });

  registerRequestIdHeader(app);
  app.register(registerCompression);

  // Capture the raw request body before Fastify parses it so the admin
  // signature middleware can hash the exact bytes the client sent.
  // `request.rawBody` is not populated by default in Fastify; we attach
  // it via a preParsing hook so it's available by the time any route
  // handler (or preHandler hook like requireAdminSignature) runs.
  //
  // Only consume the payload for methods that can carry a body. For
  // bodyless methods (GET, HEAD, DELETE, OPTIONS) the payload stream may
  // not emit an 'end' event in all Fastify versions, causing the
  // `for await` to hang. Bodyless requests get an empty Buffer so the
  // body-hash in the admin signature is always the SHA-256 of zero bytes.
  app.addHook('preParsing', async (request, _reply, payload) => {
    const bodylessMethods = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);
    if (bodylessMethods.has(request.method)) {
      (request as typeof request & { rawBody: Buffer }).rawBody = Buffer.alloc(0);
      return payload;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const raw = Buffer.concat(chunks);
    (request as typeof request & { rawBody: Buffer }).rawBody = raw;
    // Re-create a readable stream from the captured bytes so Fastify can
    // still parse the body normally after we've consumed the original stream.
    const { Readable } = await import('node:stream');
    return Readable.from(raw);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const candidateStatusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const statusCode =
      typeof candidateStatusCode === 'number' &&
      candidateStatusCode >= 400 &&
      candidateStatusCode < 600
        ? candidateStatusCode
        : 500;
    const errorString =
      statusCode === 404
        ? 'not_found'
        : statusCode === 400
          ? 'invalid_request'
          : statusCode === 413
            ? 'payload_too_large'
            : statusCode === 415
              ? 'unsupported_media_type'
              : statusCode === 429
                ? 'rate_limited'
                : 'internal_server_error';
    reply.code(statusCode).send({ error: errorString });
  });

  // Fastify's default 404 body is `{ message, error, statusCode }`, while
  // every route-level 404 in this API returns `{ error: 'not_found' }`.
  // Clients should only need one parser, so use the same shape here.
  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: 'not_found' });
  });

  // Register helmet for security headers
  app.register(helmet, {
    contentSecurityPolicy: false, // Disabled for API-only server
    global: true,
  });

  // The browser app runs on a different origin to this API (a different
  // port in development, a different host in deployment), so every call
  // from it is cross-origin and fails as an opaque "Failed to fetch"
  // without these headers.
  //
  // Allowed origins are an explicit list, not a wildcard: the admin routes
  // authenticate with a signature the browser sends as a header, so any
  // origin allowed here can ask a signed-in admin's browser to call them.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'x-admin-address',
      'x-admin-signature',
      'x-admin-timestamp',
      'x-request-id',
    ],
    // Access-Control-Expose-Headers: without these, a browser on another
    // origin cannot read the limiter's headers even though the response
    // carries them. `Retry-After` is the machine-readable backoff contract;
    // the x-ratelimit-* headers show the remaining budget.
    exposedHeaders: [
      'x-request-id',
      'retry-after',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
  });

  app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 100),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
    // Spell the headers out instead of leaning on the plugin's defaults:
    // `Retry-After` is the machine-readable contract clients back off on
    // (RFC 9110 §10.2.3), and the `x-ratelimit-*` headers let a client see
    // its remaining budget before it is throttled.
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  app.addHook('onRequest', async (request) => {
    requestStartedAt.set(request, process.hrtime.bigint());
  });

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = requestStartedAt.get(request);
    if (startedAt === undefined) return;
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    recordHttpRequest(
      request.method,
      request.routeOptions.url ?? 'unmatched',
      reply.statusCode,
      durationSeconds,
    );
  });

  /**
   * Exposes process-local Prometheus metrics.
   *
   * When METRICS_TOKEN is set, the endpoint requires a matching
   * `Authorization: Bearer <token>` header so operators can protect it
   * without a network-level rule. When it is unset the endpoint stays public.
   *
   * @route GET /metrics
   * @auth Public, or bearer token when METRICS_TOKEN is set
   * @returns 200 Prometheus text format (`text/plain; version=0.0.4`); 401 `{ error: "unauthorized" }` when the token is missing or wrong.
   */
  app.get(
    '/metrics',
    {
      onRequest: async (request, reply) => {
        const token = process.env.METRICS_TOKEN?.trim();
        if (!token) {
          return;
        }

        if (!hasValidBearerToken(request.headers.authorization, token)) {
          return reply
            .code(401)
            .header('www-authenticate', 'Bearer')
            .send({ error: 'unauthorized' });
        }
      },
    },
    async (_request, reply) => {
      return reply.type('text/plain; version=0.0.4; charset=utf-8').send(renderMetrics());
    },
  );

  app.register(swagger, {
    openapi: {
      info: {
        title: 'StreamGive API',
        description: 'API for the StreamGive platform',
        version: '1.0.0',
      },
      tags: [
        { name: 'Health', description: 'Service health checks' },
        { name: 'NGOs', description: 'NGO directory and profiles' },
      ],
    },
  });

  if (process.env.NODE_ENV !== 'production') {
    app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: false },
    });
  }

  /**
   * Races a promise against a timeout.  Rejects with a TimeoutError when the
   * deadline is reached so callers can treat it the same as any other failure.
   */
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`health check timed out after ${ms} ms`)),
        ms,
      );
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  const HEALTH_CHECK_TIMEOUT_MS = parseInt(
    process.env.HEALTH_CHECK_TIMEOUT_MS ?? '3000',
    10,
  );

  /**
   * Liveness probe — only checks the database so that an RPC outage does not
   * cause the platform to restart a healthy API process.  The check is
   * time-boxed so a slow database is reported as degraded rather than
   * hanging the probe indefinitely.
   *
   * @route GET /health
   * @auth Public
   * @returns 200 `{ status: "ok", db: "ok" }` or
   *          503 `{ status: "error", db: "error" }`.
   */
  app.get('/health', async (_req, reply) => {
    const dbResult = await Promise.allSettled([
      withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_CHECK_TIMEOUT_MS),
    ]);

    const db = dbResult[0].status === 'fulfilled' ? 'ok' : 'error';
    const status = db === 'ok' ? 'ok' : 'error';
    return reply.code(status === 'ok' ? 200 : 503).send({ status, db });
  });

  /**
   * Readiness probe — checks the database, the Stellar RPC node, and indexer
   * lag.  Each remote call is time-boxed so a slow dependency is reported as
   * degraded rather than hanging the probe indefinitely.
   *
   * @route GET /health/ready
   * @auth Public
   * @returns 200 `{ status: "ok", lag, latestLedger, checkpointLedger }`; 503 `{ status: "error", reason, ... }` when unavailable or not caught up.
   */
  app.get('/health/ready', async (request, reply) => {
    try {
      // 1. Check DB (time-boxed)
      await withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_CHECK_TIMEOUT_MS);

      // 2. Get RPC and Indexer info (both time-boxed)
      const [latestLedger, checkpointLedger] = await Promise.all([
        withTimeout(getLatestLedgerSequence(), HEALTH_CHECK_TIMEOUT_MS),
        getCheckpoint(),
      ]);

      if (checkpointLedger === undefined) {
        return reply.code(503).send({ status: 'error', reason: 'indexer_not_started' });
      }

      const lag = latestLedger - checkpointLedger;
      const threshold = parseInt(process.env.INDEXER_LAG_THRESHOLD ?? '100', 10);

      if (lag > threshold) {
        return reply.code(503).send({ status: 'error', reason: 'indexer_lagging', lag, threshold });
      }

      return { status: 'ok', lag, latestLedger, checkpointLedger };
    } catch (error) {
      request.log.error(error);
      return reply.code(503).send({ status: 'error', reason: 'service_unavailable' });
    }
  });

  app.addHook('onRoute', (route) => {
    const schemas: Record<string, object> = {
      '/v1/ngos': {
        tags: ['NGOs'],
        summary: 'List verified NGOs',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
            cursor: { type: 'string', format: 'uuid' },
            sort: { type: 'string', enum: ['newest', 'oldest', 'name'], default: 'newest' },
            q: { type: 'string', maxLength: 100 },
          },
        },
      },
      '/v1/ngos/lookup': {
        tags: ['NGOs'],
        summary: 'Find an NGO by Stellar address',
        querystring: {
          type: 'object',
          properties: { address: { type: 'string', pattern: '^G[A-Z2-7]{55}$' } },
          required: ['address'],
        },
      },
      '/v1/ngos/:id/donors': {
        tags: ['NGOs'],
        summary: 'List donors for an NGO',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            cursor: { type: 'string', format: 'uuid' },
          },
        },
      },
      '/v1/ngos/:id': {
        tags: ['NGOs'],
        summary: 'Get an NGO profile and impact totals',
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    };
    const schema = schemas[route.url];
    if (schema) route.schema = { ...route.schema, ...schema };
  });

  const apiPrefix = { prefix: '/v1' };
  app.register(ngoRoutes, apiPrefix);
  app.register(donorRoutes, apiPrefix);
  app.register(streamRoutes, apiPrefix);
  app.register(impactRoutes, apiPrefix);
  app.register(ngoApplicationRoutes, apiPrefix);
  app.register(indexerStatusRoutes, apiPrefix);

  return app;
}
