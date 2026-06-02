// Copyright 2026 DgVerse LLP
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HelixClient } from '../../../src/client/HelixClient.js';
import { AgentWallet } from '../../../src/wallet/AgentWallet.js';
import { createStatusList, generateKeyPair, issueJWT } from '@helix-id/core';

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
    const vc = { validUntil: new Date(Date.now() - 1000).toISOString() } as any;
    const status = await client.checkVCStatus(vc);
    expect(status).toBe('expired');
  });

  it('checks VC status - active/revoked', async () => {
    const vc = { 
      validUntil: new Date(Date.now() + 10000).toISOString(),
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

  it('verifies VP through API with optional session flag', async () => {
    mockHttp.post.mockResolvedValue({ valid: true });
    await client.verifyVP({ id: 'vp:helix:test' } as any);
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vp/verify', { signedVP: { id: 'vp:helix:test' } });

    await client.verifyVP({ id: 'vp:helix:test' } as any, { session: true });
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vp/verify', {
      signedVP: { id: 'vp:helix:test' },
      session: true,
    });
  });

  it('requests VP templates through the public SDK method', async () => {
    mockHttp.post.mockResolvedValue({
      unsignedVP: { id: 'vp:helix:test' },
      vpId: 'vp:helix:test',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(client.createVPTemplate({
      agentDid: 'did:hedera:testnet:agent',
      userDid: 'did:hedera:testnet:user',
      targetService: 'orders',
      vcType: 'HelixAgentCredential',
      vcId: 'vc:helix:selected',
    })).resolves.toMatchObject({ vpId: 'vp:helix:test' });
    expect(mockHttp.post).toHaveBeenCalledWith('/v1/vp/template', {
      agentDid: 'did:hedera:testnet:agent',
      userDid: 'did:hedera:testnet:user',
      targetService: 'orders',
      vcType: 'HelixAgentCredential',
      vcId: 'vc:helix:selected',
    });
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

  it('delegates by signing a template from the selected wallet credential', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-delegate-'));
    const walletPath = join(dir, 'wallet.json');
    const keys = generateKeyPair();
    const wallet = new AgentWallet();

    try {
      await wallet.save({
        did: 'did:hedera:testnet:delegator',
        publicKeyHex: keys.publicKey,
        privateKeyHex: keys.privateKey,
        credentials: [AgentWallet.credentialFromVC('vc:helix:selected', {
          id: 'vc:helix:selected',
          type: ['VerifiableCredential', 'HelixAgentCredential'],
          issuer: 'did:hedera:testnet:issuer',
          credentialSubject: { id: 'did:hedera:testnet:delegator' },
        })],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, 'pass', walletPath);

      mockHttp.post
        .mockResolvedValueOnce({
          unsignedVP: {
            '@context': ['https://www.w3.org/ns/credentials/v2'],
            type: ['VerifiablePresentation'],
            id: 'vp:helix:delegate',
            holder: 'did:hedera:testnet:delegator',
            verifiableCredential: [{ id: 'vc:helix:selected' }],
            nonce: 'a'.repeat(64),
            expirationDate: new Date(Date.now() + 60_000).toISOString(),
            delegatedBy: 'did:hedera:testnet:delegatee',
            targetService: 'helix-delegation',
          },
          vpId: 'vp:helix:delegate',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })
        .mockResolvedValueOnce({ vcId: 'vc:helix:delegated' });

      await expect(client.delegate({
        walletFilePath: walletPath,
        walletPassphrase: 'pass',
        delegateeAgentDid: 'did:hedera:testnet:delegatee',
        requestedScopes: ['read:orders'],
        expiresInSeconds: 3600,
        vcId: 'vc:helix:selected',
      })).resolves.toEqual({ vcId: 'vc:helix:delegated' });

      expect(mockHttp.post).toHaveBeenNthCalledWith(1, '/v1/vp/template', {
        agentDid: 'did:hedera:testnet:delegator',
        userDid: 'did:hedera:testnet:delegatee',
        targetService: 'helix-delegation',
        vcType: 'HelixAgentCredential',
        vcId: 'vc:helix:selected',
      });
      expect(mockHttp.post).toHaveBeenNthCalledWith(2, '/v1/vcs/delegate', {
        delegatorVP: expect.objectContaining({
          id: 'vp:helix:delegate',
          proof: expect.objectContaining({
            verificationMethod: 'did:hedera:testnet:delegator#key-1',
          }),
        }),
        delegateeAgentDid: 'did:hedera:testnet:delegatee',
        requestedScopes: ['read:orders'],
        expiresInSeconds: 3600,
      });

      mockHttp.post.mockReset();
      mockHttp.post
        .mockResolvedValueOnce({
          unsignedVP: {
            '@context': ['https://www.w3.org/ns/credentials/v2'],
            type: ['VerifiablePresentation'],
            id: 'vp:helix:delegate-minimal',
            holder: 'did:hedera:testnet:delegator',
            verifiableCredential: [{ id: 'vc:helix:selected' }],
            nonce: 'b'.repeat(64),
            expirationDate: new Date(Date.now() + 60_000).toISOString(),
            delegatedBy: 'did:hedera:testnet:delegatee',
            targetService: 'helix-delegation',
          },
          vpId: 'vp:helix:delegate-minimal',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })
        .mockResolvedValueOnce({ vcId: 'vc:helix:delegated-minimal' });

      await client.delegate({
        walletFilePath: walletPath,
        walletPassphrase: 'pass',
        delegateeAgentDid: 'did:hedera:testnet:delegatee',
        requestedScopes: ['read:orders'],
      });

      expect(mockHttp.post).toHaveBeenNthCalledWith(1, '/v1/vp/template', {
        agentDid: 'did:hedera:testnet:delegator',
        userDid: 'did:hedera:testnet:delegatee',
        targetService: 'helix-delegation',
        vcType: 'HelixAgentCredential',
      });
      expect(mockHttp.post).toHaveBeenNthCalledWith(2, '/v1/vcs/delegate', {
        delegatorVP: expect.objectContaining({ id: 'vp:helix:delegate-minimal' }),
        delegateeAgentDid: 'did:hedera:testnet:delegatee',
        requestedScopes: ['read:orders'],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
