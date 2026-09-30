import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks are hoisted and registered before any import resolution. The worker
// module reads process.env at module-evaluation time, so we re-import it
// fresh per test (via freshWorker) to pick up env var changes and reset the
// module-level `lastProcessedLedger` cache.
vi.mock('../../src/indexer/checkpoint.js', () => ({
  getCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/stellar/rpc.js', () => ({
  getLatestLedgerSequence: vi.fn(),
  rpcServer: { getEvents: vi.fn().mockResolvedValue({ events: [] }) },
}));
vi.mock('../../src/indexer/contracts.js', () => ({
  WATCHED_CONTRACT_IDS: ['CONTRACT_A'],
}));

const checkpoint = await import('../../src/indexer/checkpoint.js');
const rpc = await import('../../src/stellar/rpc.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkpoint.saveCheckpoint).mockResolvedValue(undefined);
  process.env.INDEXER_POLL_INTERVAL_MS = '50';
});

afterEach(() => {
  delete process.env.INDEXER_START_LEDGER;
  delete process.env.INDEXER_MAX_EVENTS_PER_POLL;
  delete process.env.INDEXER_POLL_INTERVAL_MS;
});

// Returns a fresh worker module so the module-level `lastProcessedLedger`
// state and top-level env var constants are re-read on each test.
async function freshWorker() {
  vi.resetModules();
  vi.doMock('../../src/indexer/checkpoint.js', () => ({
    getCheckpoint: checkpoint.getCheckpoint,
    saveCheckpoint: checkpoint.saveCheckpoint,
  }));
  vi.doMock('../../src/stellar/rpc.js', () => ({
    getLatestLedgerSequence: rpc.getLatestLedgerSequence,
    rpcServer: rpc.rpcServer,
  }));
  vi.doMock('../../src/indexer/contracts.js', () => ({
    WATCHED_CONTRACT_IDS: ['CONTRACT_A'],
  }));
  return import('../../src/indexer/worker.js');
}

function runWorkerBriefly(startIndexer: (h: () => Promise<void>) => () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = startIndexer(async () => {});
    // Allow exactly the first 50ms tick, then stop before the next poll.
    setTimeout(() => {
      stop();
      resolve();
    }, 60);
  });
}

describe('worker bootstrap (no existing checkpoint)', () => {
  it('saves INDEXER_START_LEDGER as the initial checkpoint when set', async () => {
    process.env.INDEXER_START_LEDGER = '1000';
    vi.mocked(checkpoint.getCheckpoint).mockResolvedValue(undefined);
    vi.mocked(rpc.getLatestLedgerSequence).mockResolvedValue(9999);

    const { startIndexer } = await freshWorker();
    await runWorkerBriefly(startIndexer);

    expect(checkpoint.saveCheckpoint).toHaveBeenCalledWith(1000);
    expect(rpc.getLatestLedgerSequence).not.toHaveBeenCalled();
  });

  it('falls back to the latest ledger when INDEXER_START_LEDGER is not set', async () => {
    vi.mocked(checkpoint.getCheckpoint).mockResolvedValue(undefined);
    vi.mocked(rpc.getLatestLedgerSequence).mockResolvedValue(5000);

    const { startIndexer } = await freshWorker();
    await runWorkerBriefly(startIndexer);

    expect(rpc.getLatestLedgerSequence).toHaveBeenCalled();
    expect(checkpoint.saveCheckpoint).toHaveBeenCalledWith(5000);
  });

  it('ignores INDEXER_START_LEDGER when a checkpoint already exists', async () => {
    process.env.INDEXER_START_LEDGER = '1000';
    vi.mocked(checkpoint.getCheckpoint).mockResolvedValue({ lastLedger: 8000 });
    vi.mocked(rpc.getLatestLedgerSequence).mockResolvedValue(9999);

    const { startIndexer } = await freshWorker();
    await runWorkerBriefly(startIndexer);

    // Resumed from existing checkpoint — the env var must be ignored
    expect(checkpoint.saveCheckpoint).not.toHaveBeenCalledWith(1000);
  });
});

describe('events-per-poll cap', () => {
  it('caps the RPC page and checkpoints the last handled event', async () => {
    process.env.INDEXER_MAX_EVENTS_PER_POLL = '2';
    vi.mocked(checkpoint.getCheckpoint).mockResolvedValue({ lastLedger: 100 });
    vi.mocked(rpc.getLatestLedgerSequence).mockResolvedValue(200);

    const events = [
      { id: 'event-1', ledger: 101 },
      { id: 'event-2', ledger: 101 },
      { id: 'event-3', ledger: 102 },
    ];
    vi.mocked(rpc.rpcServer.getEvents).mockImplementation(async (request) =>
      ({ events: events.slice(0, request.limit) }) as Awaited<
        ReturnType<typeof rpc.rpcServer.getEvents>
      >,
    );

    const handled: string[] = [];
    const { startIndexer } = await freshWorker();
    const stop = startIndexer(async (event) => {
      handled.push(event.id);
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    await stop();

    expect(rpc.rpcServer.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, startLedger: 101 }),
    );
    expect(handled).toEqual(['event-1', 'event-2']);
    expect(checkpoint.saveCheckpoint).toHaveBeenLastCalledWith(101, 'event-2');
  });

  it('rejects a non-positive cap deterministically', async () => {
    process.env.INDEXER_MAX_EVENTS_PER_POLL = '0';

    await expect(freshWorker()).rejects.toThrow(
      'INDEXER_MAX_EVENTS_PER_POLL must be a positive integer',
    );
  });
});
