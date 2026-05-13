import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { VPBuilder } from '../../../helix-sdk-js/src/vp/VPBuilder.js';

// Real data provided by user
const AGENT_DID = 'did:hedera:testnet:42ubDg7iWCsGJTemHKEUWDQifEHM3KPHTmQgN5Hofogm_0.0.8050123';
const AGENT_PRIV_KEY = '815ce1219c40cb2e864ca2411da7ba9eb4b8ed29dcc1d8c076392d2bbde2961e';

describe('Story 3 Realistic VP Flow', () => {
  it('successfully generates and verifies a VP using real Hedera DIDs and keys', async () => {
    const api = supertest('http://localhost:3000');

    // 1. Request VP Template
    const templateRes = await api
      .post('/v1/vp/template')
      .send({
        agentDid: AGENT_DID,
        userDid: 'did:hedera:testnet:dummy-user', 
        targetService: 'amazon',
        vcType: 'BookOrderingCredential'
      });

    expect(templateRes.statusCode).toBe(201);
    const { unsignedVP } = templateRes.body;

    // 2. Sign the VP (Agent Side Logic)
    const builder = new VPBuilder(unsignedVP);
    const signedVP = await builder.sign(AGENT_PRIV_KEY, `${AGENT_DID}#key-1`);

    console.log(signedVP);
    // 3. Verify the VP
    const verifyRes = await api
      .post('/v1/vp/verify')
      .send({ signedVP });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
    expect(verifyRes.body.agentDid).toBe(AGENT_DID);
    
    console.log('REALISTIC VERIFICATION SUCCESSFUL');
  });
});
