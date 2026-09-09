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

  it('pages through results with a filter applied', async () => {
    const app = buildServer();

    const donor = await prisma.donor.create({ data: { address: fakeAddress('A') } });
    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('B'), name: 'NGO', verified: true },
    });
    const otherNgo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('C'), name: 'Other NGO', verified: true },
    });

    // Created oldest first so `createdAt desc` returns onChainId 3, 2, 1.
    for (const onChainId of [1n, 2n, 3n]) {
      await prisma.stream.create({
        data: {
          onChainId,
          donorId: donor.id,
          ngoId: ngo.id,
          tokenAddress: fakeAddress('D'),
          rate: '1',
          balance: '100',
          withdrawn: '0',
        },
      });
    }
    // Belongs to a different NGO — must never show up in either page below.
    await prisma.stream.create({
      data: {
        onChainId: 4n,
        donorId: donor.id,
        ngoId: otherNgo.id,
        tokenAddress: fakeAddress('D'),
        rate: '1',
        balance: '100',
        withdrawn: '0',
      },
    });

    const firstPage = await app.inject({
      method: 'GET',
      url: `/streams?ngo=${ngo.id}&limit=2`,
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json();
    expect(firstBody).toHaveLength(2);
    expect(firstBody.map((s: { onChainId: string }) => s.onChainId)).toEqual(['3', '2']);

    const secondPage = await app.inject({
      method: 'GET',
      url: `/streams?ngo=${ngo.id}&limit=2&cursor=${firstBody[1].id}`,
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json();
    expect(secondBody).toHaveLength(1);
    expect(secondBody[0].onChainId).toBe('1');

    await app.close();
  });
});
