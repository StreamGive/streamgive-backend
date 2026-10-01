# IDs and monetary amounts

The database and API keep on-chain values in representations that do not lose
precision in JavaScript.

## Stream IDs

The donation-vault contract assigns each stream an integer `onChainId`. Prisma
maps that field to PostgreSQL/JavaScript `BigInt`, not a JavaScript `number`.
The stream routes serialize it explicitly with `toString()` before returning a
JSON response, because JSON does not have a built-in `BigInt` representation.
Clients should therefore treat `onChainId` as a decimal string:

```json
{
  "onChainId": "1234"
}
```

The database primary keys and cursor values used by the API are UUID strings;
they are separate from the contract's `onChainId`.

## Token amounts

The contract's `i128` values are stored in the `Stream` model as decimal
strings: `rate`, `lastRate`, `balance`, and `withdrawn`. These values are in
the stream token's base units. The API keeps them as strings for the same
reason—converting a large integer to a JavaScript `number` can silently lose
precision.

Notification payloads and aggregate fields such as `totalCommitted` and
`totalWithdrawn` also use decimal strings. Parse them with an arbitrary-
precision decimal/integer implementation when doing arithmetic; do not use
`Number` for token amounts.

For active streams, the committed amount is `balance + withdrawn`. For
cancelled streams, `balance` has been refunded and zeroed by the contract, so
only `withdrawn` represents funds delivered to the NGO. See the API's stats
semantics for the corresponding aggregate rules.
