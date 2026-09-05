import { scValToNative } from '@stellar/stellar-sdk';

import { prisma } from '../../db.js';
import type { ContractEvent } from '../worker.js';

async function ensureDonor(address: string) {
  return prisma.donor.upsert({
    where: { address },
    create: { address },
    update: {},
  });
}

async function ensureNgo(ownerAddress: string) {
  return prisma.ngo.upsert({
    where: { ownerAddress },
    // A stream can reference an NGO address that hasn't gone through
    // ngo-registry — donation-vault doesn't check registry membership
    // on-chain. Placeholder name until (if) a "register" event arrives;
    // `update: {}` below makes sure we never clobber a real name/verified
    // status that's already on file.
    create: { ownerAddress, name: ownerAddress, verified: false },
    update: {},
  });
}

async function handleStreamCreated(event: ContractEvent): Promise<void> {
  const [, streamIdVal] = event.topic;
  const onChainId = scValToNative(streamIdVal) as bigint;

  const [donorVal, ngoVal, tokenVal, depositVal, rateVal] = scValToNative(event.value) as [
    { toString(): string },
    { toString(): string },
    { toString(): string },
    bigint,
    bigint,
  ];

  const [donor, ngo] = await Promise.all([
    ensureDonor(donorVal.toString()),
    ensureNgo(ngoVal.toString()),
  ]);

  await prisma.stream.upsert({
    where: { onChainId },
    create: {
      onChainId,
      donorId: donor.id,
      ngoId: ngo.id,
      tokenAddress: tokenVal.toString(),
      rate: rateVal.toString(),
      balance: depositVal.toString(),
      withdrawn: '0',
      status: 'ACTIVE',
    },
    update: {},
  });
}

export async function handleDonationVaultEvent(event: ContractEvent): Promise<void> {
  const [topicSymbol] = event.topic;
  const topic = scValToNative(topicSymbol) as string;

  if (topic === 'created') {
    await handleStreamCreated(event);
  }
}
