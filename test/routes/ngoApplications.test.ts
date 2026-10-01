import { Keypair } from '@stellar/stellar-sdk';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/db.js';
import { buildServer } from '../../src/server.js';
import { fakeAddress, resetDb } from '../helpers/db.js';
import { signAdminRequest } from '../helpers/adminAuth.js';

const adminKeypair = Keypair.random();

function validApplicationPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ownerAddress: fakeAddress('A'),
    name: 'Test NGO',
    description: 'A test NGO description.',
    contactEmail: 'ngo@example.com',
    ...overrides,
  };
}

describe('POST /ngo-applications', () => {
  beforeAll(() => {
    process.env.ADMIN_ADDRESS = adminKeypair.publicKey();
  });

  afterEach(async () => {
    await resetDb();
  });

  it('creates a pending application', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/ngo-applications',
      payload: validApplicationPayload(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('PENDING');

    await app.close();
  });

  it('rejects invalid input with 400', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/ngo-applications',
      payload: validApplicationPayload({ contactEmail: 'not-an-email' }),
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('accepts a scheme-less website domain and normalizes it to https://', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/ngo-applications',
      payload: validApplicationPayload({ website: 'example.org' }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().website).toBe('https://example.org');

    await app.close();
  });

  it('accepts an already-schemed https website without double-prepending', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/ngo-applications',
      payload: validApplicationPayload({ website: 'https://example.org' }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().website).toBe('https://example.org');

    await app.close();
  });

  it('rejects a malformed ownerAddress with 400', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/ngo-applications',
      payload: validApplicationPayload({ ownerAddress: 'invalid-stellar-address' }),
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it('rejects a second pending application from the same address with 409', async () => {
    const app = buildServer();
    const payload = validApplicationPayload();

    const first = await app.inject({ method: 'POST', url: '/ngo-applications', payload });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: 'POST', url: '/ngo-applications', payload });
    expect(second.statusCode).toBe(409);

    await app.close();
  });

  it('rejects a new application from an already-approved NGO with 409 already_approved', async () => {
    const app = buildServer();
    const payload = validApplicationPayload();

    await prisma.ngoApplication.create({
      data: { ...payload, status: 'APPROVED' },
    });

    const response = await app.inject({ method: 'POST', url: '/ngo-applications', payload });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('already_approved');

    await app.close();
  });

  it('allows a rejected applicant to submit a new application', async () => {
    const app = buildServer();
    const payload = validApplicationPayload();

    await prisma.ngoApplication.create({
      data: { ...payload, status: 'REJECTED' },
    });

    const response = await app.inject({ method: 'POST', url: '/ngo-applications', payload });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe('PENDING');

    await app.close();
  });
});

