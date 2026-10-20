import { DONATION_VAULT_CONTRACT_ID, NGO_REGISTRY_CONTRACT_ID } from './contracts.js';
import { handleDonationVaultEvent } from './handlers/donationVault.js';
import { handleNgoRegistryEvent } from './handlers/ngoRegistry.js';
import { logger } from '../logger.js';
import type { ContractEvent, EventHandler } from './worker.js';

// Track which unknown contract ids have already been warned about so we
// log once per id, not once per event (which would flood the logs).
const warnedContractIds = new Set<string>();

export const dispatchEvent: EventHandler = async (event: ContractEvent) => {
  switch (event.contractId?.toString()) {
    case NGO_REGISTRY_CONTRACT_ID:
      await handleNgoRegistryEvent(event);
      break;
    case DONATION_VAULT_CONTRACT_ID:
      await handleDonationVaultEvent(event);
      break;
    default: {
      const contractId = event.contractId?.toString() ?? 'unknown';
      if (!warnedContractIds.has(contractId)) {
        warnedContractIds.add(contractId);
        logger.warn(
          { contractId, eventId: event.id },
          'event from unknown contract id — check NGO_REGISTRY_CONTRACT_ID and DONATION_VAULT_CONTRACT_ID',
        );
      }
      break;
    }
  }
};
