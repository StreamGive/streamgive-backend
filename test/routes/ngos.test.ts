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
    expect(body.ngos).toHaveLength(1);
    expect(body.ngos[0].name).toBe('Verified NGO');
    expect(body.nextCursor).toBeNull();

    await app.close();
  });

  it('paginates with cursor and returns no overlap between pages', async () => {
    const app = buildServer();

    // Create 3 verified NGOs — oldest first so createdAt desc gives C, B, A.
    for (const char of ['A', 'B', 'C']) {
      await prisma.ngo.create({
        data: { ownerAddress: fakeAddress(char), name: `NGO ${char}`, verified: true },
      });
    }

    const firstPage = await app.inject({ method: 'GET', url: '/ngos?limit=2' });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json();
    expect(firstBody.ngos).toHaveLength(2);
    expect(firstBody.nextCursor).not.toBeNull();
    const firstIds = firstBody.ngos.map((n: { id: string }) => n.id);

    const secondPage = await app.inject({
      method: 'GET',
      url: `/ngos?limit=2&cursor=${firstBody.nextCursor}`,
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json();
    expect(secondBody.ngos).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();

    // No overlap between pages.
    const secondIds = secondBody.ngos.map((n: { id: string }) => n.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);

    await app.close();
  });
});

describe('GET /ngos/lookup', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('finds the NGO matching the given address', async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('A'), name: 'Impact NGO', verified: true },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/ngos/lookup?address=${ngo.ownerAddress}`,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.id).toBe(ngo.id);
    expect(body.name).toBe('Impact NGO');

    await app.close();
  });

  it('404s when no NGO matches the address', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: `/ngos/lookup?address=${fakeAddress('Z')}`,
    });
    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('400s on a malformed address instead of matching nothing silently', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/ngos/lookup?address=not-an-address' });
    expect(response.statusCode).toBe(400);

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

  it(‘computes stats from the NGO’s streams’, async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress(‘C’), name: ‘Impact NGO’, verified: true },
    });
    const donor = await prisma.donor.create({ data: { address: fakeAddress(‘D’) } });

    await prisma.stream.create({
      data: {
        onChainId: 1n,
        donorId: donor.id,
        ngoId: ngo.id,
        tokenAddress: fakeAddress(‘E’),
        rate: ‘10’,
        balance: ‘400’,
        withdrawn: ‘600’,
        status: ‘ACTIVE’,
      },
    });

    const response = await app.inject({ method: ‘GET’, url: `/ngos/${ngo.id}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.stats.totalCommitted).toBe(‘1000’);
    expect(body.stats.totalWithdrawn).toBe(‘600’);
    expect(body.stats.activeStreamCount).toBe(1);
    expect(body.stats.donorCount).toBe(1);

    await app.close();
  });

  it(‘includes description, website and country from the approved application’, async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress(‘F’), name: ‘Green NGO’, verified: true },
    });
    await prisma.ngoApplication.create({
      data: {
        ownerAddress: ngo.ownerAddress,
        name: ngo.name,
        description: ‘Saving trees everywhere.’,
        website: ‘https://green.example’,
        contactEmail: ‘secret@green.example’,
        country: ‘Brazil’,
        status: ‘APPROVED’,
      },
    });

    const response = await app.inject({ method: ‘GET’, url: `/ngos/${ngo.id}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.description).toBe(‘Saving trees everywhere.’);
    expect(body.website).toBe(‘https://green.example’);
    expect(body.country).toBe(‘Brazil’);
    expect(body.contactEmail).toBeUndefined();
    expect(body.reviewNote).toBeUndefined();

    await app.close();
  });

  it(‘returns null description/website/country when there is no approved application’, async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress(‘G’), name: ‘Pending NGO’, verified: false },
    });
    await prisma.ngoApplication.create({
      data: {
        ownerAddress: ngo.ownerAddress,
        name: ngo.name,
        description: ‘Still under review.’,
        contactEmail: ‘hi@pending.example’,
        status: ‘PENDING’,
      },
    });

    const response = await app.inject({ method: ‘GET’, url: `/ngos/${ngo.id}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.description).toBeNull();
    expect(body.website).toBeNull();
    expect(body.country).toBeNull();

    await app.close();
  });
});
