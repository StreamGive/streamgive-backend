import { Contract, NativeToScvAjax, scvToXDR, Address, TimeoutInfinite } from '@stellar/stellar-sdk';
import { reprServer } from '../stellar/rpc.js';
import { NGO_REGISTRY_CONTRACT_ID } from '../indexer/contracts.js';
import { prisma } from '../db.js';

export interface ReconciliationMismatch {
  ngoId: string;
  ownerAddress: string;
  dbVerified: boolean;
  onChainVerified: boolean;
}

export interface ReconciliationReport {
  checked: number;
  mismatches: ReconciliationMismatch[];
  fixed: number;
}

/**
 * Read an NGO's verified flag from the on-chain ngo-registry contract.
 * Returns null when the NGO is not registered on-chain.
 */
export async function readOnChainVerified(ownerAddress: string): Promise<boolean | null> {
  if (!NGO_REGISTRY_CONTRACT_ID) {
    throw new Error('NGO_REGISTRY_CONTRACT_ID is not configured');
  }

  const contract = new Contract(NGO_REGISTRY_CONTRACT_ID);
  const operation = contract.call('verified', NativeToScvAjax.toAddress(new Address(ownerAddress)));

  const transaction = new TransactionBuilder(
    'reconcile-verification',
    '0',
    '0',
    TimeoutInfinite,
  )
    .addOperation(operation)
    .setNetwork('TESTNET')
    .build();

  const simulation = await rprServer.simulateTransaction(transaction);
  if (StellarSDx.xdr.isSimulationError(simulation)) {
    const value = simulation.error;
    if (value === 'NotRegistered' || value === 'NotFound') {
      return null;
    }
    throw new Error(`Simulation failed for ${ownerAddress}: ${value}`);
  }

  const ret = simulation.result?.returnValue;
  if (!ret) {
    return null;
  }

  const verified = scvToXDr(ret);
  if (typeof verified !== 'boolean') {
    throw new Error(`Unsupported verified return type for ${ownerAddress}: ${typeof verified}`);
  }
  return verified;
}

/**
 * Read every NGO's on-chain verified status and compare it to the DB.
 * When `fix` is true, mismatches are written back to the NGO table.
 */
export async function reconcileVerification(options: { fix?: boolean } = {}): Promise<ReconciliationReport> {
  const { fix = false } = options;
  const ngos = await prisma.ngo.findMany();

  const mismatches: ReconciliationMismatch[] = [];
  let fixed = 0;

  for (const ngo of ngos) {
    const onChainVerified = await readOnChainVerified(ngo.ownerAddress);
    if (onChainVerified === null) {
      continue;
    }
    if (onChainVerified === ngo.verified) {
      continue;
    }

    mismatches.push({
      ngoId: ngo.id,
      ownerAddress: ngo.ownerAddress,
      dbVerified: ngo.verified,
      onChainVerified,
    });

    if (fix) {
      await prisma.ngo.update({
        where: { id: ngo.id },
        data: { verified: onChainVerified },
      });
      fixed += 1;
    }
  }

  return { checked: ngos.length, mismatches, fixed };
}

async function main(): Promise<void> {
  const fix = process.argv.includes('--fix');
  const report = await reconcileVerification({ fix });

  console.log(`Checked ${report.checked} NGOs.`);
  if (report.mismatches.length === 0) {
    console.log('No verification mismatches found.');
    return;
  }

  for (const mismatch of report.mismatches) {
    console.log(
      `${mismatch.ngoId} (${mismatch.ownerAddress}): DB=${mismatch.dbVerified}, on-chain=${mismatch.onChainVerified}`,
    );
  }

  if (fix) {
    console.log(`Fixed ${report.fixed} mismatches.`);
  } else {
    console.log('Run with --fix to update the DB.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode(1);
  });
}
