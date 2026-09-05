import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { fakeAddress, resetDb } from '../helpers/db.js';

describe('GET /ngos', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('returns only verified NGOs, newest first', async () => {
    const app = buildServer();

    await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('A'), name: 'Unverified NGO', verified: false },
    });
    await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('B'), name: 'Verified NGO', verified: true },
    });

    const response = await app.inject({ method: 'GET', url: '/ngos' });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Verified NGO');

    await app.close();
  });
});

describe('GET /ngos/:id', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('404s for an id that does not exist', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/ngos/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('400s for a non-uuid id instead of leaking a Prisma error', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/ngos/not-a-uuid' });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('computes stats from the NGO’s streams', async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('C'), name: 'Impact NGO', verified: true },
    });
    const donor = await prisma.donor.create({ data: { address: fakeAddress('D') } });

    await prisma.stream.create({
      data: {
        onChainId: 1n,
        donorId: donor.id,
        ngoId: ngo.id,
        tokenAddress: fakeAddress('E'),
        rate: '10',
        balance: '400',
        withdrawn: '600',
        status: 'ACTIVE',
      },
    });

    const response = await app.inject({ method: 'GET', url: `/ngos/${ngo.id}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.stats.totalCommitted).toBe('1000');
    expect(body.stats.totalWithdrawn).toBe('600');
    expect(body.stats.activeStreamCount).toBe(1);
    expect(body.stats.donorCount).toBe(1);

    await app.close();
  });
});
