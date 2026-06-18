import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import vcRoutes from '../../src/routes/vc/index.js';
import { MockVCService } from '../mocks/MockVCService.js';

describe('VC route surface', () => {
  it('does not expose API-side delegation', async () => {
    const app = Fastify({ logger: false });
    await app.register(vcRoutes, {
      prefix: '/v1/vcs',
      vcService: new MockVCService() as never,
      adminApiKey: 'test-admin-key-0001',
    });
    await app.ready();

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
