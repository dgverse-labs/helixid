import { describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@helix-id/core';
import { attachHelixVP, encodeBase64UrlJson, helixidMCPMiddleware } from '../src/index.js';

describe('@helix-id/mcp', () => {
  it('verifies a VP authorization header and attaches context', async () => {
    const verifyVP = vi.fn().mockResolvedValue({
      valid: true,
      agentDid: 'did:agent',
      privilegeScopes: ['read:orders'],
      vpId: 'vp:helix:test',
      delegationChain: [],
    });
    const middleware = helixidMCPMiddleware({
      helixClient: { verifySessionToken: vi.fn() },
      verifyVP,
      requiredScopes: ['read:orders'],
    });
    const next = vi.fn().mockReturnValue('ok');
    const result = await middleware(
      { headers: { Authorization: `HelixVP ${encodeBase64UrlJson({ id: 'vp:helix:test' })}` } },
      next,
    );

    expect(result).toBe('ok');
    expect(verifyVP).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0].context.helix).toMatchObject({ agentDid: 'did:agent' });
  });

  it('returns an MCP error when authorization is missing', async () => {
    const middleware = helixidMCPMiddleware({
      helixClient: { verifySessionToken: vi.fn() },
    });

    await expect(middleware({})).resolves.toMatchObject({
      ok: false,
      error: { code: -32001 },
    });
  });

  it('returns an MCP error when required scopes are missing', async () => {
    const middleware = helixidMCPMiddleware({
      helixClient: {
        verifySessionToken: vi.fn(),
      },
      verifyVP: vi.fn().mockResolvedValue({
        valid: true,
        agentDid: 'did:agent',
        privilegeScopes: ['read:orders'],
        vpId: 'vp:helix:test',
        delegationChain: [],
      }),
      requiredScopes: ['write:orders'],
    });

    await expect(
      middleware({ headers: { Authorization: `HelixVP ${encodeBase64UrlJson({ id: 'vp:helix:test' })}` } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: -32003 },
    });
  });

  it('accepts a session JWT when enabled', async () => {
    const verifySessionToken = vi.fn().mockReturnValue({
      iss: 'helix',
      sub: 'did:agent',
      iat: 1,
      exp: 2,
      jti: 'jwt:test',
      userDid: 'did:user',
      targetService: 'orders',
      scopes: ['read:orders'],
      vpId: 'vp:helix:test',
    });
    const middleware = helixidMCPMiddleware({
      helixClient: { verifySessionToken },
      allowSession: true,
      sessionPublicKeyHex: 'public-key',
      requiredScopes: ['read:orders'],
    });
    const next = vi.fn().mockReturnValue('ok');

    await expect(middleware({ headers: { authorization: 'HelixSession jwt-value' } }, next)).resolves.toBe('ok');
    expect(verifySessionToken).toHaveBeenCalledWith('jwt-value', 'public-key');
    expect(next.mock.calls[0]?.[0].context.helix).toMatchObject({ agentDid: 'did:agent' });
  });

  it('attaches a locally signed VP to an outbound tool call', async () => {
    const keyPair = generateKeyPair();
    const did = 'did:hedera:testnet:agent';

    const result = await attachHelixVP(
      { name: 'orders.lookup', headers: { Existing: 'true' } },
      {
        walletPassphrase: 'pass',
        walletFilePath: '/unused',
        targetService: 'orders',
        userDid: 'did:hedera:testnet:user',
        walletLoader: {
          load: vi.fn().mockResolvedValue({
            did,
            publicKeyHex: keyPair.publicKey,
            privateKeyHex: keyPair.privateKey,
            credentials: [{
              vcId: 'vc:selected',
              vcJson: JSON.stringify({
                id: 'vc:selected',
                type: ['VerifiableCredential', 'HelixAgentCredential'],
                issuer: 'did:issuer',
                validUntil: new Date(Date.now() + 60_000).toISOString(),
                credentialSubject: { id: did, privilegeScopes: ['read:orders'] },
                proof: { type: 'Ed25519Signature2020' },
              }),
              type: ['VerifiableCredential', 'HelixAgentCredential'],
              addedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        },
      },
    );

    expect(result.headers?.Authorization).toMatch(/^HelixVP /);
    expect(result.headers?.Existing).toBe('true');
    expect(result.headers?.Authorization).not.toContain(keyPair.privateKey);
  });

  it('requires callers to provide the credential id when multiple active credentials match', async () => {
    const keyPair = generateKeyPair();
    const did = 'did:hedera:testnet:agent';

    await expect(
      attachHelixVP(
        { name: 'orders.lookup' },
        {
          walletPassphrase: 'pass',
          walletFilePath: '/unused',
          targetService: 'orders',
          userDid: 'did:hedera:testnet:user',
          walletLoader: {
            load: vi.fn().mockResolvedValue({
              did,
              publicKeyHex: keyPair.publicKey,
              privateKeyHex: keyPair.privateKey,
              credentials: [
                {
                  vcId: 'vc:one',
                  vcJson: JSON.stringify({ validUntil: new Date(Date.now() + 60_000).toISOString() }),
                  type: ['VerifiableCredential', 'HelixAgentCredential'],
                  addedAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                },
                {
                  vcId: 'vc:two',
                  vcJson: JSON.stringify({ validUntil: new Date(Date.now() + 60_000).toISOString() }),
                  type: ['VerifiableCredential', 'HelixAgentCredential'],
                  addedAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                },
              ],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          },
        },
      ),
    ).rejects.toThrow('requires vcId');
  });
});
