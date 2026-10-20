import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DONATION_VAULT_CONTRACT_ID, NGO_REGISTRY_CONTRACT_ID } from '../../src/indexer/contracts.js';
const { dispatchEvent } = await vi.importActual('../../src/indexer/dispatch.js');
import type { ContractEvent } from '../../src/indexer/worker.js';
import { makeEvent, symbolScVal } from '../helpers/events.js';

vi.mock('../../src/indexer/contracts.js', () => ({
  NGO_REGISTRY_CONTRACT_ID: 'C_NGO_REGISTRY',
  DONATION_VAULT_CONTRACT_ID: 'C_DONATION_VAULT',
}));

const handleDonationVaultEvent = vi.fn();
const handleNgoRegistryEvent = vi.fn();
const recordUnknownContractEvent = vi.fn();

vi.mock('../../src/indexer/handlers/donationVault.js', () => ({
  handleDonationVaultEvent,
}));

vi.mock('../../src/indexer/handlers/ngoRegistry.js', () => ({
  handleNgoRegistryEvent,
}));

vi.mock('../../src/metrics.js', () => ({
  recordUnknownContractEvent,
}));

describe('dispatchEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes event from NGO_REGISTRY_CONTRACT_ID to handleNgoRegistryEvent', async () => {
    const event = {
      ...makeEvent([symbolScVal('test')], symbolScVal('test')),
      contractId: NGO_REGISTRY_CONTRACT_ID,
    } as ContractEvent;

    await dispatchEvent(event);

    expect(handleNgoRegistryEvent).toHaveBeenCalledWith(event);
    expect(handleDonationVaultEvent).not.toHaveBeenCalled();
    expect(recordUnknownContractEvent).not.toHaveBeenCalled();
  });

  it('routes event from DONATION_VAULT_CONTRACT_ID to handleDonationVaultEvent', async () => {
    const event = {
      ...makeEvent([symbolScVal('test')], symbolScVal('test')),
      contractId: DONATION_VAULT_CONTRACT_ID,
    } as ContractEvent;

    await dispatchEvent(event);

    expect(handleDonationVaultEvent).toHaveBeenCalledWith(event);
    expect(handleNgoRegistryEvent).not.toHaveBeenCalled();
    expect(recordUnknownContractEvent).not.toHaveBeenCalled();
  });

  it('calls neither handler for an unknown contract id', async () => {
    const event = {
      ...makeEvent([symbolScVal('test')], symbolScVal('test')),
      contractId: 'C_UNKNOWN_CONTRACT_ID',
    } as ContractEvent;

    await dispatchEvent(event);

    expect(handleNgoRegistryEvent).not.toHaveBeenCalled();
    expect(handleDonationVaultEvent).not.toHaveBeenCalled();
  });

  it('logs and counts an event from an unknown contract once per contract id', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const contractId = 'C_UNKNOWN_LOG_TEST_1';
    const event = {
      ...makeEvent([symbolScVal('test')], symbolScVal('test')),
      contractId: contractId,
    } as ContractEvent;

    await dispatchEvent(event);
    await dispatchEvent(event);

    expect(handleNgoRegistryEvent).not.toHaveBeenCalled();
    expect(handleDonationVaultEvent).not.toHaveBeenCalled();
    expect(recordUnknownContractEvent).toHaveBeenCalledWith(contractId);
    expect(recordUnknownContractEvent).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mockCalls[0][0]).toContain(contractId);

    warnSpy.mockRestore();
  });
});
