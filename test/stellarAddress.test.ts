import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../src/server.js';
import { stellarPublicKeySchema } from '../src/stellar/validation.js';
import { fakeAddressWithBadChecksum } from './helpers/db.js';

describe('stellarPublicKeySchema', () => {
  it('rejects a correctly shaped address with an invalid checksum', () => {
    const validAddress = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
    const finalCharacter = validAddress.at(-1) === 'A' ? 'B' : 'A';
    const invalidAddress = `${validAddress.slice(0, -1)}${finalCharacter}`;

    expect(invalidAddress).toMatch(/^G[A-Z2-7]{55}$/);
    expect(StrKey.isValidEd25519PublicKey(invalidAddress)).toBe(false);
    expect(stellarPublicKeySchema.safeParse(invalidAddress).success).toBe(false);
    expect(stellarPublicKeySchema.safeParse(validAddress).success).toBe(true);
  });
});

describe('Stellar address route validation', () => {
  it('rejects a checksum-invalid address on NGO lookup', async () => {
    const app = buildServer();
    const address = fakeAddressWithBadChecksum('Z');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/ngos/lookup?address=${address}`,
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
