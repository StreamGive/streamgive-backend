# StreamGive — Backend

Indexer and API for StreamGive, a recurring/streaming donation platform for
verified NGOs on Stellar. Watches the on-chain contracts for events and
serves the data that powers the frontend.

## Stack

- TypeScript, Node.js
- Fastify (API server)
- PostgreSQL
- [Architecture overview](ARCHITECTURE.md): how the API, indexer, and
  notification dispatcher run together and shut down.

## API

Most API routes, including admin routes, are mounted under `/v1`. Health checks
are available at `/health` and `/health/ready`; Prometheus metrics are at
`/metrics`. See the [API reference](docs/API.md) for every endpoint, its
parameters, authentication requirements, and response examples.

## Rate limits

The API allows up to **100 requests per minute per client IP** by default.
`POST /v1/ngo-applications` has a tighter limit of **5 requests per minute
per client IP**. Exceeding a limit returns `429 Too Many Requests` with
`{"error":"rate_limited"}`. Responses include `Retry-After` and
`X-RateLimit-*` headers to help clients know when to retry. Cross-origin
browser clients can read those headers because they are listed in the CORS
`Access-Control-Expose-Headers` response.

The global limit can be adjusted with `RATE_LIMIT_MAX` and
`RATE_LIMIT_WINDOW`; the application submission limit can be adjusted with
`RATE_LIMIT_APPLICATION_MAX` and `RATE_LIMIT_APPLICATION_WINDOW`.

Rate-limit state is kept in memory by each server process, not shared between
instances or persisted. With multiple instances, each instance tracks its own
limits, so a client's effective allowance can be higher than the configured
per-instance limit. Restarting an instance also clears its rate-limit state.

## Prometheus metrics

`GET /metrics` returns Prometheus text format (`text/plain; version=0.0.4`).
It exposes HTTP request totals and duration, indexer checkpoint and lag, and webhook
delivery totals. Configure Prometheus to scrape it on the API host and port.

Set `METRICS_TOKEN` to require `Authorization: Bearer <token>` on `/metrics`.
When it is unset, the endpoint stays public; see [ENVIRONMENT.md](ENVIRONMENT.md).

## NGO Verification Model

An NGO's verified status consists of two distinct steps kept deliberately separate:

1. **Off-Chain Application Review (`NgoApplication.status`)**: An NGO submits an off-chain application containing organization details and verification documents. Admins review and update the application status (e.g., `APPROVED` or `REJECTED`) within the database.
2. **On-Chain Contract Approval (`Ngo.verified`)**: Once an application is reviewed off-chain, an admin executes an on-chain transaction (`approve_ngo`) to grant the NGO verified status on the Stellar smart contract. The indexer listens for on-chain events (`ngo_approved` / `ngo_revoked`) and updates the `Ngo.verified` field accordingly.

Keeping off-chain application review separate from on-chain contract approval ensures that sensitive organizational details and review metadata remain off-chain, while the Stellar ledger remains the single source of truth for execution permissions and verified status.

## Admin Authentication

Admin routes are protected by a signed request scheme (`requireAdminSignature`). Each request must include:

- `x-admin-address` — the admin's Stellar public key (`G...`), which must appear in `ADMIN_ADDRESS` or `ADMIN_ADDRESSES`.
- `x-admin-timestamp` — the current time as a Unix timestamp in **milliseconds** (e.g. `Date.now()` in JavaScript).
- `x-admin-signature` — a base64 or hex Ed25519 signature over the signed payload (see below).

### Signed payload

The signature is produced by signing the following string with the admin's Stellar keypair via the SEP-53 generic message-signing scheme (`SHA-256(prefix + message)`, where `prefix = "Stellar Signed Message:\n"`):

```
METHOD:url:timestamp:bodyHash
```

- **METHOD** — HTTP method in upper-case, e.g. `GET`, `POST`, `PATCH`.
- **url** — the full request URL including path and query string, e.g. `/v1/ngo-applications?status=PENDING`.
- **timestamp** — the `x-admin-timestamp` value (milliseconds).
- **bodyHash** — lower-case hex SHA-256 of the raw request body, or the SHA-256 of an empty buffer (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`) for bodyless requests (GET, DELETE, etc.).

Including the body hash in the signed payload prevents an attacker who intercepts a valid request from replaying it with a different body (e.g. a different `reviewNote`) inside the replay window.

### Timestamp rules

The timestamp must be within ±5 minutes of the server's clock. The unit is **milliseconds**, not seconds. Sending a 10-digit seconds-precision timestamp is rejected with `timestamp_unit_mismatch` (not `stale_signature`) so clients get a clear signal.

### Error codes

| Error | Status | Meaning |
|---|---|---|
| `unauthorized` | 401 | Missing or invalid headers, address not on allow-list, or signature did not verify |
| `stale_signature` | 401 | Timestamp is outside the ±5-minute replay window |
| `timestamp_unit_mismatch` | 401 | Timestamp looks like seconds (< 10^11); send milliseconds |
| `replayed_signature` | 401 | The same address+timestamp+method+url has already been used in this window |
| `admin_auth_not_configured` | 503 | Neither `ADMIN_ADDRESS` nor `ADMIN_ADDRESSES` is set |

## Local development

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev

```

In development, interactive API documentation is available at `http://localhost:3000/docs`; the OpenAPI document is at `/docs/json`. Swagger UI is disabled in production.

```
bash
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:migrate              # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

The test database is created by the `postgres` service in `docker-compose.yml`
as `streamgive_test`. Start it with `docker compose up -d postgres`, copy
`.env.test.example` to `.env.test`, run `npm run db:push:test` to sync the
Prisma schema to that database, and only then run `npm test`.

## Troubleshooting

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

### Verifying the signature

The webhook URL is not a secret — anyone who learns it can POST whatever they
like to your receiver. Set `NOTIFY_WEBHOOK_SECRET` to a shared secret and
every request will additionally carry:

```
x-streamgive-signature: <hex>
```

where `<hex>` is the lower-case hex HMAC-SHA256 of the **raw request body**,
keyed with `NOTIFY_WEBHOOK_SECRET`. There is no prefix, timestamp or version
tag in the value — it is the bare digest.

## Data model and API statistics

See [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) for the entity relationship
diagram and the exact calculations used by `/ngos/:id` and `/impact/:ngoId`.

## Notification events

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function isFromStreamGive(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader, 'hex');

  // timingSafeEqual throws on a length mismatch, so check that first.
  return received.length === expected.length && timingSafeEqual(received, expected);
}
```

Reject any request whose signature does not match, and any unsigned request
once you have configured a secret. When `NOTIFY_WEBHOOK_SECRET` is unset the
header is omitted entirely, so receivers can be rolled out before the secret
is configured — but an endpoint that accepts unsigned requests is exactly the
hole the header exists to close, so treat that as a migration step rather
than a resting state.

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
```

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:deploy               # apply Prisma migrations to streamgive
npm run db:seed                 # optional: load sample NGOs, donors and streams
npm run dev
