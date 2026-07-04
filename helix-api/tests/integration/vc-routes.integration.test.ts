import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ErrorCode } from '@helixid/core';

import vcRoutes from '../../src/routes/vc/index.js';
import { MockVCService } from '../mocks/MockVCService.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

async function makeApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(vcRoutes, {
    prefix: '/v1/vcs',
    vcService: new MockVCService() as never,
    adminApiKey: 'test-admin-key-0001',
  });
  await app.ready();
  return app;
}

describe('VC route surface', () => {
  it('lists VCs behind admin auth', async () => {
    const app = await makeApp();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/vcs?status=active&limit=10',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([
      expect.objectContaining({
        vcId: 'vc:test:1',
        subjectDid: 'did:web:agent.example.com',
        agentName: 'Test Agent',
        scopes: ['read'],
        status: 'active',
      }),
    ]);
    await app.close();
  });

  it('requires admin auth for VC listing', async () => {
    const app = await makeApp();

    const response = await app.inject({ method: 'GET', url: '/v1/vcs' });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe(ErrorCode.ADMIN_AUTH_REQUIRED);
    await app.close();
  });

  it('does not expose API-side delegation', async () => {
    const app = await makeApp();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/vcs/delegate',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: {
        delegatorVP: {},
        delegateeAgentDid: 'did:web:agent.example.com',
        requestedScopes: ['read:orders'],
      },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
