import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPair } from '@helixid/sdk-js';
import { AgentWallet } from '@helixid/sdk-js';
import { HelixIDMiddleware, HelixIDToolWrapper, filterToolsByScope } from '../src/index.js';

describe('@helixid/langchain', () => {
  let keyPair: { publicKey: string; privateKey: string };
  const agentDid = 'did:hedera:testnet:agent';

  beforeEach(() => {
    keyPair = generateKeyPair();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockWallet(credentials: any[] = []) {
    return new AgentWallet({
      did: agentDid,
      privateKeyHex: keyPair.privateKey,
      credentials: credentials.map((c) => ({
        vcId: c.id,
        vcJson: JSON.stringify(c),
        type: c.type,
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

  it('injects _helixVP from handleToolStart', async () => {
    const wallet = createMockWallet([defaultVC]);
    const loadSpy = vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

    const middleware = HelixIDMiddleware({
      walletPassphrase: 'pass',
      walletFilePath: '/unused',
      targetService: 'orders',
      userDid: 'did:hedera:testnet:user',
    });

    const input: Record<string, unknown> = { query: 'book order' };
    await middleware.callbacks[0]!.handleToolStart({ name: 'orders' }, input);

    expect(input._helixVP).toEqual(expect.any(String));
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('wraps a tool and passes the VP to the original _call input', async () => {
    const wallet = createMockWallet([defaultVC]);
    const loadSpy = vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

    const originalCall = vi.fn().mockResolvedValue('done');
    const wrapped = HelixIDToolWrapper(
      { name: 'orders', _call: originalCall },
      {
        walletPassphrase: 'pass',
        walletFilePath: '/unused',
        targetService: 'orders',
        userDid: 'did:hedera:testnet:user',
      },
    );

    const input: Record<string, unknown> = { query: 'book order' };
    await expect(wrapped._call(input)).resolves.toBe('done');
    expect(originalCall).toHaveBeenCalledWith(expect.objectContaining({ _helixVP: expect.any(String) }));
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('loads wallet once, not per call across multiple invocations', async () => {
    const wallet = createMockWallet([defaultVC]);
    const loadSpy = vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

    const middleware = HelixIDMiddleware({
      walletPassphrase: 'pass',
      walletFilePath: '/unused',
      targetService: 'orders',
      userDid: 'did:hedera:testnet:user',
    });

    const input1: Record<string, unknown> = { query: 'first call' };
    const input2: Record<string, unknown> = { query: 'second call' };

    await middleware.callbacks[0]!.handleToolStart({ name: 'orders' }, input1);
    await middleware.callbacks[0]!.handleToolStart({ name: 'orders' }, input2);

    expect(input1._helixVP).toEqual(expect.any(String));
    expect(input2._helixVP).toEqual(expect.any(String));
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('throws if wallet has no credentials', async () => {
    const wallet = createMockWallet([]);
    vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

    const middleware = HelixIDMiddleware({
      walletPassphrase: 'pass',
      walletFilePath: '/unused',
      targetService: 'orders',
      userDid: 'did:hedera:testnet:user',
    });

    const input: Record<string, unknown> = { query: 'test' };
    await expect(
      middleware.callbacks[0]!.handleToolStart({ name: 'orders' }, input),
    ).rejects.toThrow('No credential in wallet. Run enrollment first.');
  });

  describe('filterToolsByScope', () => {
    const vcWithScopes = {
      id: 'vc:selected',
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: 'did:issuer',
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      credentialSubject: { id: agentDid, privilegeScopes: ['read:orders', 'write:orders'] },
      proof: { type: 'Ed25519Signature2020' },
    };

    it('includes tools without requiredScope by default', async () => {
      const wallet = createMockWallet([vcWithScopes]);
      vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

      const tools = [
        { name: 'tool1' },
        { name: 'tool2', metadata: {} },
      ];

      const filtered = await filterToolsByScope(tools, '/unused', 'pass');
      expect(filtered).toHaveLength(2);
    });

    it('excludes tools with requiredScope if scope not in VC', async () => {
      const wallet = createMockWallet([vcWithScopes]);
      vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

      const tools = [
        { name: 'tool1', metadata: { requiredScope: 'admin:all' } },
      ];

      const filtered = await filterToolsByScope(tools, '/unused', 'pass');
      expect(filtered).toHaveLength(0);
    });

    it('includes tools with matching scope in VC metadata or name', async () => {
      const wallet = createMockWallet([vcWithScopes]);
      vi.spyOn(AgentWallet, 'load').mockResolvedValue(wallet);

      const tools = [
        { name: 'tool1', metadata: { requiredScope: 'read:orders' } },
        { name: 'write:orders' },
      ];

      const filtered = await filterToolsByScope(tools, '/unused', 'pass');
      expect(filtered).toHaveLength(2);
    });
  });
});
