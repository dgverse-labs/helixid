import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { AgentWallet, HelixClient } from '@helixid/sdk-js';
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
    const agent = await onboardLiveAgent(api, client, {
      agentName: 'Live Onboarding Agent',
      requestedScopes: ['read:orders', 'write:orders'],
      requestedDomains: ['https://live-onboarding.agent.example.com'],
      passphrase: 'live-onboarding-passphrase',
    });

    try {
      // Agent DIDs are minted per the server's configured DID_METHOD (see
      // DIDService.createDID) — did:hedera in production, but did:key/did:web
      // work equally well and need no Hedera network at all, so this only
      // pins the shape, not a specific method.
      expect(agent.did).toMatch(/^did:(hedera:testnet:[a-zA-Z0-9._-]+|key:z\w+|web:[\w.:%-]+)$/);
      expect(agent.vcId).toMatch(/^vc:helix:/);

      const didRes = await http.get(`/v1/dids/${agent.did}`);
      expect(didRes.statusCode).toBe(200);
      expect(didRes.body.id).toBe(agent.did);
      expect(didRes.body.service[0].serviceEndpoint).toBe('https://live-onboarding.agent.example.com');

      // Storage-agnostic: goes through the public API rather than a raw
      // Prisma/Postgres query, so this passes under any configured storage
      // adapter (sqlite in this sandbox, Postgres elsewhere).
      const vcRecord = await client.getVC(agent.vcId);
      expect((vcRecord.vc as Record<string, unknown>)['issuer']).toBe(api.issuerDid);
      expect(vcRecord.status).toBe('active');
      expect((vcRecord.vc as { credentialSubject: { id: string; type: string } })['credentialSubject']).toMatchObject({
        id: agent.did,
        type: 'HelixAgent',
      });
      expect((vcRecord.vc as { proof: { verificationMethod: string } })['proof'].verificationMethod).toBe(
        `${api.issuerDid}#key-1`,
      );

      const rawWallet = await readFile(agent.walletPath, 'utf8');
      expect(rawWallet).toContain('encryptedPrivateKey');
      expect(rawWallet).not.toContain(agent.privateKeyHex);

      const wallet = await new AgentWallet().load('live-onboarding-passphrase', agent.walletPath);
      expect(wallet.did).toBe(agent.did);
      expect(wallet.credentials.map((credential) => credential.vcId)).toContain(agent.vcId);

      const auditLog = await client.getAuditLog({ limit: 100 });
      const auditTypes = auditLog.map((entry) => entry.eventType);
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
      await agent.cleanup();
    }
  }, LIVE_HEDERA_TIMEOUT_MS);
});
