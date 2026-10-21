# Notifications

StreamGive emits notification events when donations move or an NGO's
verification status changes. Every event is delivered as a JSON POST to the
configured webhook URL and (once an email provider is wired up) as an email.
This page documents the payload of every event type, the HTTP headers
sent, the request timeout, the delivery and retry semantics, and how to
verify a request's signature.

> The source of truth for the payload shapes is
> [`src/notifications/types.ts`](../src/notifications/types.ts). The delivery
> logic lives in [`src/notifications/service.ts`](../src/notifications/service.ts).

## Configuration

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NOTIFY_WEBHOOK_URL` | No | — (empty) | If set, every event is POSTed here as JSON. When unset, the webhook delivery is skipped. |
| `NOTIFY_WEBHOOK_TIMEOUT_MS` | No | `3000` | Maximum duration in milliseconds for a webhook request. Invalid or non-positive values fall back to the default. Capped at `2_147_483_647`. |
| `NOTIFY_WEBHOOK_SECRET` | No | — (empty) | If set, every webhook POST carries an `x-streamgive-signature` header (see [Signature](#signature)). Omitted entirely when unset. |
| `RESEND_API_KEY` | No | — | Resend API key for email delivery. Email is in log-only stub mode until this is set. |
| `NOTIFY_EMAIL_FROM` | No | — | Sender address. Required when `RESEND_API_KEY` is set. |
| `NOTIFY_EMAIL_TO` | No | — | Recipient address for notification emails. Skipped when unset. |

## Event types

Seven event types are emitted. Each is a JSON object with a `type` field
and type-specific fields. All monetary amounts are integers represented as
**strings** (the smallest unit of the token — stroops — exactly as they
appear on-chain), because the values exceed JavaScript's safe-integer limit.

### `stream_created`

Emitted by the indexer when a donor opens a new streaming donation.

```json
{
  "type": "stream_created",
  "streamId": "42",
  "donorAddress": "GDONOREXAMPLE...",
  "ngoId": "clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "eventId": "event-abc123"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"stream_created"` | Event discriminator. |
| `streamId` | string | On-chain stream id, as a decimal string. |
| `donorAddress` | string | Donor's Stellar public key (`G…`). |
| `ngoId` | string | Internal database id (UUID) of the NGO receiving the stream. |
| `eventId` | string (optional) | On-chain event id from the Stellar RPC. Used for delivery deduplication. |

### `stream_withdrawn`

Emitted by the indexer when accrued funds are withdrawn to the NGO from an
active stream.

```json
{
  "type": "stream_withdrawn",
  "streamId": "42",
  "amount": "10000000",
  "eventId": "event-abc124"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"stream_withdrawn"` | Event discriminator. |
| `streamId` | string | On-chain stream id, as a decimal string. |
| `amount` | string | Accrued amount withdrawn, in the token's smallest unit. |
| `eventId` | string (optional) | On-chain event id. |

### `stream_cancelled`

Emitted by the indexer when a stream is cancelled, settling accrued funds to
the NGO and refunding the remaining balance to the donor.

```json
{
  "type": "stream_cancelled",
  "streamId": "42",
  "settledToNgo": "5000000",
  "refundToDonor": "5000000",
  "eventId": "event-abc125"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"stream_cancelled"` | Event discriminator. |
| `streamId` | string | On-chain stream id, as a decimal string. |
| `settledToNgo` | string | Amount settled to the NGO, in the token's smallest unit. |
| `refundToDonor` | string | Amount refunded to the donor, in the token's smallest unit. |
| `eventId` | string (optional) | On-chain event id. |

### `ngo_approved`

Emitted by the indexer when an admin approves a registered NGO on-chain.

```json
{
  "type": "ngo_approved",
  "ownerAddress": "GNGOEXAMPLE...",
  "ngoId": "clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "eventId": "event-abc126"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"ngo_approved"` | Event discriminator. |
| `ownerAddress` | string | NGO owner's Stellar public key (`G…`). |
| `ngoId` | string | Internal database id (UUID) of the NGO. |
| `eventId` | string (optional) | On-chain event id. |

### `ngo_revoked`

Emitted by the indexer when an admin revokes a previously-approved NGO
on-chain.

```json
{
  "type": "ngo_revoked",
  "ownerAddress": "GNGOEXAMPLE...",
  "ngoId": "clxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "eventId": "event-abc127"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"ngo_revoked"` | Event discriminator. |
| `ownerAddress` | string | NGO owner's Stellar public key (`G…`). |
| `ngoId` | string | Internal database id (UUID) of the NGO. |
| `eventId` | string (optional) | On-chain event id. |

### `application_submitted`

Emitted by the API when an NGO submits an off-chain application. Unlike the
indexer-driven events above, this one carries no `eventId` because it is
triggered by an HTTP request, not an on-chain event.

```json
{
  "type": "application_submitted",
  "applicationId": "550e8400-e29b-41d4-a716-446655440000",
  "ownerAddress": "GNGOEXAMPLE...",
  "name": "Example Charity"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"application_submitted"` | Event discriminator. |
| `applicationId` | string | Application id (UUID). |
| `ownerAddress` | string | NGO owner's Stellar public key (`G…`). |
| `name` | string | Organisation name as submitted. |
| `eventId` | string (optional) | Always omitted for this type. |

### `application_reviewed`

Emitted by the API when an admin approves or rejects a pending application.
Like `application_submitted`, it carries no `eventId`.

```json
{
  "type": "application_reviewed",
  "applicationId": "550e8400-e29b-41d4-a716-446655440000",
  "ownerAddress": "GNGOEXAMPLE...",
  "status": "APPROVED",
  "reviewNote": "All documents verified."
}
```

When there is no review note, the `reviewNote` field is omitted entirely
rather than set to `null` or an empty string.

| Field | Type | Description |
| --- | --- | --- |
| `type` | `"application_reviewed"` | Event discriminator. |
| `applicationId` | string | Application id (UUID). |
| `ownerAddress` | string | NGO owner's Stellar public key (`G…`). |
| `status` | `"APPROVED"` \| `"REJECTED"` | Review outcome. |
| `reviewNote` | string (optional) | Admin's note, up to 2000 characters. Present only when one was provided. |
| `eventId` | string (optional) | Always omitted for this type. |

## Delivery

### Webhook

When `NOTIFY_WEBHOOK_URL` is set, every notification is delivered as an HTTP
POST to that URL:

```
POST <NOTIFY_WEBHOOK_URL>
Content-Type: application/json
x-streamgive-signature: <hex>        ← only when NOTIFY_WEBHOOK_SECRET is set

<raw JSON body>
```

- **Method**: `POST`
- **Content type**: `application/json`
- **Body**: the JSON-serialised event object (`JSON.stringify(event)`)
- **Timeout**: `NOTIFY_WEBHOOK_TIMEOUT_MS` (default 3000 ms), enforced via
  `AbortSignal.timeout`. A request that does not respond in time is aborted.
- **Retries**: none. A failed delivery (timeout, network error, or non-2xx
  response) is logged but not retried. The event is recorded in the
  `notification_logs` table with the outcome and any error message.
- **Non-blocking**: delivery failures never throw back to the caller. The
  indexer dispatches notifications asynchronously after committing its
  database transaction, so a slow or dead webhook cannot stall indexing.

### Email

Email delivery is currently a **stub**: the event is logged to the console
and a `notification_logs` row is written, but no email is sent. The
`RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, and `NOTIFY_EMAIL_TO` environment
variables are reserved for when a provider is wired in.

### Deduplication

Indexer-driven events carry an `eventId` (the on-chain event id from the
Stellar RPC). The notification service keeps an in-memory set of delivered
event ids and also checks the `notification_logs` table, so an event that
has already been delivered successfully is skipped on retry. The in-memory
set is bounded at 10 000 entries (oldest evicted first) and is cleared on
process restart; the database check covers restarts.

API-driven events (`application_submitted`, `application_reviewed`) do not
carry an `eventId` and are therefore not deduplicated — each API call
produces exactly one notification.

### `notification_logs` table

Every delivery attempt — webhook and email — writes a row to the
`notification_logs` table recording the event type, channel, success
status, and error message (if any). This is the audit trail for diagnosing
delivery failures:

```sql
SELECT event_type, channel, success, error, created_at
FROM notification_logs
ORDER BY created_at DESC
LIMIT 50;
```

## Headers

| Header | Always sent? | Description |
| --- | --- | --- |
| `Content-Type` | Yes | `application/json` |
| `x-streamgive-signature` | Only when `NOTIFY_WEBHOOK_SECRET` is set | Lower-case hex HMAC-SHA256 of the raw request body, keyed with the secret. No prefix, timestamp, or version tag. |

## Signature

The webhook URL is not a secret — anyone who learns it can POST whatever
they like to your receiver. Set `NOTIFY_WEBHOOK_SECRET` to a shared secret
and every request will additionally carry:

```
x-streamgive-signature: <hex>
```

where `<hex>` is the lower-case hex HMAC-SHA256 of the **raw request body**,
keyed with `NOTIFY_WEBHOOK_SECRET`. There is no prefix, timestamp or version
tag in the value — it is the bare digest.

Verify it against the bytes you read off the wire, before parsing them as
JSON: re-serialising the parsed object can reorder keys or change
whitespace, and the digest would no longer match. Compare in constant time
so the comparison itself does not leak the expected digest a byte at a
time.

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
