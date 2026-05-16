import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { HelixClient, VPBuilder } from '@helix-id/sdk-js';
import {
  LIVE_HEDERA_TIMEOUT_MS,
  onboardLiveAgent,
  resetLiveTestDatabase,
  startLiveApi,
  type LiveApi,
} from '../utils/liveApi.js';

describe('VC Expiry Live Integration', () => {
  let api: LiveApi;

  beforeAll(async () => {
    await resetLiveTestDatabase();
    api = await startLiveApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('rejects a VP carrying a VC that expired after signing', async () => {
    const client = new HelixClient(api.baseUrl);
    const http = supertest(api.baseUrl);
    const agent = await onboardLiveAgent(api, client, {
      agentName: 'Live Expiry Agent',
      requestedScopes: ['read:orders'],
      requestedDomains: ['https://live-expiry.agent.example.com'],
      passphrase: 'live-expiry-passphrase',
    });

    try {
      const shortVc = await client.issueVC({
        subjectDid: agent.did,
        subjectType: 'agent',
        privilegeScopes: ['read:orders'],
        agentName: 'Live Expiry Agent',
        expiresInSeconds: 1,
      });

      const templateRes = await http.post('/v1/vp/template').send({
        agentDid: agent.did,
        userDid: 'did:hedera:testnet:live-user-placeholder',
        targetService: 'amazon',
        vcType: 'HelixAgentCredential',
      });
      expect(templateRes.statusCode).toBe(201);
      expect(templateRes.body.unsignedVP.verifiableCredential[0].id).toBe(shortVc.vcId);

      const signedVP = await new VPBuilder(templateRes.body.unsignedVP).sign(
        agent.privateKeyHex,
        `${agent.did}#key-1`,
      );

      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const details = await client.getVC(shortVc.vcId);
      expect(details.status).toBe('expired');

      const verifyRes = await http.post('/v1/vp/verify').send({ signedVP });
      expect(verifyRes.statusCode).toBe(400);
      expect(verifyRes.body.error.code).toBe('VP_VERIFICATION_FAILED');
    } finally {
      await agent.cleanup();
    }
  }, LIVE_HEDERA_TIMEOUT_MS);
});
