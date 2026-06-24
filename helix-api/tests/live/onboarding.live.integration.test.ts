import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { AgentWallet, HelixClient } from '@helixid/sdk-js';
import { createTestPrisma } from '../utils/prisma.js';
import {
  LIVE_HEDERA_TIMEOUT_MS,
  onboardLiveAgent,
  resetLiveTestDatabase,
  startLiveApi,
  type LiveApi,
} from '../utils/liveApi.js';

describe('Onboarding Live Integration', () => {
  let api: LiveApi;

  beforeAll(async () => {
    await resetLiveTestDatabase();
    api = await startLiveApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('onboards an agent through the SDK and persists DID, VC, wallet, and audit state', async () => {
    const client = new HelixClient(api.baseUrl, { adminApiKey: api.adminApiKey });
    const http = supertest(api.baseUrl);
    const prisma = createTestPrisma();
    const agent = await onboardLiveAgent(api, client, {
      agentName: 'Live Onboarding Agent',
      requestedScopes: ['read:orders', 'write:orders'],
      requestedDomains: ['https://live-onboarding.agent.example.com'],
      passphrase: 'live-onboarding-passphrase',
    });

    try {
      expect(agent.did).toMatch(/^did:hedera:testnet:[a-zA-Z0-9._-]+$/);
      expect(agent.vcId).toMatch(/^vc:helix:/);

      const didRes = await http.get(`/v1/dids/${agent.did}`);
      expect(didRes.statusCode).toBe(200);
      expect(didRes.body.id).toBe(agent.did);
      expect(didRes.body.service[0].serviceEndpoint).toBe('https://live-onboarding.agent.example.com');

      const vcRecord = await prisma.vc.findUniqueOrThrow({ where: { vcId: agent.vcId } });
      expect(vcRecord.subjectDid).toBe(agent.did);
      expect(vcRecord.subjectType).toBe('agent');
      expect((vcRecord.vcJson as any).issuer).toBe(api.issuerDid);
      expect((vcRecord.vcJson as any).proof.verificationMethod).toBe(`${api.issuerDid}#key-1`);

      const rawWallet = await readFile(agent.walletPath, 'utf8');
      expect(rawWallet).toContain('encryptedPrivateKey');
      expect(rawWallet).not.toContain(agent.privateKeyHex);

      const wallet = await new AgentWallet().load('live-onboarding-passphrase', agent.walletPath);
      expect(wallet.did).toBe(agent.did);
      expect(wallet.credentials.map((credential) => credential.vcId)).toContain(agent.vcId);

      const auditTypes = (await prisma.auditLog.findMany()).map((entry: { eventType: string }) => entry.eventType);
      expect(auditTypes).toEqual(expect.arrayContaining([
        'ENROLLMENT_TOKEN_GENERATED',
        'ENROLLMENT_TOKEN_CONSUMED',
        'CHALLENGE_ISSUED',
        'CHALLENGE_VERIFIED',
        'DID_CREATED',
        'VC_ISSUED',
        'AGENT_ONBOARDED',
      ]));
    } finally {
      await prisma.$disconnect();
      await agent.cleanup();
    }
  }, LIVE_HEDERA_TIMEOUT_MS);
});
