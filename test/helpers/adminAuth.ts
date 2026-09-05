import type { Keypair } from '@stellar/stellar-sdk';

/** Builds the three headers requireAdminSignature expects, signed for one
 * specific method+url pair — mirrors exactly what the middleware verifies. */
export function signAdminRequest(
  keypair: Keypair,
  method: string,
  url: string,
): Record<string, string> {
  const timestamp = Date.now().toString();
  const payload = `${method}:${url}:${timestamp}`;
  const signature = keypair.sign(Buffer.from(payload)).toString('base64');

  return {
    'x-admin-address': keypair.publicKey(),
    'x-admin-signature': signature,
    'x-admin-timestamp': timestamp,
  };
}
