# StreamGive — Backend

Indexer and API for StreamGive, a recurring/streaming donation platform for
verified NGOs on Stellar. Watches the on-chain contracts for events and
serves the data that powers the frontend.

## Stack

- TypeScript, Node.js
- Fastify (API server)
- PostgreSQL

## Local development

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a streamgive_test DB)
npm install
npm run db:push                 # sync the schema onto streamgive
npm run dev
```

To run the whole stack containerized instead: `docker compose up --build`.

To run the integration test suite, additionally:

```
cp .env.test.example .env.test
npm run db:push:test
npm test
```

## Related repositories

- [streamgive-contracts](https://github.com/streamgive/streamgive-contracts) — Soroban smart contracts
- [streamgive-frontend](https://github.com/streamgive/streamgive-frontend) — donor & NGO web app
- [streamgive-docs](https://github.com/streamgive/streamgive-docs) — documentation

## Status

Early development.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
