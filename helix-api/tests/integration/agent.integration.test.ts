import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { signBytes } from '@helixid/core';
import agentRoutes from '../../src/routes/agent/index.js';
import { AgentRepository } from '../../src/repositories/agent.repository.js';
import { AgentService } from '../../src/services/agent/agent.service.js';
import { MockDIDService } from '../mocks/MockDIDService.js';
import { MockVCService } from '../mocks/MockVCService.js';
import { TestAuditLogger } from '../utils/TestAuditLogger.js';

const TEST_PRIVATE_KEY_HEX = '00'.repeat(32);
const TEST_PUBLIC_KEY_HEX = '3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29';

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
        publicKeyHex: TEST_PUBLIC_KEY_HEX,
        domains: ['https://myagent.example.com']
      }
    });
    expect(step1.statusCode).toBe(200);
    const step1Body = step1.json();
    const signature = await signBytes(Buffer.from(step1Body.nonce, 'hex'), TEST_PRIVATE_KEY_HEX);
    const didCreateSignature = await signBytes(
      Buffer.from(step1Body.didCreateSigningPayloadHex, 'hex'),
      TEST_PRIVATE_KEY_HEX
    );

    const step2 = await app.inject({
      method: 'POST',
      url: '/v1/onboard/verify',
      payload: { challengeId: step1Body.challengeId, signature, didCreateSignature }
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
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ENROLLMENT_TOKEN_ALREADY_USED');
  });

});
