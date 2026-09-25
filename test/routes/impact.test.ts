import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { fakeAddress, resetDb } from '../helpers/db.js';

describe('GET /impact/:ngoId', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('400s for a non-UUID id', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/impact/not-a-uuid' });
    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('404s for an unknown NGO id', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/impact/00000000-0000-0000-0000-000000000000',
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('returns zero platformSharePercent when the platform has no streams', async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('A'), name: 'Empty NGO', verified: true },
    });

    const response = await app.inject({ method: 'GET', url: `/impact/${ngo.id}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.platformSharePercent).toBe(0);
    expect(body.totalCommitted).toBe('0');
    expect(body.activeStreams).toBe(0);
    expect(body.cancelledStreams).toBe(0);
    expect(body.uniqueDonors).toBe(0);

    await app.close();
  });

  it('computes stats correctly across two NGOs', async () => {
    const app = buildServer();

    const ngo1 = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('B'), name: 'NGO One', verified: true },
    });
    const ngo2 = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('C'), name: 'NGO Two', verified: true },
    });
    const donor1 = await prisma.donor.create({ data: { address: fakeAddress('D') } });
    const donor2 = await prisma.donor.create({ data: { address: fakeAddress('E') } });

    // ngo1: one active stream (balance=600, withdrawn=400) + one cancelled (balance=0, withdrawn=200)
    // committed = (600+400) + (0+200) = 1200
    await prisma.stream.create({
      data: {
        onChainId: 1n,
        donorId: donor1.id,
        ngoId: ngo1.id,
        tokenAddress: fakeAddress('T'),
        rate: '10',
        balance: '600',
        withdrawn: '400',
        status: 'ACTIVE',
      },
    });
    await prisma.stream.create({
      data: {
        onChainId: 2n,
        donorId: donor2.id,
        ngoId: ngo1.id,
        tokenAddress: fakeAddress('T'),
        rate: '0',
        balance: '0',
        withdrawn: '200',
        status: 'CANCELLED',
      },
    });

    // ngo2: one active stream (balance=600, withdrawn=200)
    // committed = 800
    await prisma.stream.create({
      data: {
        onChainId: 3n,
        donorId: donor1.id,
        ngoId: ngo2.id,
        tokenAddress: fakeAddress('T'),
        rate: '5',
        balance: '600',
        withdrawn: '200',
        status: 'ACTIVE',
      },
    });

    // platform total committed = 1200 + 800 = 2000
    // ngo1 share = 1200 / 2000 = 60%

    const response = await app.inject({ method: 'GET', url: `/impact/${ngo1.id}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.ngoId).toBe(ngo1.id);
    expect(body.totalCommitted).toBe('1200');
    expect(body.totalWithdrawn).toBe('600');
    expect(body.activeStreams).toBe(1);
    expect(body.cancelledStreams).toBe(1);
    expect(body.uniqueDonors).toBe(2);
    expect(body.platformSharePercent).toBe(60);

    await app.close();
  });

  it('counts unique donors correctly when the same donor has multiple streams', async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('F'), name: 'Loyal NGO', verified: true },
    });
    const donor = await prisma.donor.create({ data: { address: fakeAddress('G') } });

    await prisma.stream.create({
      data: {
        onChainId: 4n,
        donorId: donor.id,
        ngoId: ngo.id,
        tokenAddress: fakeAddress('T'),
        rate: '10',
        balance: '100',
        withdrawn: '0',
        status: 'ACTIVE',
      },
    });
    await prisma.stream.create({
      data: {
        onChainId: 5n,
        donorId: donor.id,
        ngoId: ngo.id,
        tokenAddress: fakeAddress('T'),
        rate: '0',
        balance: '0',
        withdrawn: '50',
        status: 'CANCELLED',
      },
    });

    const response = await app.inject({ method: 'GET', url: `/impact/${ngo.id}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.uniqueDonors).toBe(1);

    await app.close();
  });
});
