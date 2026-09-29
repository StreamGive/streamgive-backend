import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pollOnce } from '../../src/indexer/worker.js';

/**
 * pollOnce's only outward effects are the RPC call and the checkpoint
 * read/write, so those are exactly what this test needs to observe. Mocking
 * the modules (rather than spying on the real ones) also pins the
 * "no contract ids" precondition explicitly, instead of depending on
 * whether the machine running the suite happens to have the contract ids
 * set in its environment.
 */
const mocks = vi.hoisted(() => ({
  getEvents: vi.fn(),
  getLatestLedgerSequence: vi.fn(),
  getCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
}));

vi.mock('../../src/stellar/rpc.js', () => ({
  rpcServer: { getEvents: mocks.getEvents },
  getLatestLedgerSequence: mocks.getLatestLedgerSequence,
}));

vi.mock('../../src/indexer/checkpoint.js', () => ({
  getCheckpoint: mocks.getCheckpoint,
  saveCheckpoint: mocks.saveCheckpoint,
}));

vi.mock('../../src/indexer/contracts.js', () => ({
  NGO_REGISTRY_CONTRACT_ID: '',
  DONATION_VAULT_CONTRACT_ID: '',
  WATCHED_CONTRACT_IDS: [],
}));

describe('pollOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops when no contract ids are configured', async () => {
    const handleEvent = vi.fn();

    await pollOnce(handleEvent);

    // The guard has to return before any I/O. In particular it must not
    // fall through to `getLatestLedgerSequence()` + `saveCheckpoint()`:
    // with nothing watched, that would persist a checkpoint derived from an
    // RPC call whose events we were never going to read.
    expect(mocks.getEvents).not.toHaveBeenCalled();
    expect(mocks.getLatestLedgerSequence).not.toHaveBeenCalled();
    expect(mocks.getCheckpoint).not.toHaveBeenCalled();
    expect(mocks.saveCheckpoint).not.toHaveBeenCalled();
    expect(handleEvent).not.toHaveBeenCalled();
  });
});
