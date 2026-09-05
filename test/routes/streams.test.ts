import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { fakeAddress, resetDb } from '../helpers/db.js';

describe('GET /streams', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('filters by donor address', async () => {
    const app = buildServer();

    const donorA = await prisma.donor.create({ data: { address: fakeAddress('A') } });
    const donorB = await prisma.donor.create({ data: { address: fakeAddress('B') } });
    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('C'), name: 'NGO', verified: true },
    });

    await prisma.stream.create({
      data: {
        onChainId: 1n,
        donorId: donorA.id,
        ngoId: ngo.id,
        tokenAddress: fakeAddress('D'),
        rate: '1',
        balance: '100',
        withdrawn: '0',
      },
    });
    await prisma.stream.create({
      data: {
        onChainId: 2n,
        donorId: donorB.id,
        ngoId: ngo.id,
        tokenAddress: fakeAddress('D'),
        rate: '1',
        balance: '200',
        withdrawn: '0',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/streams?donor=${donorA.address}`,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].onChainId).toBe('1');
    // Serialized as a string — the route must never hand back a raw BigInt.
    expect(typeof body[0].onChainId).toBe('string');

    await app.close();
  });

  it('400s on a malformed donor address instead of matching nothing silently', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/streams?donor=not-an-address' });
    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
