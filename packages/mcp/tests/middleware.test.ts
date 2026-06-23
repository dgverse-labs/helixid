import { describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@helix-id/core';
import { AgentWallet, verifyVP as verifyVPExport } from '@helix-id/sdk-js';
import { attachHelixVP } from '../src/attach.js';
import { helixidMCPMiddleware } from '../src/middleware.js';

vi.mock('@helix-id/sdk-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@helix-id/sdk-js')>();
  return {
    ...actual,
    verifyVP: vi.fn(actual.verifyVP),
  };
});

const verifyVP = vi.mocked(verifyVPExport);

describe('helixidMCPMiddleware', () => {
  it('throws VP_MISSING when no _helixVP in input', async () => {
    const middleware = helixidMCPMiddleware({});

    await expect(middleware({ name: 'orders.lookup', input: {} })).rejects.toMatchObject({
      code: 'VP_MISSING',
    });
  });

  it('passes through a valid VP', async () => {
    verifyVP.mockResolvedValueOnce({
      valid: true,
      agentDid: 'did:agent',
      privilegeScopes: ['read:orders'],
      vpId: 'vp:helix:test',
      delegationChain: [],
    });

    const middleware = helixidMCPMiddleware({ requiredScopes: ['read:orders'] });
    const toolCall = {
      name: 'orders.lookup',
      input: { orderId: 'ORD-1', _helixVP: { id: 'vp:helix:test' } },
    };

    await expect(middleware(toolCall)).resolves.toBe(toolCall);
    expect(verifyVP).toHaveBeenCalledWith(
      toolCall.input._helixVP,
      expect.objectContaining({ allowSelfSigned: false }),
    );
  });

  it('throws VP_VERIFICATION_FAILED on invalid VP', async () => {
    verifyVP.mockResolvedValueOnce({
      valid: false,
      agentDid: '',
      privilegeScopes: [],
      vpId: '',
      delegationChain: [],
      error: 'bad signature',
    });

    const middleware = helixidMCPMiddleware({});

    await expect(
      middleware({ input: { _helixVP: { id: 'vp:helix:bad' } } }),
    ).rejects.toMatchObject({
      code: 'VP_VERIFICATION_FAILED',
    });
  });

  it('throws INSUFFICIENT_SCOPE when scope is missing', async () => {
    verifyVP.mockResolvedValueOnce({
      valid: true,
      agentDid: 'did:agent',
      privilegeScopes: ['read:orders'],
      vpId: 'vp:helix:test',
      delegationChain: [],
    });

    const middleware = helixidMCPMiddleware({ requiredScopes: ['write:orders'] });

    await expect(
      middleware({ input: { _helixVP: { id: 'vp:helix:test' } } }),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_SCOPE',
    });
  });
});

describe('attachHelixVP', () => {
  const agentDid = 'did:hedera:testnet:agent';

  function createMockWallet(credentials: Record<string, unknown>[] = []) {
    const keyPair = generateKeyPair();
    return new AgentWallet({
      did: agentDid,
      privateKeyHex: keyPair.privateKey,
      credentials: credentials.map((c) => ({
        vcId: String(c.id),
        vcJson: JSON.stringify(c),
        type: Array.isArray(c.type) ? c.type : [],
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    });
  }

  const defaultVC = {
    id: 'vc:selected',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: 'did:issuer',
    validUntil: new Date(Date.now() + 60_000).toISOString(),
    credentialSubject: { id: agentDid, privilegeScopes: ['read:orders'] },
    proof: { type: 'Ed25519Signature2020' },
  };

  it('injects _helixVP into tool call input', async () => {
    const wallet = createMockWallet([defaultVC]);
    vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

    const result = await attachHelixVP(
      { name: 'orders.lookup', input: { orderId: 'ORD-1' } },
      {
        walletPassphrase: 'pass',
        walletFilePath: '/unused',
        targetService: 'orders',
        userDid: 'did:hedera:testnet:user',
      },
    );

    expect(result.input?._helixVP).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(result.input?.orderId).toBe('ORD-1');
  });

  it('throws when wallet has no credentials', async () => {
    const wallet = createMockWallet([]);
    vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

    await expect(
      attachHelixVP(
        { name: 'orders.lookup' },
        {
          walletPassphrase: 'pass',
          walletFilePath: '/unused',
          targetService: 'orders',
        },
      ),
    ).rejects.toMatchObject({ code: 'NO_CREDENTIAL_IN_WALLET' });
  });
});

describe('package constraints', () => {
  it('does not import HelixClient', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8'),
    );
    const attachSource = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/attach.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toContain('HelixClient');
    expect(attachSource).not.toContain('HelixClient');
  });

  it('does not reference localhost API URLs', async () => {
    const files = ['../src/middleware.ts', '../src/attach.ts', '../src/types.ts', '../src/index.ts'];
    const contents = await Promise.all(
      files.map((file) =>
        import('node:fs/promises').then((fs) => fs.readFile(new URL(file, import.meta.url), 'utf8')),
      ),
    );
    for (const content of contents) {
      expect(content).not.toContain('localhost:3000');
    }
  });
});
