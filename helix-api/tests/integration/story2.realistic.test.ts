import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { HelixClient } from '../../../helix-sdk-js/src/client/HelixClient.js';
import type { SignedVC } from '@helix-id/core';
import { resetTestDatabase, startRealisticApi, type RealisticApi } from '../utils/realisticApi.js';

describe('Story 2 Realistic VC Lifecycle Flow', () => {
  let apiServer: RealisticApi;

  beforeAll(async () => {
    await resetTestDatabase();
    apiServer = await startRealisticApi();
  });

  afterAll(async () => {
    await apiServer?.stop();
  });

  it('issues, reads, renews, revokes, and checks a VC through API and SDK calls', async () => {
    const baseUrl = apiServer.baseUrl;
    const client = new HelixClient(baseUrl);
    const api = supertest(baseUrl);

    const didResult = await client.createDID({
      subjectType: 'agent',
      domains: ['https://story2.agent.example.com']
    });

    const issued = await client.issueVC({
      subjectDid: didResult.did,
      subjectType: 'agent',
      privilegeScopes: ['read:orders', 'write:orders'],
      agentName: 'Story2 Realistic Agent',
      expiresInSeconds: 7_776_000
    });

    expect(issued.vcId).toMatch(/^vc:helix:[a-zA-Z0-9]+$/);
    expect(issued.statusListIndex).toBeGreaterThanOrEqual(0);
    expect(issued.vc.credentialSubject).toMatchObject({
      id: didResult.did,
      type: 'HelixAgent',
      agentName: 'Story2 Realistic Agent',
      privilegeScopes: ['read:orders', 'write:orders']
    });
    expect(issued.vc.proof).toMatchObject({
      type: 'Ed25519Signature2020',
      proofPurpose: 'assertionMethod'
    });

    const apiDetails = await api.get(`/v1/vcs/${issued.vcId}`);
    expect(apiDetails.statusCode).toBe(200);
    expect(apiDetails.body.status).toBe('active');
    expect(apiDetails.body.revokedAt).toBeNull();

    const renewed = await client.renewVC(issued.vcId, {
      privilegeScopes: ['read:orders'],
      expiresInSeconds: 7_776_000
    });
    expect(renewed.previousVcId).toBe(issued.vcId);
    expect(renewed.vcId).not.toBe(issued.vcId);

    const oldDetails = await client.getVC(issued.vcId);
    expect(oldDetails.renewedByVcId).toBe(renewed.vcId);

    const revokeRes = await api.post(`/v1/vcs/${issued.vcId}/revoke`).send({});
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.body.revoked).toBe(true);

    const revokedDetails = await client.getVC(issued.vcId);
    expect(revokedDetails.status).toBe('revoked');

    const statusList = await client.getStatusList('helix-status-list-1');
    expect(statusList.type).toContain('StatusList2021Credential');
    expect(await client.checkVCStatus(issued.vc as SignedVC)).toBe('revoked');
  });
});
