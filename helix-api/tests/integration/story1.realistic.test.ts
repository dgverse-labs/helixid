import { describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { HelixClient } from '../../../helix-sdk-js/src/client/HelixClient.js';
import { HttpAdapter } from '../../../helix-sdk-js/src/http/HttpAdapter.js';

describe('Story 1 Realistic DID Lifecycle Flow', () => {
  it('successfully creates, resolves, updates, and deactivates a DID', async () => {
    // We hit the local running Fastify instance
    const baseUrl = 'http://localhost:3000';
    const client = new HelixClient(baseUrl);
    const api = supertest(baseUrl);

    // 1. Create DID using SDK (SDK handles keypair generation locally)
    const createResult = await client.createDID({
      subjectType: 'agent',
      domains: ['https://example.com/agent-endpoint']
    });

    expect(createResult.did).toMatch(/^did:hedera:testnet:z[1-9A-HJ-NP-Za-km-z]+$/);
    expect(createResult.keyPair.privateKeyHex).toBeDefined();
    expect(createResult.keyPair.publicKeyHex).toBeDefined();
    expect(createResult.hederaTransactionId).toBeDefined();
    expect(createResult.didDocument.id).toBe(createResult.did);
    
    // Verify it was actually created via the API directly
    const resolveRes = await api.get(`/v1/dids/${createResult.did}`);
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.body.source).toBe('cache');
    expect(resolveRes.body.didDocument.id).toBe(createResult.did);
    expect(resolveRes.body.didDocument.service).toHaveLength(1);
    expect(resolveRes.body.didDocument.service[0].serviceEndpoint).toBe('https://example.com/agent-endpoint');

    // 2. Add a new service endpoint via SDK
    const addResult = await client.addServiceEndpoint(createResult.did, {
      id: '#domain-2',
      type: 'LinkedDomains',
      serviceEndpoint: 'https://another-endpoint.com'
    });

    expect(addResult.didDocument.service).toHaveLength(2);
    expect(addResult.didDocument.service[1].serviceEndpoint).toBe('https://another-endpoint.com');

    // 3. Remove the service endpoint via SDK
    const removeResult = await client.removeServiceEndpoint(createResult.did, '#domain-2');
    
    expect(removeResult.didDocument.service).toHaveLength(1);
    expect(removeResult.didDocument.service[0].id).not.toBe('#domain-2');

    // 4. Deactivate the DID via API directly
    const deactivateRes = await api
      .post(`/v1/dids/${createResult.did}/deactivate`)
      .send({ reason: 'testing deactivation' });

    expect(deactivateRes.statusCode).toBe(200);
    expect(deactivateRes.body.deactivated).toBe(true);

    // 5. Try to resolve deactivated DID - should fail with 410 Gone
    const resolveDeactivatedRes = await api.get(`/v1/dids/${createResult.did}`);
    expect(resolveDeactivatedRes.statusCode).toBe(410);
    expect(resolveDeactivatedRes.body.error.code).toBe('DID_DEACTIVATED');

    console.log('REALISTIC DID LIFECYCLE SUCCESSFUL');
  });
});
