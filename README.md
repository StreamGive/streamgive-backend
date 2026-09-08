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

To run the whole stack containerized instead, after `npm run db:push` above: `docker compose up --build`.

To run the integration test suite, additionally:

```
cp .env.test.example .env.test
npm run db:push:test
npm test
```

## Troubleshooting

**"Can't reach database" / connection errors on startup**

Postgres isn't up yet, or `DATABASE_URL` doesn't point at it. Run
`docker compose up -d postgres` and confirm `DATABASE_URL` in `.env` matches
(`postgresql://streamgive:streamgive@localhost:5432/streamgive` when running
`npm run dev` directly — the `postgres` host only resolves inside
`docker compose`, see the override in `docker-compose.yml`). Then run
`npm run db:push` to sync the schema.

**Indexer never picks up events**

If `NGO_REGISTRY_CONTRACT_ID` and `DONATION_VAULT_CONTRACT_ID` are both
unset, this is expected — the indexer no-ops until at least one is set. See
[ENVIRONMENT.md](./ENVIRONMENT.md) for where to get the deployed contract
ids. If they're set and events still aren't showing up, check
`SOROBAN_RPC_URL` is reachable and that the contracts have actually emitted
events since the indexer's checkpoint (a fresh run starts from the current
ledger, not from the contract's history).

**Admin routes return 503**

`ADMIN_ADDRESS` is unset. The admin review endpoints refuse all requests
until it's configured — set it to the Stellar public key (`G...`) that
matches the `admin` configured on the deployed contracts. See
[ENVIRONMENT.md](./ENVIRONMENT.md).

## Related repositories

- [streamgive-contracts](https://github.com/streamgive/streamgive-contracts) — Soroban smart contracts
- [streamgive-frontend](https://github.com/streamgive/streamgive-frontend) — donor & NGO web app
- [streamgive-docs](https://github.com/streamgive/streamgive-docs) — documentation

## Status

Early development.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
