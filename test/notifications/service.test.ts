import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../src/db.js';
import { logger } from '../../src/logger.js';
import { _resetDeliveredEventIdsForTest, notify } from '../../src/notifications/service.js';
import type { NotificationEvent } from '../../src/notifications/types.js';
import { resetDb } from '../helpers/db.js';

const event: NotificationEvent = {
  type: 'stream_created',
  streamId: '1',
  donorAddress: 'GDONOR',
  ngoId: 'NGO1',
};

describe('notify', () => {
  const originalEnv = process.env.NOTIFY_WEBHOOK_URL;
  const originalSecret = process.env.NOTIFY_WEBHOOK_SECRET;
  const originalTimeout = process.env.NOTIFY_WEBHOOK_TIMEOUT_MS;

  beforeEach(async () => {
    vi.restoreAllMocks();
    _resetDeliveredEventIdsForTest();
    await resetDb();
    delete process.env.NOTIFY_WEBHOOK_URL;
    delete process.env.NOTIFY_WEBHOOK_TIMEOUT_MS;
    // Unset by default so the signing cases opt in explicitly and a stray
    // value in the developer's own .env can't make them pass for free.
    delete process.env.NOTIFY_WEBHOOK_SECRET;
  });

  afterEach(() => {
    // Assigning `undefined` to a process.env key stores the string
    // "undefined" rather than unsetting it, so delete instead when the var
    // was originally absent.
    if (originalEnv === undefined) {
      delete process.env.NOTIFY_WEBHOOK_URL;
    } else {
      process.env.NOTIFY_WEBHOOK_URL = originalEnv;
    }

    if (originalSecret === undefined) {
      delete process.env.NOTIFY_WEBHOOK_SECRET;
    } else {
      process.env.NOTIFY_WEBHOOK_SECRET = originalSecret;
    }

    if (originalTimeout === undefined) {
      delete process.env.NOTIFY_WEBHOOK_TIMEOUT_MS;
    } else {
      process.env.NOTIFY_WEBHOOK_TIMEOUT_MS = originalTimeout;
    }
  });

  const okResponse = () => new Response(null, { status: 200 });

  it('logs status code and URL when webhook returns a non-2xx response (500)', async () => {
    const webhookUrl = 'http://example.com/webhook';
    process.env.NOTIFY_WEBHOOK_URL = webhookUrl;

    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Internal Server Error' }),
    );

    await notify(event);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      { status: 500, url: 'http://example.com' },
      'webhook notification failed',
    );
  });

  it('does not throw or block notify when the webhook request rejects', async () => {
    process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/webhook';

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const failedEvent: NotificationEvent = {
      type: 'ngo_revoked',
      ownerAddress: 'G1234567890',
      ngoId: 'ngo-123',
    };

    await expect(notify(failedEvent)).resolves.not.toThrow();
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it('writes a failure record when webhook returns non-2xx', async () => {
    process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Internal Server Error' }),
    );

    await notify(event);

    const log = await prisma.notificationLog.findFirst({
      where: { channel: 'webhook', success: false },
    });
    expect(log).not.toBeNull();
    expect(log?.eventType).toBe('stream_created');
    expect(log?.error).toMatch(/500/);
  });

  it('writes a success record when webhook returns 2xx', async () => {
    process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    await notify(event);

    const log = await prisma.notificationLog.findFirst({
      where: { channel: 'webhook', success: true },
    });
    expect(log).not.toBeNull();
    expect(log?.eventType).toBe('stream_created');
  });

  it('aborts a webhook that does not respond within the configured timeout', async () => {
    process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
    process.env.NOTIFY_WEBHOOK_TIMEOUT_MS = '5';
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error('expected webhook request to have an abort signal'));
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    await expect(notify(event)).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://example.com/webhook',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const [, request] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(request.signal?.aborted).toBe(true);
  });

  it('writes an email record on every notify call', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});

    await notify(event);

    const log = await prisma.notificationLog.findFirst({ where: { channel: 'email' } });
    expect(log).not.toBeNull();
    expect(log?.success).toBe(true);
  });

  it('fires the webhook at a URL set after the module was imported', async () => {
    // Regression guard: NOTIFY_WEBHOOK_URL used to be read into a module-level
    // constant, so a value set after import was ignored for the process
    // lifetime. The import at the top of this file has already run by now.
    const webhookUrl = 'http://example.com/set-after-import';
    process.env.NOTIFY_WEBHOOK_URL = webhookUrl;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    const event: NotificationEvent = {
      type: 'stream_created',
      streamId: '1',
      donorAddress: 'GDONOR',
      ngoId: 'NGO1',
    };

    await notify(event);

    expect(fetchSpy).toHaveBeenCalledWith(
      webhookUrl,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      }),
    );
  });

  it('fans an event out only to enabled endpoints subscribed to its type', async () => {
    await prisma.notificationEndpoint.createMany({
      data: [
        {
          url: 'https://8.8.8.8/one',
          secret: 'one-secret',
          eventTypes: ['stream_created'],
        },
        {
          url: 'https://8.8.4.4/two',
          secret: 'two-secret',
          eventTypes: ['ngo_approved'],
        },
        {
          url: 'https://1.1.1.1/disabled',
          secret: 'unused-secret',
          eventTypes: ['stream_created'],
          enabled: false,
        },
      ],
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    await notify({ ...event, eventId: 'fanout-event-1' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://8.8.8.8/one',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ...event, eventId: 'fanout-event-1' }) }),
    );
    const log = await prisma.notificationLog.findFirst({
      where: { eventId: 'fanout-event-1', channel: { startsWith: 'webhook:' }, success: true },
    });
    expect(log).not.toBeNull();
  });

  it('delivers only to endpoints whose eventTypes include the event type', async () => {
    await prisma.notificationEndpoint.createMany({
      data: [
        { url: 'https://8.8.8.8/empty', secret: 'empty-secret', eventTypes: [] },
        { url: 'https://8.8.4.4/match', secret: 'match-secret', eventTypes: ['stream_created'] },
        { url: 'https://1.1.1.1/other', secret: 'other-secret', eventTypes: ['ngo_approved'] },
      ],
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    await notify({ ...event, eventId: 'filter-event-1' });

    // An empty list is not a wildcard: it matches no event type.
    const urls = fetchSpy.mock.calls.map(([url]) => url);
    expect(urls).toEqual(['https://8.8.4.4/match']);

    const channels = await prisma.notificationLog.findMany({
      where: { eventId: 'filter-event-1', channel: { startsWith: 'webhook:' } },
    });
    expect(channels).toHaveLength(1);
  });

  it('picks up a rotated NOTIFY_WEBHOOK_URL on the next call', async () => {
    process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/first';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    const event: NotificationEvent = {
      type: 'stream_withdrawn',
      streamId: '1',
      amount: '10',
    };

    await notify(event);
    process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/second';
    await notify(event);

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'http://example.com/first',
      'http://example.com/second',
    ]);
  });

  it('skips the webhook when NOTIFY_WEBHOOK_URL is unset', async () => {
    delete process.env.NOTIFY_WEBHOOK_URL;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    await notify({
      type: 'stream_cancelled',
      streamId: '1',
      settledToNgo: '5',
      refundToDonor: '5',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('delivery deduplication and retry (#270)', () => {
    it('retries delivery when a previous send attempt failed', async () => {
      process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
      vi.spyOn(logger, 'error').mockImplementation(() => {});

      // First call fails with 500 error
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const retryEvent: NotificationEvent = {
        type: 'stream_created',
        streamId: '1',
        donorAddress: 'GDONOR',
        ngoId: 'NGO1',
        eventId: 'event-retry-123',
      };

      await notify(retryEvent);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // On retry, it should try sending again because the first attempt failed
      await prisma.webhookDelivery.updateMany({
        where: { eventId: retryEvent.eventId, channel: 'webhook' },
        data: { nextAttemptAt: new Date(0) },
      });
      await notify(retryEvent);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // On duplicate call after successful delivery, it should not send again
      await notify(retryEvent);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('persists delivery across process restarts so already-delivered events are not resent', async () => {
      process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));

      const restartEvent: NotificationEvent = {
        type: 'stream_created',
        streamId: '2',
        donorAddress: 'GDONOR2',
        ngoId: 'NGO2',
        eventId: 'event-restart-456',
      };

      // Successfully delivers on first try
      await notify(restartEvent);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Verify delivery record was persisted in database
      const log = await prisma.notificationLog.findFirst({
        where: { eventId: restartEvent.eventId, success: true },
      });
      expect(log).not.toBeNull();

      // Simulate process restart by clearing the in-memory deduplication set
      _resetDeliveredEventIdsForTest();

      // On re-delivery attempt after restart, it checks persisted database log and skips
      await notify(restartEvent);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('persists failed attempts and gives up after the configured maximum', async () => {
      process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 503 }));
      const eventWithId: NotificationEvent = {
        type: 'stream_created',
        streamId: '5',
        donorAddress: 'GDONOR',
        ngoId: 'NGO1',
        eventId: 'event-max-attempts',
      };
      const eventId = 'event-max-attempts';

      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (attempt > 0) {
          await prisma.webhookDelivery.updateMany({
            where: { eventId, channel: 'webhook' },
            data: { nextAttemptAt: new Date(0) },
          });
        }
        await notify(eventWithId);
      }

      const delivery = await prisma.webhookDelivery.findUnique({
        where: {
          deliveryKey: JSON.stringify([eventId, 'webhook']),
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(5);
      expect(delivery?.attempts).toBe(5);
      expect(delivery?.status).toBe('FAILED');
      expect(delivery?.lastError).toContain('503');
    });

    it('retries persisted deliveries in the worker after a later due time', async () => {
      process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 500 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      const eventWithId: NotificationEvent = {
        type: 'ngo_approved',
        ownerAddress: 'GOWNER',
        ngoId: 'NGO1',
        eventId: 'event-worker-retry',
      };
      const eventId = 'event-worker-retry';

      await notify(eventWithId);
      await prisma.webhookDelivery.updateMany({
        where: { eventId, channel: 'webhook' },
        data: { nextAttemptAt: new Date(0) },
      });
      const { processDueWebhookDeliveries } =
        await import('../../src/notifications/webhookDeliveryWorker.js');
      await processDueWebhookDeliveries();

      const delivery = await prisma.webhookDelivery.findUnique({
        where: {
          deliveryKey: JSON.stringify([eventId, 'webhook']),
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(delivery?.status).toBe('SUCCEEDED');
      expect(delivery?.attempts).toBe(2);
    });
  });

  describe('webhook signature', () => {
    const event: NotificationEvent = {
      type: 'stream_created',
      streamId: '1',
      donorAddress: 'GDONOR',
      ngoId: 'NGO1',
    };

    /** Captures the single fetch the webhook notifier makes. */
    function captureWebhookRequest() {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 204 }));
      vi.spyOn(logger, 'info').mockImplementation(() => {});
      return fetchSpy;
    }

    it('signs the timestamp, delivery id, and body with a versioned HMAC-SHA256', async () => {
      process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
      process.env.NOTIFY_WEBHOOK_SECRET = 'a-shared-secret';

      const fetchSpy = captureWebhookRequest();

      await notify(event);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const body = init.body as string;
      const deliveryId = headers['x-streamgive-delivery-id'];
      const timestamp = headers['x-streamgive-timestamp'];

      const expected = createHmac('sha256', 'a-shared-secret')
        .update(`${timestamp}.${deliveryId}.${body}`)
        .digest('hex');

      expect(deliveryId).toMatch(/^[0-9a-f-]{36}$/);
      expect(Number(timestamp)).toBeGreaterThan(0);
      expect(headers['x-streamgive-signature']).toBe(`v1=${expected}`);
    });

    it('signs the exact bytes sent as the body, not a re-serialisation', async () => {
      process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
      process.env.NOTIFY_WEBHOOK_SECRET = 'a-shared-secret';

      const fetchSpy = captureWebhookRequest();

      await notify(event);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const signature = headers['x-streamgive-signature'];
      const deliveryId = headers['x-streamgive-delivery-id'];
      const timestamp = headers['x-streamgive-timestamp'];

      const verified = createHmac('sha256', 'a-shared-secret')
        .update(`${timestamp}.${deliveryId}.${Buffer.from(init.body as string, 'utf8').toString()}`)
        .digest('hex');

      expect(signature).toBe(`v1=${verified}`);
      expect(JSON.parse(init.body as string)).toEqual(event);
    });

    it('rejects a tampered body: the signature no longer matches', async () => {
      process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';
      process.env.NOTIFY_WEBHOOK_SECRET = 'a-shared-secret';

      const fetchSpy = captureWebhookRequest();

      await notify(event);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      const forged = JSON.stringify({ ...event, ngoId: 'ATTACKER-NGO' });
      const forgedDigest = createHmac('sha256', 'a-shared-secret')
        .update(
          `${headers['x-streamgive-timestamp']}.${headers['x-streamgive-delivery-id']}.${forged}`,
        )
        .digest('hex');

      expect(`v1=${forgedDigest}`).not.toBe(headers['x-streamgive-signature']);
    });

    it('omits the signature header when no secret is configured', async () => {
      process.env.NOTIFY_WEBHOOK_URL = 'http://example.com/webhook';

      const fetchSpy = captureWebhookRequest();

      await notify(event);

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers['x-streamgive-signature']).toBeUndefined();
      expect(headers['x-streamgive-delivery-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(Number(headers['x-streamgive-timestamp'])).toBeGreaterThan(0);
      expect(headers['content-type']).toBe('application/json');
    });
  });
});
