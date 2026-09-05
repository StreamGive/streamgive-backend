import { scValToNative } from '@stellar/stellar-sdk';

import { prisma } from '../../db.js';
import type { ContractEvent } from '../worker.js';

/**
 * Handles both `register` and `approved` events from the ngo-registry
 * contract. Both ultimately upsert the same `ngos` row — `register` creates
 * it unverified, `approved` flips it to verified — so they're handled
 * together rather than split across two commits that would each leave the
 * table in an inconsistent shape on their own.
 */
export async function handleNgoRegistryEvent(event: ContractEvent): Promise<void> {
  const [topicSymbol, ownerVal] = event.topic;
  const topic = scValToNative(topicSymbol) as string;
  const ownerAddress = scValToNative(ownerVal).toString();

  if (topic === 'register') {
    const name = scValToNative(event.value) as string;
    await prisma.ngo.upsert({
      where: { ownerAddress },
      create: { ownerAddress, name, verified: false },
      update: { name },
    });
    return;
  }

  if (topic === 'approved') {
    // updateMany (not update) so a stray "approved" seen without a prior
    // "register" — e.g. the indexer started mid-history — doesn't throw.
    await prisma.ngo.updateMany({
      where: { ownerAddress },
      data: { verified: true },
    });
  }
}
