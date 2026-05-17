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

describe('VP Live Integration', () => {
  let api: LiveApi;

  beforeAll(async () => {
    await resetLiveTestDatabase();
    api = await startLiveApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('generates, signs, verifies, and rejects replay for a VP with real VC and VP signatures', async () => {
    const client = new HelixClient(api.baseUrl);
    const http = supertest(api.baseUrl);
    const agent = await onboardLiveAgent(api, client, {
      agentName: 'Live VP Agent',
      requestedScopes: ['read:orders'],
      requestedDomains: ['https://live-vp.agent.example.com'],
      passphrase: 'live-vp-passphrase',
    });

    try {
      const templateRes = await http.post('/v1/vp/template').send({
        agentDid: agent.did,
        userDid: 'did:hedera:testnet:live-user-placeholder',
        targetService: 'amazon',
        vcType: 'HelixAgentCredential',
      });
      expect(templateRes.statusCode).toBe(201);

      const signedVP = await new VPBuilder(templateRes.body.unsignedVP).sign(
        agent.privateKeyHex,
        `${agent.did}#key-1`,
      );

      const verifyRes = await http.post('/v1/vp/verify').send({ signedVP });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body).toMatchObject({
        valid: true,
        agentDid: agent.did,
        targetService: 'amazon',
      });

      const replayRes = await http.post('/v1/vp/verify').send({ signedVP });
      expect(replayRes.statusCode).toBe(400);
      expect(replayRes.body.error.code).toBe('VP_VERIFICATION_FAILED');
    } finally {
      await agent.cleanup();
    }
  }, LIVE_HEDERA_TIMEOUT_MS);

  it('rejects VP and VC tampering after signing', async () => {
    const client = new HelixClient(api.baseUrl);
    const http = supertest(api.baseUrl);
    const agent = await onboardLiveAgent(api, client, {
      agentName: 'Live Tamper Agent',
      requestedScopes: ['read:orders'],
      requestedDomains: ['https://live-tamper.agent.example.com'],
      passphrase: 'live-tamper-passphrase',
    });

    try {
      const templateRes = await http.post('/v1/vp/template').send({
        agentDid: agent.did,
        userDid: 'did:hedera:testnet:live-user-placeholder',
        targetService: 'amazon',
        vcType: 'HelixAgentCredential',
      });
      expect(templateRes.statusCode).toBe(201);

      const vpTampered = await new VPBuilder(templateRes.body.unsignedVP).sign(
        agent.privateKeyHex,
        `${agent.did}#key-1`,
      );
      vpTampered.targetService = 'tampered-service';
      const vpTamperRes = await http.post('/v1/vp/verify').send({ signedVP: vpTampered });
      expect(vpTamperRes.statusCode).toBe(400);

      const vcTampered = await new VPBuilder(templateRes.body.unsignedVP).sign(
        agent.privateKeyHex,
        `${agent.did}#key-1`,
      );
      (vcTampered.verifiableCredential[0] as any).credentialSubject.agentName = 'Tampered Agent';
      const vcTamperRes = await http.post('/v1/vp/verify').send({ signedVP: vcTampered });
      expect(vcTamperRes.statusCode).toBe(400);
    } finally {
      await agent.cleanup();
    }
  }, LIVE_HEDERA_TIMEOUT_MS);
});
