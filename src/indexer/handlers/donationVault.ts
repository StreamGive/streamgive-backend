import { scValToNative } from '@stellar/stellar-sdk';

import { prisma } from '../../db.js';
import { notify } from '../../notifications/service.js';
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

  await notify({
    type: 'stream_created',
    streamId: onChainId.toString(),
    donorAddress: donorVal.toString(),
    ngoId: ngo.id,
  });
}

/** Withdraw's event payload is just the accrued amount, so the new balance
 * and withdrawn total are fully determined by it — no ambiguity. */
async function handleWithdraw(event: ContractEvent): Promise<void> {
  const [, streamIdVal] = event.topic;
  const onChainId = scValToNative(streamIdVal) as bigint;
  const accrued = scValToNative(event.value) as bigint;

  const stream = await prisma.stream.findUnique({ where: { onChainId } });
  if (!stream) return;

  await prisma.stream.update({
    where: { onChainId },
    data: {
      balance: (BigInt(stream.balance) - accrued).toString(),
      withdrawn: (BigInt(stream.withdrawn) + accrued).toString(),
    },
  });

  await notify({
    type: 'stream_withdrawn',
    streamId: onChainId.toString(),
    amount: accrued.toString(),
  });
}

/** Cancel's payload carries both the settled amount and the refund, so —
 * like withdraw — the resulting state is fully determined by the event. */
async function handleCancel(event: ContractEvent): Promise<void> {
  const [, streamIdVal] = event.topic;
  const onChainId = scValToNative(streamIdVal) as bigint;
  const [accrued, refund] = scValToNative(event.value) as [bigint, bigint];

  const stream = await prisma.stream.findUnique({ where: { onChainId } });
  if (!stream) return;

  await prisma.stream.update({
    where: { onChainId },
    data: {
      withdrawn: (BigInt(stream.withdrawn) + accrued).toString(),
      balance: '0',
      rate: '0',
      status: 'CANCELLED',
    },
  });

  await notify({
    type: 'stream_cancelled',
    streamId: onChainId.toString(),
    settledToNgo: accrued.toString(),
    refundToDonor: refund.toString(),
  });
}

export async function handleDonationVaultEvent(event: ContractEvent): Promise<void> {
  const [topicSymbol] = event.topic;
  const topic = scValToNative(topicSymbol) as string;

  switch (topic) {
    case 'created':
      await handleStreamCreated(event);
      break;
    case 'withdraw':
      await handleWithdraw(event);
      break;
    case 'cancel':
      await handleCancel(event);
      break;
    case 'topup':
    case 'ratemod':
      // Deliberately unhandled for now: both events only publish the new
      // amount/rate, not how much accrued and settled to the NGO during
      // the same call, so the new balance can't be reconstructed from the
      // event payload alone without either a verified read-only contract
      // call (get_stream) or duplicating the contract's accrual math here
      // — both real work, tracked as follow-up rather than guessed at.
      break;
    default:
      break;
  }
}
