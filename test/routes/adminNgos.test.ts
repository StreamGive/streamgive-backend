import { Keypair } from '@stellar/stellar-sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { signAdminRequest } from '../helpers/adminAuth.js';
import { fakeAddress, resetDb } from '../helpers/db.js';

const adminKeypair = Keypair.random();

describe('PATCH /admin/ngos/:id', () => {
  beforeAll(() => {
    process.env.ADMIN_ADDRESS = adminKeypair.publicKey();
  });

  afterEach(async () => {
    await resetDb();
  });

  it('requires admin auth and rejects an unsigned request with 401', async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('A'), name: 'Green Earth', verified: true },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/admin/ngos/${ngo.id}`,
      payload: { displayName: 'Updated Name' },
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('returns 404 for an unknown NGO id', async () => {
    const app = buildServer();

    const unknownId = '00000000-0000-0000-0000-000000000000';
    const url = `/admin/ngos/${unknownId}`;
    const headers = signAdminRequest(adminKeypair, 'PATCH', url);

    const response = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { displayName: 'Updated Name' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });

    await app.close();
  });

  it('returns 400 for a malformed (non-UUID) id', async () => {
    const app = buildServer();

    const url = '/admin/ngos/not-a-valid-uuid';
    const headers = signAdminRequest(adminKeypair, 'PATCH', url);

    const response = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { displayName: 'Updated Name' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });

    await app.close();
  });

  it('applies a displayName override to an NGO', async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('B'), name: 'Original Name', verified: true },
    });

    const url = `/admin/ngos/${ngo.id}`;
    const headers = signAdminRequest(adminKeypair, 'PATCH', url);

    const response = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { displayName: 'Curated Public Name' },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.id).toBe(ngo.id);
    expect(body.name).toBe('Curated Public Name');
    expect(body.displayName).toBe('Curated Public Name');

    // Verify it was persisted
    const updated = await prisma.ngo.findUnique({ where: { id: ngo.id } });
    expect(updated?.displayName).toBe('Curated Public Name');
    expect(updated?.name).toBe('Original Name'); // Original name unchanged

    await app.close();
  });

  it('clears a displayName override when set to null', async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: {
        ownerAddress: fakeAddress('C'),
        name: 'Original Name',
        displayName: 'Previous Override',
        verified: true,
      },
    });

    const url = `/admin/ngos/${ngo.id}`;
    const headers = signAdminRequest(adminKeypair, 'PATCH', url);

    const response = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { displayName: null },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.id).toBe(ngo.id);
    expect(body.name).toBe('Original Name'); // Falls back to original name
    expect(body.displayName).toBeNull();

    // Verify it was persisted
    const updated = await prisma.ngo.findUnique({ where: { id: ngo.id } });
    expect(updated?.displayName).toBeNull();
    expect(updated?.name).toBe('Original Name');

    await app.close();
  });

  it('returns 400 for an invalid request body', async () => {
    const app = buildServer();

    const ngo = await prisma.ngo.create({
      data: { ownerAddress: fakeAddress('D'), name: 'Test NGO', verified: true },
    });

    const url = `/admin/ngos/${ngo.id}`;
    const headers = signAdminRequest(adminKeypair, 'PATCH', url);

    const response = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { displayName: 123 }, // Invalid: should be string or null
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');

    await app.close();
  });
});
