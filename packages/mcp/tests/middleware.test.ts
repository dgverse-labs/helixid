import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, type UnsignedVP } from '@helix-id/core';
import { attachHelixVP, encodeBase64UrlJson, helixidMCPMiddleware } from '../src/index.js';

function unsignedVP(privateKeyDid: string): UnsignedVP {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiablePresentation'],
    id: `vp:helix:${randomUUID()}`,
    holder: privateKeyDid,
    verifiableCredential: [{ id: 'vc:test', type: ['VerifiableCredential'] }],
    nonce: 'a'.repeat(64),
    expirationDate: new Date(Date.now() + 60_000).toISOString(),
    delegatedBy: 'did:hedera:testnet:user',
    targetService: 'orders',
  };
}

describe('@helix-id/mcp', () => {
  it('verifies a VP authorization header and attaches context', async () => {
    const verifyVP = vi.fn().mockResolvedValue({
      valid: true,
      agentDid: 'did:agent',
      userDid: 'did:user',
      targetService: 'orders',
      verifiedAt: new Date().toISOString(),
      scopes: ['read:orders'],
    });
    const middleware = helixidMCPMiddleware({
      helixClient: { verifyVP, verifySessionToken: vi.fn() },
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
      helixClient: { verifyVP: vi.fn(), verifySessionToken: vi.fn() },
    });

    await expect(middleware({})).resolves.toMatchObject({
      ok: false,
      error: { code: -32001 },
    });
  });

  it('returns an MCP error when required scopes are missing', async () => {
    const middleware = helixidMCPMiddleware({
      helixClient: {
        verifyVP: vi.fn().mockResolvedValue({
          valid: true,
          agentDid: 'did:agent',
          userDid: 'did:user',
          targetService: 'orders',
          verifiedAt: new Date().toISOString(),
          scopes: ['read:orders'],
        }),
        verifySessionToken: vi.fn(),
      },
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
      helixClient: { verifyVP: vi.fn(), verifySessionToken },
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
    const verifyVP = vi.fn();
    const createVPTemplate = vi.fn().mockResolvedValue({ unsignedVP: unsignedVP(did) });

    const result = await attachHelixVP(
      { name: 'orders.lookup', headers: { Existing: 'true' } },
      {
        helixClient: { createVPTemplate, verifyVP } as never,
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
              vcId: 'vc:test',
              vcJson: '{}',
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
    expect(createVPTemplate).toHaveBeenCalledWith({
      agentDid: did,
      userDid: 'did:hedera:testnet:user',
      targetService: 'orders',
    });
    expect(verifyVP).not.toHaveBeenCalled();
    expect(result.headers?.Authorization).not.toContain(keyPair.privateKey);
  });
});
