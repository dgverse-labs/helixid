// Copyright 2026 DgVerse LLP
import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import vcRoutes from '../../src/routes/vc/index.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

const ADMIN_KEY = 'test-admin-key-0001';

async function buildApp(listVCs = vi.fn().mockResolvedValue([])): Promise<{
  app: FastifyInstance;
  listVCs: ReturnType<typeof vi.fn>;
}> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(vcRoutes, {
    prefix: '/v1/vcs',
    vcService: { listVCs } as never,
    adminApiKey: ADMIN_KEY,
  });
  await app.ready();
  return { app, listVCs };
}

describe('GET /v1/vcs', () => {
  it('rejects requests without the admin key', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/vcs' });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('returns VC summaries and forwards filters', async () => {
    const summaries = [
      {
        vcId: 'vc:1',
        subjectDid: 'did:agent:1',
        agentName: 'billing',
        scopes: ['read:orders'],
        status: 'active',
        issuedAt: '2026-06-01T00:00:00.000Z',
        expiresAt: '2026-09-01T00:00:00.000Z',
      },
    ];
    const { app, listVCs } = await buildApp(vi.fn().mockResolvedValue(summaries));

    const response = await app.inject({
      method: 'GET',
      url: '/v1/vcs?subjectDid=did:agent:1&status=active&limit=10',
      headers: { 'x-admin-api-key': ADMIN_KEY },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(summaries);
    expect(listVCs).toHaveBeenCalledWith({
      subjectDid: 'did:agent:1',
      status: 'active',
      limit: 10,
    });
    await app.close();
  });

  it('defaults filters when none are supplied', async () => {
    const { app, listVCs } = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/vcs',
      headers: { 'x-admin-api-key': ADMIN_KEY },
    });

    expect(response.statusCode).toBe(200);
    expect(listVCs).toHaveBeenCalledWith({
      subjectDid: undefined,
      status: undefined,
      limit: undefined,
    });
    await app.close();
  });

  it('rejects invalid status and limit values', async () => {
    const { app } = await buildApp();
    const headers = { 'x-admin-api-key': ADMIN_KEY };

    const badStatus = await app.inject({ method: 'GET', url: '/v1/vcs?status=frozen', headers });
    expect(badStatus.statusCode).toBe(400);

    const badLimit = await app.inject({ method: 'GET', url: '/v1/vcs?limit=-1', headers });
    expect(badLimit.statusCode).toBe(400);

    await app.close();
  });
});