describe('GET /ngo-applications/status', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('returns only status and timestamps for the latest application', async () => {
    const app = buildServer();
    const ownerAddress = fakeAddress('S');

    await prisma.ngoApplication.create({
      data: validApplicationPayload({ ownerAddress, status: 'REJECTED' }),
    });

    const latest = await prisma.ngoApplication.create({
      data: validApplicationPayload({ ownerAddress, status: 'APPROVED' }),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/ngo-applications/status?ownerAddress=${ownerAddress}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('APPROVED');
    expect(body.createdAt).toBe(latest.createdAt.toISOString());
    expect(body.updatedAt).toBe(latest.updatedAt.toISOString());
    expect(Object.keys(body).sort()).toEqual(['createdAt', 'status', 'updatedAt']);

    await app.close();
  });

  it('returns 404 when the address has no application', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: `/ngo-applications/status?ownerAddress=${fakeAddress('N')}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');

    await app.close();
  });

  it('rejects a malformed address with 400', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/ngo-applications/status?ownerAddress=not-an-address',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');

    await app.close();
  });

  it('rejects a missing address with 400', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/ngo-applications/status',
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('admin NGO application review', () => {
  beforeAll(() => {
    process.env.ADMIN_ADDRESS = adminKeypair.publicKey();
  });

  afterEach(async () => {
    await resetDb();
  });

  it('rejects an unsigned request with 401', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/ngo-applications',
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('rejects a validly encoded signature with the wrong byte length', async () => {
    const app = buildServer();
    const headers = signAdminRequest(adminKeypair, 'GET', '/ngo-applications');
    headers['x-admin-signature'] = Buffer.alloc(63).toString('base64');

    const response = await app.inject({
      method: 'GET',
      url: '/ngo-applications',
      headers,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('unauthorized');

    await app.close();
  });

  it('allows a correctly signed admin request', async () => {
    const app = buildServer();
    const headers = signAdminRequest(adminKeypair, 'GET', '/ngo-applications');

    const response = await app.inject({
      method: 'GET',
      url: '/ngo-applications',
      headers,
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('paginates applications while reporting the full total', async () => {
    const app = buildServer();

    await Promise.all(
      ['A', 'B', 'C'].map((suffix) =>
        prisma.ngoApplication.create({
          data: validApplicationPayload({ ownerAddress: fakeAddress(suffix) }),
        }),
      ),
    );

    const url = '/ngo-applications?limit=2&offset=1';
    const headers = signAdminRequest(adminKeypair, 'GET', url);

    const response = await app.inject({
      method: 'GET',
      url,
      headers,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.applications).toHaveLength(2);

    await app.close();
  });

  it('approves a pending application', async () => {
    const app = buildServer();

    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const url = `/ngo-applications/${application.id}/approve`;
    const headers = signAdminRequest(adminKeypair, 'POST', url);

    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('APPROVED');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('APPROVED');

    await app.close();
  });

  it('rejects a non-object (array) body on approve with 400 invalid_request', async () => {
    const app = buildServer();

    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const url = `/ngo-applications/${application.id}/approve`;
    const headers = signAdminRequest(adminKeypair, 'POST', url);

    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: [] as never,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('PENDING');

    await app.close();
  });

  it('rejects a non-object (array) body on reject with 400 invalid_request', async () => {
    const app = buildServer();

    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const url = `/ngo-applications/${application.id}/reject`;
    const headers = signAdminRequest(adminKeypair, 'POST', url);

    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: ['not', 'an', 'object'] as never,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('PENDING');

    await app.close();
  });

  it('rejects a pending application', async () => {
    const app = buildServer();

    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const url = `/ngo-applications/${application.id}/reject`;
    const headers = signAdminRequest(adminKeypair, 'POST', url);

    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { reviewNote: 'No registration documents on file.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('REJECTED');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('REJECTED');
    expect(stored?.reviewNote).toBe('No registration documents on file.');

    await app.close();
  });

  it('rejects a signature for a different URL than the one requested', async () => {
    const app = buildServer();

    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const realUrl = `/ngo-applications/${application.id}/approve`;

    const headers = signAdminRequest(adminKeypair, 'POST', '/ngo-applications/other-id/approve');

    const response = await app.inject({
      method: 'POST',
      url: realUrl,
      headers,
      payload: {},
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('returns 404 when approving or rejecting a non-existent application id', async () => {
    const app = buildServer();

    const nonExistentId = '00000000-0000-0000-0000-000000000000';

    const approveUrl = `/ngo-applications/${nonExistentId}/approve`;
    const approveHeaders = signAdminRequest(adminKeypair, 'POST', approveUrl);

    const approveResponse = await app.inject({
      method: 'POST',
      url: approveUrl,
      headers: approveHeaders,
      payload: {},
    });

    expect(approveResponse.statusCode).toBe(404);
    expect(approveResponse.json().error).toBe('not_found');

    const rejectUrl = `/ngo-applications/${nonExistentId}/reject`;
    const rejectHeaders = signAdminRequest(adminKeypair, 'POST', rejectUrl);

    const rejectResponse = await app.inject({
      method: 'POST',
      url: rejectUrl,
      headers: rejectHeaders,
      payload: {},
    });

    expect(rejectResponse.statusCode).toBe(404);
    expect(rejectResponse.json().error).toBe('not_found');

    await app.close();
  });
});

describe('GET /ngo-applications/stats', () => {
  beforeAll(() => {
    process.env.ADMIN_ADDRESS = adminKeypair.publicKey();
  });

  afterEach(async () => {
    await resetDb();
  });

  it('rejects an unsigned request with 401', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/ngo-applications/stats',
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });

  it('returns counts grouped by status for a signed admin', async () => {
    const app = buildServer();

    await prisma.ngoApplication.createMany({
      data: [
        validApplicationPayload({
          ownerAddress: fakeAddress('P'),
          status: 'PENDING',
        }),
        validApplicationPayload({
          ownerAddress: fakeAddress('P'),
          status: 'PENDING',
        }),
        validApplicationPayload({
          ownerAddress: fakeAddress('A'),
          status: 'APPROVED',
        }),
        validApplicationPayload({
          ownerAddress: fakeAddress('R'),
          status: 'REJECTED',
        }),
      ],
    });

    const headers = signAdminRequest(adminKeypair, 'GET', '/ngo-applications/stats');

    const response = await app.inject({
      method: 'GET',
      url: '/ngo-applications/stats',
      headers,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.counts).toEqual({
      PENDING: 2,
      APPROVED: 1,
      REJECTED: 1,
    });

    expect(body.total).toBe(4);

    await app.close();
  });

  it('returns zero counts when there are no applications', async () => {
    const app = buildServer();

    const headers = signAdminRequest(adminKeypair, 'GET', '/ngo-applications/stats');

    const response = await app.inject({
      method: 'GET',
      url: '/ngo-applications/stats',
      headers,
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();

    expect(body.counts).toEqual({
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
    });

    expect(body.total).toBe(0);

    await app.close();
  });
});

/**
 * `NgoApplication.status` is `PENDING -> APPROVED | REJECTED`, and both
 * targets are terminal. These tests cover transitions that must be refused
 * because the application has already been reviewed.
 */
describe('application review state machine', () => {
  beforeAll(() => {
    process.env.ADMIN_ADDRESS = adminKeypair.publicKey();
  });

  afterEach(async () => {
    await resetDb();
  });

  async function review(
    application: { id: string },
    decision: 'approve' | 'reject',
    payload: Record<string, unknown> = {},
  ) {
    const app = buildServer();

    const url = `/ngo-applications/${application.id}/${decision}`;

    const response = await app.inject({
      method: 'POST',
      url,
      headers: signAdminRequest(adminKeypair, 'POST', url),
      payload,
    });

    await app.close();

    return response;
  }

  it('refuses to approve an application that is already approved', async () => {
    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload({ status: 'APPROVED' }),
    });

    const response = await review(application, 'approve');

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('already_reviewed');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('APPROVED');
  });

  it('refuses to approve an application that was rejected', async () => {
    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload({ status: 'REJECTED' }),
    });

    const response = await review(application, 'approve');

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('already_reviewed');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('REJECTED');
  });

  it('refuses to reject an application that was approved', async () => {
    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload({ status: 'APPROVED' }),
    });

    const response = await review(application, 'reject');

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('already_reviewed');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('APPROVED');
  });

  it('refuses a re-review and leaves the recorded decision and note untouched', async () => {
    const application = await prisma.ngoApplication.create({
      data: {
        ...validApplicationPayload(),
        status: 'REJECTED',
        reviewNote: 'Original reviewer note.',
      },
    });

    const response = await review(application, 'approve', {
      reviewNote: 'Overwriting note.',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('already_reviewed');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('REJECTED');
    expect(stored?.reviewNote).toBe('Original reviewer note.');
  });

  it('reports the current status on a refused review', async () => {
    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload({ status: 'APPROVED' }),
    });

    const response = await review(application, 'approve');

    expect(response.statusCode).toBe(409);

    expect(response.json()).toEqual({
      error: 'already_reviewed',
      status: 'APPROVED',
    });
  });

  it('lets only one of two concurrent reviews through', async () => {
    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const url = `/ngo-applications/${application.id}/approve`;
    const app = buildServer();

    const headers = signAdminRequest(adminKeypair, 'POST', url);

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url,
        headers,
        payload: { reviewNote: 'First note.' },
      }),
      app.inject({
        method: 'POST',
        url,
        headers,
        payload: { reviewNote: 'Second note.' },
      }),
    ]);

    expect([first.statusCode, second.statusCode].sort((a, b) => a - b)).toEqual([200, 409]);

    const winner = first.statusCode === 200 ? first : second;
    const loser = first.statusCode === 200 ? second : first;

    expect(loser.json()).toEqual({
      error: 'already_reviewed',
      status: 'APPROVED',
    });

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('APPROVED');
    expect(stored?.reviewNote).toBe(winner.json().reviewNote);

    await app.close();
  });

  it('lets only one of two conflicting concurrent reviews through', async () => {
    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const approveUrl = `/ngo-applications/${application.id}/approve`;
    const rejectUrl = `/ngo-applications/${application.id}/reject`;

    const app = buildServer();

    const [approve, reject] = await Promise.all([
      app.inject({
        method: 'POST',
        url: approveUrl,
        headers: signAdminRequest(adminKeypair, 'POST', approveUrl),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: rejectUrl,
        headers: signAdminRequest(adminKeypair, 'POST', rejectUrl),
        payload: {},
      }),
    ]);

    expect([approve.statusCode, reject.statusCode].sort((a, b) => a - b)).toEqual([200, 409]);

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe(approve.statusCode === 200 ? 'APPROVED' : 'REJECTED');

    await app.close();
  });

  it('accepts a review note at the 2000 character limit', async () => {
    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const response = await review(application, 'approve', {
      reviewNote: 'a'.repeat(2000),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('APPROVED');
  });

  it('rejects an over-long review note with 400 and leaves the application pending', async () => {
    const application = await prisma.ngoApplication.create({
      data: validApplicationPayload(),
    });

    const response = await review(application, 'approve', {
      reviewNote: 'a'.repeat(2001),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_request');

    const stored = await prisma.ngoApplication.findUnique({
      where: { id: application.id },
    });

    expect(stored?.status).toBe('PENDING');
  });
});
