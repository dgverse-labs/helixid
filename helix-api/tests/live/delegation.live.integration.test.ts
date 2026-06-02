import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { HelixClient, VPBuilder } from '@helix-id/sdk-js';
import {
  LIVE_HEDERA_TIMEOUT_MS,
  onboardLiveAgent,
  resetLiveTestDatabase,
  startLiveApi,
  type LiveAgent,
  type LiveApi,
} from '../utils/liveApi.js';

describe('Delegation Live Integration', () => {
  let api: LiveApi;

  beforeAll(async () => {
    await resetLiveTestDatabase();
    api = await startLiveApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('supports two levels of live delegation and rejects a third level', async () => {
    const client = new HelixClient(api.baseUrl, { adminApiKey: api.adminApiKey });
    const http = supertest(api.baseUrl);
    const agentA = await onboardLiveAgent(api, client, {
      agentName: 'Live Delegator A',
      requestedScopes: ['read:orders', 'write:orders', 'read:catalog'],
      requestedDomains: ['https://live-delegator-a.agent.example.com'],
      maxDelegationDepth: 2,
      passphrase: 'live-delegator-a-passphrase',
    });
    const agentB = await onboardLiveAgent(api, client, {
      agentName: 'Live Delegate B',
      requestedScopes: ['read:catalog'],
      requestedDomains: ['https://live-delegate-b.agent.example.com'],
      passphrase: 'live-delegate-b-passphrase',
    });
    const agentC = await onboardLiveAgent(api, client, {
      agentName: 'Live Delegate C',
      requestedScopes: ['read:catalog'],
      requestedDomains: ['https://live-delegate-c.agent.example.com'],
      passphrase: 'live-delegate-c-passphrase',
    });
    const agentD = await onboardLiveAgent(api, client, {
      agentName: 'Live Delegate D',
      requestedScopes: ['read:catalog'],
      requestedDomains: ['https://live-delegate-d.agent.example.com'],
      passphrase: 'live-delegate-d-passphrase',
    });

    try {
      const agentAVP = await signDelegationAuthorityVP(http, agentA, agentB.did);
      const delegateBRes = await http.post('/v1/vcs/delegate').set('x-admin-api-key', api.adminApiKey).send({
        delegatorVP: agentAVP,
        delegateeAgentDid: agentB.did,
        requestedScopes: ['read:catalog', 'read:orders'],
        expiresInSeconds: 3600,
      });
      expect(delegateBRes.statusCode).toBe(201);
      expect(delegateBRes.body).toMatchObject({
        delegateeAgentDid: agentB.did,
        delegatedFrom: agentA.did,
        delegationDepth: 1,
        scopes: ['read:catalog', 'read:orders'],
      });
      expect(delegateBRes.body.vc.credentialSubject).toMatchObject({
        id: agentB.did,
        delegatedFrom: agentA.did,
        delegationDepth: 1,
        maxDelegationDepth: 2,
        parentVcId: agentA.vcId,
      });

      const agentBVP = await signDelegationAuthorityVP(http, {
        ...agentB,
        vcId: delegateBRes.body.vcId,
      }, agentC.did);
      const delegateCRes = await http.post('/v1/vcs/delegate').set('x-admin-api-key', api.adminApiKey).send({
        delegatorVP: agentBVP,
        delegateeAgentDid: agentC.did,
        requestedScopes: ['read:catalog'],
        expiresInSeconds: 1800,
      });
      expect(delegateCRes.statusCode).toBe(201);
      expect(delegateCRes.body).toMatchObject({
        delegateeAgentDid: agentC.did,
        delegatedFrom: agentB.did,
        delegationDepth: 2,
        scopes: ['read:catalog'],
      });
      expect(delegateCRes.body.vc.credentialSubject).toMatchObject({
        id: agentC.did,
        delegatedFrom: agentB.did,
        delegationDepth: 2,
        maxDelegationDepth: 2,
        parentVcId: delegateBRes.body.vcId,
      });

      const agentCVP = await signDelegatedServiceVP(http, {
        ...agentC,
        vcId: delegateCRes.body.vcId,
      }, 'amazon');
      const verifyCRes = await http.post('/v1/vp/verify').send({ signedVP: agentCVP });
      expect(verifyCRes.statusCode).toBe(200);
      expect(verifyCRes.body).toMatchObject({
        valid: true,
        agentDid: agentC.did,
        targetService: 'amazon',
      });

      const freshAgentCVP = await signDelegationAuthorityVP(http, {
        ...agentC,
        vcId: delegateCRes.body.vcId,
      }, agentD.did);
      const delegateDRes = await http.post('/v1/vcs/delegate').set('x-admin-api-key', api.adminApiKey).send({
        delegatorVP: freshAgentCVP,
        delegateeAgentDid: agentD.did,
        requestedScopes: ['read:catalog'],
        expiresInSeconds: 900,
      });
      expect(delegateDRes.statusCode).toBe(400);
      expect(delegateDRes.body.error.code).toBe('DELEGATION_DEPTH_EXCEEDED');
    } finally {
      await Promise.all([agentA.cleanup(), agentB.cleanup(), agentC.cleanup(), agentD.cleanup()]);
    }
  }, LIVE_HEDERA_TIMEOUT_MS);
});

async function signDelegationAuthorityVP(
  http: ReturnType<typeof supertest>,
  agent: LiveAgent,
  delegateeAgentDid: string,
) {
  return signVP(http, agent, {
    userDid: delegateeAgentDid,
    targetService: 'helix-delegation',
  });
}

async function signDelegatedServiceVP(
  http: ReturnType<typeof supertest>,
  agent: LiveAgent,
  targetService: string,
) {
  return signVP(http, agent, {
    userDid: 'did:hedera:testnet:live-user-delegation',
    targetService,
  });
}

async function signVP(
  http: ReturnType<typeof supertest>,
  agent: LiveAgent,
  params: { userDid: string; targetService: string },
) {
  const templateRes = await http.post('/v1/vp/template').send({
    agentDid: agent.did,
    userDid: params.userDid,
    targetService: params.targetService,
    vcType: 'HelixAgentCredential',
  });
  expect(templateRes.statusCode).toBe(201);
  expect(templateRes.body.unsignedVP.verifiableCredential[0].id).toBe(agent.vcId);

  return new VPBuilder(templateRes.body.unsignedVP).sign(
    agent.privateKeyHex,
    `${agent.did}#key-1`,
  );
}
