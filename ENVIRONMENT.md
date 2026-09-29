# Environment variables

Copy `.env.example` to `.env` (and `.env.test.example` to `.env.test` for
the test suite) and fill these in.

## Loading and precedence

- `npm run dev` and `npm start` import `dotenv/config` before the application
  modules load. This reads `.env` once at process startup. Values already
  present in the shell or CI environment take precedence over values in the
  file; dotenv does not overwrite existing environment variables.
- `npm test` loads `.env.test` from `test/setup.ts` before importing the test
  modules. The test database is separate because the suite resets its data.
- `npm run db:push:test` explicitly runs Prisma with `.env.test` through
  `dotenv-cli`.
- GitHub Actions supplies `DATABASE_URL` directly for its temporary Postgres
  service. It does not depend on a checked-in `.env` file.
- Docker Compose loads `.env` for the backend container, then overrides
  `DATABASE_URL` with the internal Postgres hostname. The host command
  `npm run db:push` still uses the `localhost` URL from `.env`.

Environment values are read at module-load time in several places, including
the database adapter, indexer contract configuration, polling interval, and
server port. Set the environment before starting the process; changing a
variable after startup does not reconfigure those modules.

| Variable                      | Required | Default                                | Notes                                                                                          |
| ------------------------------ | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                 | Yes      | —                                        | Postgres connection string. Inside `docker compose`, the backend service overrides this to point at the `postgres` service, not `localhost`. |
| `PORT`                         | No       | `3000`                                   | Port the Fastify server listens on.                                                              |
| `SOROBAN_RPC_URL`               | No       | `https://soroban-testnet.stellar.org`    | Soroban RPC endpoint the indexer polls.                                                          |
| `NGO_REGISTRY_CONTRACT_ID`      | No*      | — (empty)                                | Deployed `ngo-registry` contract id. See `streamgive-contracts/deployments.json`. The indexer no-ops until both contract ids are set. |
| `DONATION_VAULT_CONTRACT_ID`    | No*      | — (empty)                                | Deployed `donation-vault` contract id. Same file as above.                                       |
| `INDEXER_POLL_INTERVAL_MS`      | No       | `5000`                                   | How often the indexer polls `getEvents`.                                                         |
| `CORS_ORIGINS`                  | No       | `http://localhost:3001`                  | Comma-separated origins allowed to call this API from a browser.                                |
| `ADMIN_ADDRESS`                 | No**     | — (empty)                                | Stellar public key (`G...`) that must sign requests to admin routes (`/ngo-applications` review). Admin routes 503 until this is set. Should match the `admin` configured on the deployed contracts. |
| `NOTIFY_WEBHOOK_URL`            | No       | — (empty)                                | If set, stream lifecycle events (`stream_created`/`stream_withdrawn`/`stream_cancelled`) are POSTed here as JSON.                                |
| `LOG_LEVEL`                     | No       | `info`                                   | Pino log level: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace`.                     |
| `NODE_ENV`                      | No       | unset (treated as development)           | Set to `production` to switch logging to structured JSON instead of pino-pretty. Set automatically inside the Docker image. |

\* Required for the indexer to do anything; the app runs fine without them, it just never sees on-chain events.
\*\* Required for the admin review endpoints to work at all; everything else in the API works without it.
