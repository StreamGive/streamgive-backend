import { createHmac, randomUUID } from 'node:crypto';

import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import { recordNotificationDelivery } from '../metrics.js';
import type { NotificationEvent } from './types.js';

const deliveredEventIds = new Set<string>();
const MAX_DELIVERED_EVENT_IDS = 10_000;
const MAX_WEBHOOK_ATTEMPTS = 5;
const WEBHOOK_RETRY_BASE_MS = 1_000;
const WEBHOOK_RETRY_MAX_MS = 5 * 60_000;
const WEBHOOK_DELIVERY_LOCK_MS = 60_000;
const WEBHOOK_DELIVERY_POLL_MS = 1_000;

export function _resetDeliveredEventIdsForTest(): void {
  deliveredEventIds.clear();
}

/**
 * Header carrying a versioned HMAC-SHA256 of the timestamp, delivery ID,
 * and request body, keyed with `NOTIFY_WEBHOOK_SECRET`. See the
 * "Notification events" section of the README for receiver verification.
 */
const SIGNATURE_HEADER = 'x-streamgive-signature';
const TIMESTAMP_HEADER = 'x-streamgive-timestamp';
const DELIVERY_HEADER = 'x-streamgive-delivery';
const DEFAULT_WEBHOOK_TIMEOUT_MS = 3_000;

function getWebhookTimeoutMs(): number {
  const configured = Number(process.env.NOTIFY_WEBHOOK_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 2_147_483_647)
    : DEFAULT_WEBHOOK_TIMEOUT_MS;
}

/** Real (if NOTIFY_WEBHOOK_URL is set): POSTs the event as JSON. Node's
 * built-in fetch means this needs no extra dependency. */
async function notifyWebhook(
  event: NotificationEvent,
  deliveryId?: string,
): Promise<boolean> {
  // Deliberately read per call rather than captured at module load: hoisting
  // this to a module-level constant freezes the URL at import time, so a
  // value set (or rotated) later in the process lifetime would be ignored
  // until a restart. test/notifications/service.test.ts guards this.
  const webhookUrl = process.env.NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) return true;

  // Serialised once and reused as both the signed input and the request
  // body. Signing a second `JSON.stringify(event)` would work today but
  // couples the signature to key ordering staying identical between two
  // calls — the receiver verifies against the raw bytes it read off the
  // wire, so those bytes are what has to be signed.
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestDeliveryId = deliveryId ?? randomUUID();

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [TIMESTAMP_HEADER]: timestamp,
    [DELIVERY_HEADER]: requestDeliveryId,
  };

  // Read per call rather than at module load so deployments can rotate the
  // secret without a restart, and so tests can set it per case.
  const secret = process.env.NOTIFY_WEBHOOK_SECRET;
  if (secret) {
    const signedPayload = `${timestamp}.${requestDeliveryId}.${body}`;
    headers[SIGNATURE_HEADER] =
      `v1=${createHmac('sha256', secret).update(signedPayload).digest('hex')}`;
  }

  let success = false;
  let error: string | undefined;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(getWebhookTimeoutMs()),
    });

    if (res.ok) {
      success = true;
    } else {
      error = `status ${res.status}`;
      console.error(`webhook notification failed with status ${res.status} for ${webhookUrl}`);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error('webhook notification failed', err);
  }

  recordNotificationDelivery(success ? 'success' : 'failure');

  try {
    await prisma.notificationLog.create({
      data: {
        eventId: success ? event.eventId : null,
        eventType: event.type,
        channel: 'webhook',
        success,
        error,
      },
    });
  } catch (err) {
    console.error('failed to write notification log', err);
  }

  return success;
}

function isNotificationEvent(value: unknown): value is NotificationEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (payload.eventId !== undefined && typeof payload.eventId !== 'string') return false;

  switch (payload.type) {
    case 'stream_created':
      return (
        typeof payload.streamId === 'string' &&
        typeof payload.donorAddress === 'string' &&
        typeof payload.ngoId === 'string'
      );
    case 'stream_withdrawn':
      return typeof payload.streamId === 'string' && typeof payload.amount === 'string';
    case 'stream_cancelled':
      return (
        typeof payload.streamId === 'string' &&
        typeof payload.settledToNgo === 'string' &&
        typeof payload.refundToDonor === 'string'
      );
    case 'ngo_approved':
    case 'ngo_revoked':
      return typeof payload.ownerAddress === 'string' && typeof payload.ngoId === 'string';
    case 'application_submitted':
      return (
        typeof payload.applicationId === 'string' &&
        typeof payload.ownerAddress === 'string' &&
        typeof payload.name === 'string'
      );
    case 'application_reviewed':
      return (
        typeof payload.applicationId === 'string' &&
        typeof payload.ownerAddress === 'string' &&
        (payload.status === 'APPROVED' || payload.status === 'REJECTED') &&
        (payload.reviewNote === undefined || typeof payload.reviewNote === 'string')
      );
    default:
      return false;
  }
}

function retryDelayMs(attempt: number): number {
  return Math.min(WEBHOOK_RETRY_BASE_MS * 2 ** (attempt - 1), WEBHOOK_RETRY_MAX_MS);
}

