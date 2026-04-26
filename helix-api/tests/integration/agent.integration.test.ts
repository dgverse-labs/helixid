import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import agentRoutes from '../../src/routes/agent/index.js';
import { AgentRepository } from '../../src/repositories/agent.repository.js';
import { AgentService } from '../../src/services/agent/agent.service.js';
import { MockDIDService } from '../mocks/MockDIDService.js';
import { MockVCService } from '../mocks/MockVCService.js';
import { TestAuditLogger } from '../utils/TestAuditLogger.js';

function makeApp() {
  const app = Fastify();
  const service = new AgentService(
    new AgentRepository(),
    new MockDIDService({
      id: 'did:hedera:testnet:user-1',
      verificationMethod: [
        {
          id: 'did:hedera:testnet:user-1#key-1',
          type: 'Ed25519VerificationKey2020',
          publicKeyHex: 'a'.repeat(64)
        }
      ]
    }),
    new MockVCService(),
    new TestAuditLogger()
  );
  app.register(agentRoutes, { prefix: '/v1', agentService: service });
  return app;
}

describe('agent integration', () => {
  it('completes onboarding flow', async () => {
    const app = makeApp();
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/v1/enrollment-tokens',
      payload: {
        agentName: 'My Agent',
        requestedScopes: ['read:orders'],
        requestedDomains: ['https://myagent.example.com']
      }
    });
    expect(tokenRes.statusCode).toBe(201);
    const tokenBody = tokenRes.json();

    const step1 = await app.inject({
      method: 'POST',
      url: '/v1/onboard',
      payload: {
        enrollmentToken: tokenBody.token,
        publicKeyHex: 'b'.repeat(64),
        domains: ['https://myagent.example.com']
      }
    });
    expect(step1.statusCode).toBe(200);
    const step1Body = step1.json();

    const step2 = await app.inject({
      method: 'POST',
      url: '/v1/onboard/verify',
      payload: { challengeId: step1Body.challengeId, signature: 'c'.repeat(128) }
    });
    expect(step2.statusCode).toBe(201);
    expect(step2.json().agentDid).toContain('did:hedera:testnet:');
  });

  it('returns used-token error on second onboard call', async () => {
    const app = makeApp();
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/v1/enrollment-tokens',
      payload: { agentName: 'My Agent', requestedScopes: ['read:orders'] }
    });
    const token = tokenRes.json().token as string;
    await app.inject({
      method: 'POST',
      url: '/v1/onboard',
      payload: { enrollmentToken: token, publicKeyHex: 'd'.repeat(64), domains: [] }
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/onboard',
      payload: { enrollmentToken: token, publicKeyHex: 'd'.repeat(64), domains: [] }
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe('ENROLLMENT_TOKEN_ALREADY_USED');
  });

  it('supports service registry create/get/list', async () => {
    const app = makeApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/services',
      payload: {
        serviceName: 'amazon',
        displayName: 'Amazon',
        verifiedDomain: 'https://amazon.com',
        apiEndpoint: 'https://api.amazon.com/helix/verify',
        publicKeyMultibase: 'z123',
        metadata: {}
      }
    });
    expect(createRes.statusCode).toBe(201);

    const getRes = await app.inject({ method: 'GET', url: '/v1/services/amazon' });
    expect(getRes.statusCode).toBe(200);

    const listRes = await app.inject({ method: 'GET', url: '/v1/services' });
    expect(listRes.statusCode).toBe(200);
    expect(Array.isArray(listRes.json().services)).toBe(true);
  });
});
