// Copyright 2026 DgVerse LLP
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HelixClient } from '../../../src/client/HelixClient.js';
import { createStatusList } from '@helix-id/core';

describe('HelixClient Full Unit Tests', () => {
  let mockHttp: any;
  let client: HelixClient;

  beforeEach(() => {
    mockHttp = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    client = new HelixClient(mockHttp, 'http://api');
  });

  it('resolves DID with live option', async () => {
    mockHttp.get.mockResolvedValue({ didDocument: { id: 'did:1' } });
    const res = await client.resolveDID('did:1', { live: true });
    expect(mockHttp.get).toHaveBeenCalledWith('/v1/dids/did%3A1?live=true');
    expect(res.source).toBe('hedera');
  });

  it('adds service endpoint', async () => {
    const endpoint = { id: 's1', type: 'S', serviceEndpoint: 'http://s' };
    mockHttp.post.mockResolvedValue({ id: 'did:1' });
    await client.addServiceEndpoint('did:1', endpoint);
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/dids/did%3A1/services', endpoint);
  });

  it('removes service endpoint', async () => {
    mockHttp.delete.mockResolvedValue({ id: 'did:1' });
    await client.removeServiceEndpoint('did:1', 's1');
    expect(mockHttp.delete).toHaveBeenCalledWith('/v1/dids/did%3A1/services/s1');
  });

  it('deactivates DID', async () => {
    mockHttp.post.mockResolvedValue({});
    const res = await client.deactivateDID('did:1', 'lost');
    expect(res.deactivated).toBe(true);
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/dids/did%3A1/deactivate', { reason: 'lost' });
  });

  it('issues VC', async () => {
    mockHttp.post.mockResolvedValue({ vcId: 'vc1' });
    await client.issueVC({ subjectDid: 'did:1', subjectType: 'user' });
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vcs', expect.objectContaining({ subjectDid: 'did:1' }));
  });

  it('revokes and renews VC', async () => {
    mockHttp.post.mockResolvedValue({});
    await client.revokeVC('vc1');
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vcs/vc1/revoke');
    
    await client.renewVC('vc1', { privilegeScopes: ['read'] });
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vcs/vc1/renew', { privilegeScopes: ['read'] });
  });

  it('checks VC status - expired', async () => {
    const vc = { expirationDate: new Date(Date.now() - 1000).toISOString() } as any;
    const status = await client.checkVCStatus(vc);
    expect(status).toBe('expired');
  });

  it('checks VC status - active/revoked', async () => {
    const vc = { 
      expirationDate: new Date(Date.now() + 10000).toISOString(),
      credentialStatus: { statusListCredential: 'http://list', statusListIndex: '0' }
    } as any;
    const validList = createStatusList();
    mockHttp.get.mockResolvedValue({ credentialSubject: { encodedList: validList } });
    const status = await client.checkVCStatus(vc);
    expect(status).toBe('active');
  });

  it('manages user challenges', async () => {
    mockHttp.post.mockResolvedValue({ challengeId: 'c1' });
    await client.requestUserChallenge('did:1');
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/challenges', { did: 'did:1', purpose: 'user_verification' });

    await client.verifyUserChallenge('c1', 'sig');
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/challenges/c1/verify', { signature: 'sig' });
  });

  it('lists and gets services', async () => {
    mockHttp.get.mockResolvedValue({ services: [] });
    await client.listServices();
    expect(mockHttp.get).toHaveBeenCalledWith('/v1/services');

    mockHttp.get.mockResolvedValue({});
    await client.getService('s1');
    expect(mockHttp.get).toHaveBeenCalledWith('/v1/services/s1');
  });
});
