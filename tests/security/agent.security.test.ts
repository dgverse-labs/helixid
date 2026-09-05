import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import agentRoutes from '../../src/routes/agent/index.js';
import { AgentRepository } from '../../src/repositories/agent.repository.js';
import { AgentService } from '../../src/services/agent/agent.service.js';
import { MockDIDService } from '../mocks/MockDIDService.js';
import { MockVCService } from '../mocks/MockVCService.js';
import { TestAuditLogger } from '../utils/TestAuditLogger.js';

function makeApp(auditLogger = new TestAuditLogger()) {
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
    auditLogger
  );
  app.register(agentRoutes, { prefix: '/v1', agentService: service });
  return { app, auditLogger };
}

describe('agent security', () => {
  it('prevents enrollment token replay', async () => {
    const { app } = makeApp();
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/v1/enrollment-tokens',
      payload: { agentName: 'Agent', requestedScopes: ['read:orders'] }
    });
    const token = tokenRes.json().token as string;
    const first = await app.inject({
      method: 'POST',
      url: '/v1/onboard',
      payload: { enrollmentToken: token, publicKeyHex: 'b'.repeat(64), domains: [] }
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/v1/onboard',
      payload: { enrollmentToken: token, publicKeyHex: 'b'.repeat(64), domains: [] }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ENROLLMENT_TOKEN_ALREADY_USED');
  });

  it('does not leak raw enrollment token in audit log payloads', async () => {
    const { app, auditLogger } = makeApp();
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/v1/enrollment-tokens',
      payload: { agentName: 'Agent', requestedScopes: ['read:orders'] }
    });
    const token = tokenRes.json().token as string;
    await app.inject({
      method: 'POST',
      url: '/v1/onboard',
      payload: { enrollmentToken: token, publicKeyHex: 'b'.repeat(64), domains: [] }
    });
    const allLogs = JSON.stringify(auditLogger.events);
    expect(allLogs.includes(token)).toBe(false);
  });
});
