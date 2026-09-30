
import { prisma } from './db.js';

const CHECKPOINT_ID = 'singleton';

export function startIndexer(pollOnce: () => Promise<void>, intervalMs: number) {
  let timeoutId: NodeJS.Timeout | null = null;
  let isStopped = false;
  let isPolling = false;

  const poll = async () => {
    if (isStopped) return;

    if (isPolling) {
      // Skip this tick if a poll is already in flight
      scheduleNext();
      return;
    }

    isPolling = true;
    try {
      await pollOnce();
    } catch (error) {
      console.error('Error during indexer poll:', error);
    } finally {
      isPolling = false;
      scheduleNext();
    }
  };

  const scheduleNext = () => {
    if (isStopped) return;
    timeoutId = setTimeout(poll, intervalMs);
  };

  // Kick off the initial poll
  poll();

  // Return stop function that cancels any pending timer
  return () => {
    isStopped = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}

/** Minimal shape of the events page this module consumes. The real
 *  `rpcServer` from ./stellar/rpc.js satisfies it, and tests can pass a
 *  stub without the module pulling the Stellar SDK in. */
interface RpcEventsPage {
  events?: { id: string }[];
  nextCursor?: string;
}

interface RpcEventsClient {
  getEvents(params: { cursor?: string; limit: number }): Promise<RpcEventsPage>;
}

export async function pollOnce(
  rpcClient: RpcEventsClient,
  processEvent: (event: { id: string }) => Promise<void>,
) {
  let currentCursor: string | undefined = await getStoredCursor();
  const PAGE_LIMIT = 100; // Adjust according to your RPC client configuration
  let hasMore = true;

  while (hasMore) {
    const response = await rpcClient.getEvents({
      cursor: currentCursor,
      limit: PAGE_LIMIT,
    });

    const events = response.events || [];

    // Process each event in the current page sequentially
    for (const event of events) {
      await processEvent(event);
      currentCursor = String(event.id); // Update cursor to latest processed event
      await saveCursor(currentCursor);
    }

    // If the page size is less than the limit, or no next cursor is provided, we've reached the end
    if (events.length < PAGE_LIMIT || !response.nextCursor) {
      hasMore = false;
    } else {
      currentCursor = response.nextCursor;
    }
  }
}

/** Resume point as an RPC paging token. `undefined` means "from the oldest
 *  event the RPC still serves", which is the only safe default for a cursor
 *  that is optional. */
async function getStoredCursor(): Promise<string | undefined> {
  const row = await prisma.indexerCheckpoint.findUnique({
    where: { id: CHECKPOINT_ID },
    select: { lastEventId: true },
  });
  return row?.lastEventId ?? undefined;
}

async function saveCursor(cursor: string): Promise<void> {
  await prisma.indexerCheckpoint.upsert({
    where: { id: CHECKPOINT_ID },
    // `lastLedger` is left untouched: this cursor tracks position *within*
    // a ledger, and overwriting it with a stale value would rewind the
    // ledger-granular checkpoint the worker maintains.
    create: { id: CHECKPOINT_ID, lastLedger: 0n, lastEventId: cursor },
    update: { lastEventId: cursor },
  });
}