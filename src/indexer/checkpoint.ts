import { prisma } from '../db.js';

const CHECKPOINT_ID = 'singleton';

export async function getCheckpoint(): Promise<bigint | undefined> {
  const row = await prisma.indexerCheckpoint.findUnique({ where: { id: CHECKPOINT_ID } });
  return row?.lastLedger;
}

export async function saveCheckpoint(ledger: bigint, eventId?: string): Promise<void> {
  await prisma.indexerCheckpoint.upsert({
    where: { id: CHECKPOINT_ID },
    create: { id: CHECKPOINT_ID, lastLedger: ledger, lastEventId: eventId },
    update: { lastLedger: ledger, lastEventId: eventId },
  });
}
