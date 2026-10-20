import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/notifications/service.js', () => ({ dispatchNotification: vi.fn() }));

import { prisma } from '../../src/db.js';
import { handleNgoRegistryEvent } from '../../src/indexer/handlers/ngoRegistry.js';
import { dispatchNotification } from '../../src/notifications/service.js';
import { fakeAddress, resetDb } from '../helpers/db.js';
import { addressScVal, makeEvent, stringScVal, symbolScVal } from '../helpers/events.js';

describe('handleNgoRegistryEvent', () => {
  afterEach(async () => {
    vi.mocked(dispatchNotification).mockClear();
    await resetDb();
  });

  it('creates an unverified NGO on a register event', async () => {
    const owner = fakeAddress('A');

    await handleNgoRegistryEvent(
      makeEvent([symbolScVal('register'), addressScVal(owner)], stringScVal('Red Cross')),
    );

    const ngo = await prisma.ngo.findUnique({ where: { ownerAddress: owner } });
    expect(ngo?.name).toBe('Red Cross');
    expect(ngo?.verified).toBe(false);

    // A StreamEvent row must be written atomically with the ngo upsert.
    const streamEvent = await prisma.streamEvent.findFirst({ where: { type: 'register' } });
    expect(streamEvent).not.toBeNull();
    expect(streamEvent?.streamId).toBeNull();
    expect(streamEvent?.ledger).toBe(100);
    expect(streamEvent?.payload).toMatchObject({ ownerAddress: owner, name: 'Red Cross' });
  });

  it('marks an existing NGO verified on an approved event', async () => {
    const owner = fakeAddress('B');
    await prisma.ngo.create({ data: { ownerAddress: owner, name: 'Doctors Without Borders' } });

    await handleNgoRegistryEvent(makeEvent([symbolScVal('approved'), addressScVal(owner)], stringScVal('')));

    const ngo = await prisma.ngo.findUnique({ where: { ownerAddress: owner } });
    expect(ngo?.verified).toBe(true);

    // A StreamEvent row must be written atomically with the ngo update.
    const streamEvent = await prisma.streamEvent.findFirst({ where: { type: 'approved' } });
    expect(streamEvent).not.toBeNull();
    expect(streamEvent?.streamId).toBeNull();
    expect(streamEvent?.payload).toMatchObject({ ownerAddress: owner });
  });

  it('is a no-op for an approved event with no matching NGO', async () => {
    const owner = fakeAddress('C');

    // Should not throw even though no NGO row exists for this address —
    // updateMany (not update) is exactly for this case.
    await expect(
      handleNgoRegistryEvent(makeEvent([symbolScVal('approved'), addressScVal(owner)], stringScVal(''))),
    ).resolves.not.toThrow();

    const ngo = await prisma.ngo.findUnique({ where: { ownerAddress: owner } });
    expect(ngo).toBeNull();

    // A StreamEvent is still written even when no NGO row was found —
    // the event happened on-chain regardless.
    const streamEvent = await prisma.streamEvent.findFirst({ where: { type: 'approved' } });
    expect(streamEvent).not.toBeNull();
    expect(streamEvent?.payload).toMatchObject({ ownerAddress: owner });
  });

  it('marks a verified NGO unverified on a revoked event following approval', async () => {
    const owner = fakeAddress('D');
    await prisma.ngo.create({ data: { ownerAddress: owner, name: 'UNICEF' } });

    await handleNgoRegistryEvent(makeEvent([symbolScVal('approved'), addressScVal(owner)], stringScVal('')));
    let ngo = await prisma.ngo.findUnique({ where: { ownerAddress: owner } });
    expect(ngo?.verified).toBe(true);

    await handleNgoRegistryEvent(makeEvent([symbolScVal('revoked'), addressScVal(owner)], stringScVal('')));
    ngo = await prisma.ngo.findUnique({ where: { ownerAddress: owner } });
    expect(ngo?.verified).toBe(false);
  });

  it('dispatches ngo_approved notification for approved event', async () => {
    const owner = fakeAddress('E');
    await prisma.ngo.create({ data: { ownerAddress: owner, name: 'Save the Whales' } });

    const event = makeEvent([symbolScVal('approved'), addressScVal(owner)], stringScVal(''));
    await handleNgoRegistryEvent(event);

    const ngo = await prisma.ngo.findUnique({ where: { ownerAddress: owner } });
    expect(ngo?.verified).toBe(true);

    expect(dispatchNotification).toHaveBeenCalledWith({
      type: 'ngo_approved',
      ownerAddress: owner,
      ngoId: ngo!.id,
      eventId: event.id,
    });
  });

  it('dispatches ngo_revoked notification for revoked event', async () => {
    const owner = fakeAddress('F');
    await prisma.ngo.create({ data: { ownerAddress: owner, name: 'Green Earth', verified: true } });

    const event = makeEvent([symbolScVal('revoked'), addressScVal(owner)], stringScVal(''));
    await handleNgoRegistryEvent(event);

    const ngo = await prisma.ngo.findUnique({ where: { ownerAddress: owner } });
    expect(ngo?.verified).toBe(false);

    expect(dispatchNotification).toHaveBeenCalledWith({
      type: 'ngo_revoked',
      ownerAddress: owner,
      ngoId: ngo!.id,
      eventId: event.id,
    });
  });

  it('does not dispatch notification for register event', async () => {
    const owner = fakeAddress('G');

    await handleNgoRegistryEvent(
      makeEvent([symbolScVal('register'), addressScVal(owner)], stringScVal('Ocean Cleanup')),
    );

    const ngo = await prisma.ngo.findUnique({ where: { ownerAddress: owner } });
    expect(ngo?.name).toBe('Ocean Cleanup');
    expect(ngo?.verified).toBe(false);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });

  it('writes a StreamEvent row for register with correct type, payload, ledger, and txHash', async () => {
    const owner = fakeAddress('H');
    const txHash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

    const event = makeEvent(
      [symbolScVal('register'), addressScVal(owner)],
      stringScVal('Wildlife Fund'),
      { ledger: 12345, txHash },
    );
    await handleNgoRegistryEvent(event);

    const streamEvent = await prisma.streamEvent.findFirst({ where: { type: 'register' } });
    expect(streamEvent).not.toBeNull();
    expect(streamEvent?.type).toBe('register');
    expect(streamEvent?.streamId).toBeNull();
    expect(streamEvent?.ledger).toBe(12345);
    expect(streamEvent?.txHash).toBe(txHash);
    expect(streamEvent?.payload).toMatchObject({
      ownerAddress: owner,
      name: 'Wildlife Fund',
    });
  });

  it('writes a StreamEvent row for approved with correct type, payload, ledger, and txHash', async () => {
    const owner = fakeAddress('I');
    const txHash = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3';

    await prisma.ngo.create({ data: { ownerAddress: owner, name: 'Health Initiative' } });

    const event = makeEvent([symbolScVal('approved'), addressScVal(owner)], stringScVal(''), {
      ledger: 23456,
      txHash,
    });
    await handleNgoRegistryEvent(event);

    const streamEvent = await prisma.streamEvent.findFirst({ where: { type: 'approved' } });
    expect(streamEvent).not.toBeNull();
    expect(streamEvent?.type).toBe('approved');
    expect(streamEvent?.streamId).toBeNull();
    expect(streamEvent?.ledger).toBe(23456);
    expect(streamEvent?.txHash).toBe(txHash);
    expect(streamEvent?.payload).toMatchObject({
      ownerAddress: owner,
    });
  });

  it('writes a StreamEvent row for revoked with correct type, payload, ledger, and txHash', async () => {
    const owner = fakeAddress('J');
    const txHash = 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4';

    await prisma.ngo.create({ data: { ownerAddress: owner, name: 'Education Fund', verified: true } });

    const event = makeEvent([symbolScVal('revoked'), addressScVal(owner)], stringScVal(''), {
      ledger: 34567,
      txHash,
    });
    await handleNgoRegistryEvent(event);

    const streamEvent = await prisma.streamEvent.findFirst({ where: { type: 'revoked' } });
    expect(streamEvent).not.toBeNull();
    expect(streamEvent?.type).toBe('revoked');
    expect(streamEvent?.streamId).toBeNull();
    expect(streamEvent?.ledger).toBe(34567);
    expect(streamEvent?.txHash).toBe(txHash);
    expect(streamEvent?.payload).toMatchObject({
      ownerAddress: owner,
    });
  });
});
