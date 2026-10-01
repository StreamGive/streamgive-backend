# NGO and platform statistics

The API reports stream amounts in the token's smallest (base) units. Amount
fields are decimal strings, not JavaScript numbers. Counts are JSON numbers.
The definitions below apply to both NGO detail endpoints:

- `GET /ngos/:id`
- `GET /impact/:ngoId`

## Per-stream accounting

A stream's contribution depends on its status:

| Stream status | Amount counted as committed |
| ------------- | --------------------------- |
| `ACTIVE`      | `balance + withdrawn`       |
| `CANCELLED`   | `withdrawn` only            |

When a stream is cancelled, the contract settles the accrued amount to the NGO
and refunds the remaining `balance` to the donor. The database then records a
zero balance, so counting that balance would incorrectly include refunded
funds. `withdrawn` includes amounts withdrawn during the stream and the amount
settled during cancellation.

## `GET /ngos/:id` stats

The `stats` object contains:

- **`totalCommitted`** — the sum of each stream's committed amount using the
  status rules above. It includes active funds that remain in a stream because
  they are committed for future withdrawal.
- **`totalWithdrawn`** — the sum of `withdrawn` for every stream belonging to
  the NGO, including cancelled streams.
- **`activeStreamCount`** — the number of the NGO's streams whose status is
  `ACTIVE`. Cancelled streams are not included.
- **`donorCount`** — the number of distinct donors with a stream for this NGO.
  Multiple streams from one donor count once.

## `GET /impact/:ngoId` stats

This endpoint reports the same amount semantics with impact-oriented names:

- **`totalCommitted`** and **`totalWithdrawn`** have the same definitions as
  the fields on `/ngos/:id`.
- **`activeStreams`** — the number of `ACTIVE` streams for this NGO.
- **`cancelledStreams`** — the number of `CANCELLED` streams for this NGO.
- **`uniqueDonors`** — the number of distinct donors with a stream for this
  NGO.
- **`platformSharePercent`** — this NGO's committed amount divided by the
  committed amount for every stream on the platform, multiplied by 100:

  ```text
  ngoCommitted / platformCommitted * 100
  ```

  The result is expressed as a percentage with at most two decimal places.
  The current implementation truncates, rather than rounds, beyond two
  decimal places. If the platform has no committed amount, the value is `0`.

For example, if an NGO has `1,200` committed units and the platform has `2,000`,
its `platformSharePercent` is `60`.

## `GET /impact` platform totals

The platform-wide endpoint uses the same cancellation rule and returns:

- **`totalCommitted`** — committed amount across all streams.
- **`totalWithdrawn`** — withdrawn amount across all streams.
- **`activeStreams`** — number of active streams across the platform.
- **`verifiedNgoCount`** — number of NGOs whose on-chain `verified` flag is true;
  this is independent of whether an NGO currently has streams.
