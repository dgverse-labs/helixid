import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { HelixClient, VPBuilder } from '@helixid/sdk-js';
import { verifyJWT } from '@helixid/core';
import {
  LIVE_HEDERA_TIMEOUT_MS,
  onboardLiveAgent,
  resetLiveTestDatabase,
  startLiveApi,
  type LiveApi,
} from '../utils/liveApi.js';

describe('JWT Session Live Integration', () => {
  let api: LiveApi;

  beforeAll(async () => {
    await resetLiveTestDatabase();
    api = await startLiveApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('verifies a VP once, then authorizes repeated book-order actions with the JWT session', async () => {
    const client = new HelixClient(api.baseUrl, { adminApiKey: api.adminApiKey });
    const http = supertest(api.baseUrl);
    const agent = await onboardLiveAgent(api, client, {
      agentName: 'Live JWT Session Agent',
      requestedScopes: ['read:orders', 'write:orders'],
      requestedDomains: ['https://live-jwt-session.agent.example.com'],
      passphrase: 'live-jwt-session-passphrase',
    });

    try {
      const templateRes = await http.post('/v1/vp/template').send({
        agentDid: agent.did,
        userDid: 'did:hedera:testnet:live-book-buyer',
        targetService: 'amazon',
        vcType: 'HelixAgentCredential',
      });
      expect(templateRes.statusCode).toBe(201);

      const signedVP = await new VPBuilder(templateRes.body.unsignedVP).sign(
        agent.privateKeyHex,
        `${agent.did}#key-1`,
      );

      const verifyRes = await http.post('/v1/vp/verify').send({ signedVP, session: true });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body).toMatchObject({
        valid: true,
        agentDid: agent.did,
        userDid: 'did:hedera:testnet:live-book-buyer',
        targetService: 'amazon',
      });
      expect(verifyRes.body.session?.token).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
      expect(verifyRes.body.session?.publicKeyEndpoint).toBe('/v1/sessions/public-key');

      const publicKeyRes = await http.get('/v1/sessions/public-key');
      expect(publicKeyRes.statusCode).toBe(200);
      expect(publicKeyRes.body).toMatchObject({
        alg: 'EdDSA',
        crv: 'Ed25519',
      });
      expect(publicKeyRes.body.publicKeyHex).toMatch(/^[0-9a-f]+$/i);

      const publicKeyHex = publicKeyRes.body.publicKeyHex;
      const sessionToken = verifyRes.body.session?.token;
      expect(sessionToken).toBeTypeOf('string');
      if (!sessionToken) {
        throw new Error('Expected JWT session token to be returned');
      }

      const authorizeBookAction = async (action: 'search-book' | 'add-book-to-cart' | 'place-book-order'): Promise<void> => {
        const payload = verifyJWT(sessionToken, publicKeyHex);
        expect(payload.sub).toBe(agent.did);
        expect(payload.userDid).toBe('did:hedera:testnet:live-book-buyer');
        expect(payload.targetService).toBe('amazon');
        expect(payload.scopes).toEqual(expect.arrayContaining(['read:orders', 'write:orders']));
        expect(payload.vpId).toBe(signedVP.id);
        expect(action).toMatch(/book/);
      };

      await authorizeBookAction('search-book');
      await authorizeBookAction('add-book-to-cart');
      await authorizeBookAction('place-book-order');

      const replayRes = await http.post('/v1/vp/verify').send({ signedVP });
      expect(replayRes.statusCode).toBe(400);
      expect(replayRes.body.error.code).toBe('VP_VERIFICATION_FAILED');
    } finally {
      await agent.cleanup();
    }
  }, LIVE_HEDERA_TIMEOUT_MS);
});
