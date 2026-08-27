// Copyright 2026 DgVerse LLP
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HelixClient } from '../../../src/client/HelixClient.js';
import { createStatusList } from '../../../src/core/status-list-schema.js';
import { generateKeyPair, publicKeyToMultibase } from '../../../src/core/keys.js';
import { issueJWT } from '../../../src/core/jwt.js';
import { selfIssueVC } from '../../../src/core/self-signed.js';
import { VPBuilder } from '../../../src/vp-builder.js';

describe('HelixClient Full Unit Tests', () => {
  let mockHttp: any;
  let client: HelixClient;

  beforeEach(() => {
    mockHttp = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
      hasAdminApiKey: vi.fn(() => false),
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

  it('lists VCs with filters', async () => {
    mockHttp.get.mockResolvedValue([]);
    await client.listVCs({ subjectDid: 'did:1', status: 'active', limit: 25 });
    expect(mockHttp.get).toHaveBeenCalledWith('/v1/vcs?subjectDid=did%3A1&status=active&limit=25');
  });

  it('revokes and renews VC', async () => {
    mockHttp.post.mockResolvedValue({});
    await client.revokeVC('vc1');
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vcs/vc1/revoke');
    
    await client.renewVC('vc1', { privilegeScopes: ['read'] });
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vcs/vc1/renew', { privilegeScopes: ['read'] });
  });

  it('checks VC status - expired', async () => {
    // Status is decided server-side (see docs/proposal-sdk-api-only.md) — the
    // client just relays whatever GET /v1/vcs/:id/status reports.
    const vc = { id: 'vc:expired-1', validUntil: new Date(Date.now() - 1000).toISOString() } as any;
    mockHttp.get.mockResolvedValue({ vcId: vc.id, status: 'expired' });
    const status = await client.checkVCStatus(vc);
    expect(mockHttp.get).toHaveBeenCalledWith(`/v1/vcs/${encodeURIComponent(vc.id)}/status`);
    expect(status).toBe('expired');
  });

  it('checks VC status - active/revoked', async () => {
    const vc = { id: 'vc:active-1', validUntil: new Date(Date.now() + 10000).toISOString() } as any;
    mockHttp.get.mockResolvedValue({ vcId: vc.id, status: 'active' });
    const status = await client.checkVCStatus(vc);
    expect(status).toBe('active');

    mockHttp.get.mockResolvedValue({ vcId: vc.id, status: 'revoked' });
    expect(await client.checkVCStatus(vc)).toBe('revoked');
  });

  it('manages user challenges', async () => {
    mockHttp.post.mockResolvedValue({ challengeId: 'c1' });
    await client.requestUserChallenge('did:1');
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/challenges', { did: 'did:1', purpose: 'user_verification' });

    await client.verifyUserChallenge('c1', 'sig');
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/challenges/c1/verify', { signature: 'sig' });
  });

  it('creates status lists through the API', async () => {
    mockHttp.post.mockResolvedValue({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'http://api/v1/status-list/helix-status-list-1',
      type: ['VerifiableCredential', 'BitstringStatusListCredential'],
      issuer: 'did:web:localhost',
      validFrom: new Date().toISOString(),
      credentialSubject: {
        id: 'http://api/v1/status-list/helix-status-list-1#list',
        type: 'BitstringStatusList',
        statusPurpose: 'revocation',
        encodedList: createStatusList(),
      },
    });
    const statusList = await client.createStatusList({ length: 64 });
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/status-list', { length: 64 });
    expect(statusList.type).toContain('BitstringStatusListCredential');
  });

  it('exposes API-backed VP verification but not delegation helpers', () => {
    expect(typeof client.verifyVP).toBe('function');
    expect('createVPTemplate' in client).toBe(false);
    expect('delegate' in client).toBe(false);
  });

  it('forwards VP verification to the API and returns its result as-is', async () => {
    // Verification and VP_VERIFIED/VP_REJECTED audit logging both happen
    // server-side now (see docs/proposal-sdk-api-only.md) — the client makes
    // exactly one POST and does not also write its own audit entry.
    const wallet = generateKeyPair();
    const did = `did:key:${publicKeyToMultibase(wallet.publicKey)}`;
    const vc = await selfIssueVC({ scopes: ['read:orders'] }, { did, privateKeyHex: wallet.privateKey });
    const vp = await new VPBuilder({
      credentials: [vc],
      holderDid: did,
      targetService: 'orders',
      userDid: did,
    }).sign(wallet.privateKey, `${did}#key-1`);

    const apiResult = {
      valid: true,
      agentDid: did,
      vpId: vp.id,
      privilegeScopes: ['read:orders'],
      effectiveScopes: ['read:orders'],
      delegationChain: [],
      targetService: 'orders',
      verifiedAt: new Date().toISOString(),
    };
    mockHttp.post.mockResolvedValue(apiResult);

    const result = await client.verifyVP(vp, { allowSelfSigned: true });

    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vp/verify', {
      signedVP: vp,
      allowSelfSigned: true,
    });
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(result).toBe(apiResult);
  });

  it('propagates the API rejection when VP verification fails', async () => {
    mockHttp.post.mockRejectedValue(new Error('VP_REJECTED: signature invalid'));

    await expect(
      client.verifyVP({ id: 'vp:test', holder: 'did:key:abc' } as any),
    ).rejects.toThrow('VP_REJECTED: signature invalid');
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
  });

  it('fetches and locally verifies JWT session tokens', async () => {
    const keys = generateKeyPair();
    mockHttp.get.mockResolvedValue({
      publicKeyHex: keys.publicKey,
      publicKeyMultibase: 'zkey',
      alg: 'EdDSA',
      crv: 'Ed25519',
    });

    await expect(client.fetchSessionPublicKey()).resolves.toBe(keys.publicKey);
    expect(mockHttp.get).toHaveBeenCalledWith('/v1/sessions/public-key');

    const token = issueJWT({
      iss: 'did:hedera:testnet:issuer',
      sub: 'did:hedera:testnet:agent',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
      jti: 'jwt:test',
      userDid: 'did:hedera:testnet:user',
      targetService: 'amazon',
      scopes: ['read:orders'],
      vpId: 'vp:helix:test',
    }, keys.privateKey);

    expect(client.verifySessionToken(token, keys.publicKey)).toMatchObject({
      sub: 'did:hedera:testnet:agent',
      targetService: 'amazon',
    });
  });

  it('gets audit log with filters', async () => {
    mockHttp.get.mockResolvedValue([]);
    await client.getAuditLog({ eventType: 'VC_ISSUED', since: '2026-07-03T00:00:00.000Z', limit: 10 });
    expect(mockHttp.get).toHaveBeenCalledWith(
      '/v1/audit-log?eventType=VC_ISSUED&since=2026-07-03T00%3A00%3A00.000Z&limit=10',
    );
  });

  it('throws SDK_ONLY_MODE_NO_API for enrollment calls without an API URL', async () => {
    const sdkOnly = new HelixClient();
    await expect(sdkOnly.requestOnboardingChallenge('token')).rejects.toMatchObject({
      code: 'SDK_ONLY_MODE_NO_API',
    });
  });
});
