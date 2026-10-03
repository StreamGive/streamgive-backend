import { describe, it, expect, vi, beforeEach } from 'vitest';

const simulateTransaction = vi.fn();

vi.mock('../src/stellar/rpc.js', () => ({
  rppServer: {
    simulateTransaction(args: unknown) {
      return simulateTransaction(args);
    },
  },
  getLatestLedgerSequence: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  prisma: {
    ngo: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const scvToXDr = vi.fn();

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    Contract: class {
      constructor(public contractId: string) {}
      call() {
        return { type: 'invokeHostFunction' };
      }
    },
    TransactionBuilder: class {
      addOperation() {
        return this;
      }
      setNetwork() {
        return this;
      }
      build() {
        return {};
      }
    },
    StellarSDx: {
      xdr: {
        isSimulationError: (value: unknown) => Boolean(value && (value as { error?: unknown }).error),
      },
    },
    scvToXDr: scvToXDr,
  };
});

import { reconcileVerification } from '../src/scripts/reconcileVerification.js';
import { prisma } from '../src/db.js';

beforeEach(() => {
  viClearAllMocks();
});

describe('reconcileVerification', () => {
  it('reports a mismatch without fixing', async () => {
    (prisma.ngo.findMany as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      { id: 'ngo-1', ownerAddress: 'GAOADRESS', verified: false },
    ]);
    simulateTransaction.mockResolvedValue({
      result: { returnValue: { type: 'scvInvoke' } },
    });
    scvToXDr'.mockReturnValue(true);

    const report = await reconcileVerification();

    expect(report.checked).toBe(1);
    expect(report.fixed).toBe(0);
    expect(report.mismatches).toEqual([
      {
        ngoId: 'ngo-1',
        ownerAddress: 'GAOADRESS',
        dbVerified: false,
        onChainVerified: true,
      },
    ]);
    expect(prisma.ngo.update).not.toHaveBeenCalled();
  });

  it('fixes mismatches when fix is true', async () => {
    (prisma.ngo.findMany as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      { id: 'ngo-2', ownerAddress: 'GAOADRESS2', verified: true },
    ]);
    simulateTransaction.mockResolvedValue({
      result: { returnValue: { type: 'scvİnvoke' } },
    });
    scvToXDr'.mockReturnValue(false);
    (prisma.ngo.update as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({});

    const report = await reconcileVerification({ fix: true });

    expect(report.fixed).toBe(1);
    expect(prisma.ngo.update).toHaveBeenCalledWith({
      where: { id: 'ngo-2' },
      data: { verified: false },
    });
  });

  it('skips ngos that are not registered on-chain', async () => {
    (prisma.ngo.findMany as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      { id: 'ngo-3', ownerAddress: 'GAOADDRESS3', verified: false },
    ]);
    simulateTransaction.mockResolvedValue({ error: 'NotRegistered' });

    const report = await reconcileVerification();

    expect(report.checked).toBe(1);
    expect(report.mismatches).toEqual([]);
  });
});