async function deliverWebhookDelivery(id: string): Promise<boolean> {
  const now = new Date();
  const expiredLock = new Date(now.getTime() - WEBHOOK_DELIVERY_LOCK_MS);
  const claim = await prisma.webhookDelivery.updateMany({
    where: {
      id,
      status: 'PENDING',
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: expiredLock } }],
    },
    data: {
      attempts: { increment: 1 },
      lockedAt: now,
    },
  });
  if (claim.count === 0) return false;

  const delivery = await prisma.webhookDelivery.findUnique({ where: { id } });
  if (!delivery) {
    throw new Error(`claimed webhook delivery ${id} disappeared`);
  }
  if (!isNotificationEvent(delivery.payload)) {
    throw new Error(`webhook delivery ${id} contains an invalid notification payload`);
  }

  let success = false;
  let error: string | undefined;
  try {
    success = await notifyWebhook(delivery.payload, delivery.id);
    if (!success) error = 'webhook request failed';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.error(`webhook delivery ${id} failed before request completion`, err);
  }

  const exhausted = !success && delivery.attempts >= MAX_WEBHOOK_ATTEMPTS;
  await prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: success ? 'DELIVERED' : exhausted ? 'FAILED' : 'PENDING',
      nextAttemptAt: new Date(Date.now() + retryDelayMs(delivery.attempts)),
      lockedAt: null,
      lastError: success ? null : error ?? 'webhook delivery failed',
    },
  });
  return success;
}

/** Processes due persisted deliveries; safe to call from multiple workers. */
export async function processPendingWebhookDeliveries(): Promise<void> {
  if (!process.env.NOTIFY_WEBHOOK_URL) return;

  const now = new Date();
  const expiredLock = new Date(now.getTime() - WEBHOOK_DELIVERY_LOCK_MS);
  await prisma.webhookDelivery.updateMany({
    where: {
      status: 'PENDING',
      attempts: { gte: MAX_WEBHOOK_ATTEMPTS },
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: expiredLock } }],
    },
    data: { status: 'FAILED', lockedAt: null },
  });

  const due = await prisma.webhookDelivery.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: now },
      OR: [{ lockedAt: null }, { lockedAt: { lt: expiredLock } }],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: 50,
    select: { id: true },
  });

  for (const delivery of due) {
    await deliverWebhookDelivery(delivery.id);
  }
}

/** Starts the persistent retry poller; its stop function waits for in-flight work. */
export function startWebhookDeliveryWorker(): () => Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;

  const run = () => {
    if (stopped) return;
    inFlight = processPendingWebhookDeliveries()
      .catch((err) => console.error('webhook delivery retry poll failed', err))
      .finally(() => {
        inFlight = undefined;
        if (!stopped) timer = setTimeout(run, WEBHOOK_DELIVERY_POLL_MS);
      });
  };

  run();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}

/** Stub: no email provider wired up yet — picking one (SendGrid, Postmark,
 * Resend, ...) is a separate decision. `notify()` below is the only thing
 * the rest of the app calls, so swapping this out later touches no call
 * sites. */
async function notifyEmail(event: NotificationEvent): Promise<void> {
  console.log('[notify:email:stub]', event);

  try {
    await prisma.notificationLog.create({
      data: {
        eventType: event.type,
        channel: 'email',
        success: true,
      },
    });
  } catch (err) {
    console.error('failed to write email notification log', err);
  }
}

export async function notify(event: NotificationEvent): Promise<void> {
  if (event.eventId) {
    if (deliveredEventIds.has(event.eventId)) return;

    try {
      const persisted = await prisma.notificationLog.findFirst({
        where: { eventId: event.eventId, success: true },
      });
      if (persisted) {
        deliveredEventIds.add(event.eventId);
        return;
      }
    } catch (err) {
      console.error('failed to check persisted notification delivery', err);
    }
  }

  let webhookSuccess: boolean;
  if (!process.env.NOTIFY_WEBHOOK_URL) {
    webhookSuccess = await notifyWebhook(event);
  } else {
    const payload = JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue;
    const delivery = event.eventId
      ? await prisma.webhookDelivery.upsert({
          where: { eventId: event.eventId },
          create: {
            eventId: event.eventId,
            eventType: event.type,
            payload,
          },
          update: {},
        })
      : await prisma.webhookDelivery.create({
          data: { eventType: event.type, payload },
        });

    if (delivery.status === 'PENDING') {
      webhookSuccess = await deliverWebhookDelivery(delivery.id);
    } else {
      webhookSuccess = delivery.status === 'DELIVERED';
    }
  }

  await notifyEmail(event);

  // Mark delivered only after successful delivery
  if (event.eventId && webhookSuccess) {
    deliveredEventIds.add(event.eventId);
    if (deliveredEventIds.size > MAX_DELIVERED_EVENT_IDS) {
      const oldest = deliveredEventIds.values().next().value;
      if (oldest) deliveredEventIds.delete(oldest);
    }

    if (!process.env.NOTIFY_WEBHOOK_URL) {
      try {
        await prisma.notificationLog.create({
          data: {
            eventId: event.eventId,
            eventType: event.type,
            channel: 'webhook',
            success: true,
          },
        });
      } catch (err) {
        console.error('failed to persist delivery record', err);
      }
    }
  }
}

/**
 * Dispatches a notification asynchronously after transaction commit,
 * ensuring any errors are caught and do not propagate back into the handler
 * or block the indexer.
 */
export function dispatchNotification(event: NotificationEvent): void {
  notify(event).catch((err) => {
    console.error('asynchronous notification dispatch failed', err);
  });
}
