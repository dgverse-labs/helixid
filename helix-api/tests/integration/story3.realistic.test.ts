import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { HelixClient } from '../../../helix-sdk-js/src/client/HelixClient.js';
import { VPBuilder } from '../../../helix-sdk-js/src/vp/VPBuilder.js';
import { resetTestDatabase, startRealisticApi, type RealisticApi } from '../utils/realisticApi.js';

describe('Story 3 Realistic VP Flow', () => {
  let apiServer: RealisticApi;

  beforeAll(async () => {
    await resetTestDatabase();
    apiServer = await startRealisticApi();
  });

  afterAll(async () => {
    await apiServer?.stop();
  });

  it('successfully generates and verifies a VP using API-created DIDs and SDK-held keys', async () => {
    const client = new HelixClient(apiServer.baseUrl);
    const api = supertest(apiServer.baseUrl);
    const agent = await client.createDID({
      subjectType: 'agent',
      domains: ['https://story3.agent.example.com']
    });
    await client.issueVC({
      subjectDid: agent.did,
      subjectType: 'agent',
      privilegeScopes: ['read:orders'],
      agentName: 'Story3 Agent',
      expiresInSeconds: 7_776_000
    });

    // 1. Request VP Template
    const templateRes = await api
      .post('/v1/vp/template')
      .send({
        agentDid: agent.did,
        userDid: 'did:hedera:testnet:dummy-user', 
        targetService: 'amazon',
        vcType: 'HelixAgentCredential'
      });

    expect(templateRes.statusCode).toBe(201);
    const { unsignedVP } = templateRes.body;

    // 2. Sign the VP (Agent Side Logic)
    const builder = new VPBuilder(unsignedVP);
    const signedVP = await builder.sign(agent.keyPair.privateKey, `${agent.did}#key-1`);

    // 3. Verify the VP
    const verifyRes = await api
      .post('/v1/vp/verify')
      .send({ signedVP });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
    expect(verifyRes.body.agentDid).toBe(agent.did);
  });
});
