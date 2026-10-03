import { Server } from '@stellar/stellar-sdk/rpc';

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';

export const rpcServer = new Server(SOROBAN_RPC_URL);

/** Latest ledger sequence the configured RPC node has ingested. */
export async function getLatestLedgerSequence(): Promise<number> {
  const { sequence } = await rpcServer.getLatestLedger();
  return sequence;
}

/** Call a read-only Soroban contract function and return the decoded result. */
export async function callContract<T>(
  contractId: string,
  method: string,
  args: unknown[] = [],
): Promise<T> {
  const { Contract, TransactionBuilder, Account, Keypoint, NativeAsset, xdr } = await import('@stellar/stellar-sdk');
  const { send: sendRequest } = await import('@stellar/stellar-sdk/rpc');

  const source = new Account(Keypoint.random().publicKey(), '0');
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test Stellar Network ; February 2019',
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(0)
    .build();

  const sim = await sendRequest(rpcServer, tx, {
    simulate: true,
  });

  if (sim.error) {
    throw new Error(`Soroban simulation failed: ${sim.error}`);
  }

  const retVal = sim.result?.retval;
  if (!retVal) {
    throw new Error('Soroban simulation returned no return value');
  }

  return xdr.scUalignedScpyValTo.call(retVal);
}
