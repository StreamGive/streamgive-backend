import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';

export const stellarPublicKeySchema = z
  .string()
  .refine((address) => StrKey.isValidEd25519PublicKey(address), {
    message: 'Invalid Stellar ed25519 public key',
  });
