# Webhook destinations

`notification_endpoints` stores one destination per row: `url`, `secret`,
`event_types`, and `enabled`. Event types use the names in
`src/notifications/types.ts` (for example `stream_created` and
`application_submitted`). A notification is sent only to enabled endpoints
whose event list contains its type. Destinations are called concurrently.

Every delivery is recorded in `notification_logs`. Configured endpoints use a
channel value of `webhook:<endpoint-id>`, so a success or failure can be
inspected independently for each destination. On retry, a destination that
already recorded success for an event is skipped while failed destinations
are attempted again. Logs do not include endpoint secrets or URL paths.

The existing `NOTIFY_WEBHOOK_URL` and `NOTIFY_WEBHOOK_SECRET` variables remain
available for migration: they are used as a single all-events destination
only while there are no enabled rows in the table. Once an endpoint is
enabled, table subscriptions take precedence.

Endpoint configuration is operational data. Restrict database access to
trusted operators and use HTTPS URLs for destinations.
