import { DONATION_VAULT_CONTRACT_ID, NGO_REGISTRY_CONTRACT_ID } from './contracts.js';
import { handleDonationVaultEvent } from './handlers/donationVault.js';
import { handleNgoRegistryEvent } from './handlers/ngoRegistry.js';
import type { ContractEvent, EventHandler } from './worker.js';

export const dispatchEvent: EventHandler = async (event: ContractEvent) => {
  switch (event.contractId?.toString()) {
    case NGO_REGISTRY_CONTRACT_ID:
      await handleNgoRegistryEvent(event);
      break;
    case DONATION_VAULT_CONTRACT_ID:
      await handleDonationVaultEvent(event);
      break;
    default:
      break;
  }
};
