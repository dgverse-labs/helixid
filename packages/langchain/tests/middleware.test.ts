import { describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@helix-id/core';
import { HelixIDMiddleware, HelixIDToolWrapper } from '../src/index.js';

function options() {
  const keyPair = generateKeyPair();
  const did = 'did:hedera:testnet:agent';
  return {
    keyPair,
    did,
    value: {
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
  };
}

describe('@helix-id/langchain', () => {
  it('injects _helixVP from handleToolStart', async () => {
    const setup = options();
    const middleware = HelixIDMiddleware(setup.value);
    const input: Record<string, unknown> = { query: 'book order' };

    await middleware.callbacks[0]!.handleToolStart({ name: 'orders' }, input);

    expect(input._helixVP).toEqual(expect.any(String));
    expect(String(input._helixVP)).not.toContain(setup.keyPair.privateKey);
  });

  it('wraps a tool and passes the VP to the original _call input', async () => {
    const setup = options();
    const originalCall = vi.fn().mockResolvedValue('done');
    const wrapped = HelixIDToolWrapper({ name: 'orders', _call: originalCall }, setup.value);
    const input: Record<string, unknown> = { query: 'book order' };

    await expect(wrapped._call(input)).resolves.toBe('done');
    expect(originalCall).toHaveBeenCalledWith(expect.objectContaining({ _helixVP: expect.any(String) }));
  });

  it('propagates wallet load failures before calling the tool', async () => {
    const setup = options();
    setup.value.walletLoader.load.mockRejectedValue(new Error('Invalid passphrase or corrupted wallet'));
    const originalCall = vi.fn();
    const wrapped = HelixIDToolWrapper({ name: 'orders', _call: originalCall }, setup.value);

    await expect(wrapped._call({})).rejects.toThrow('Invalid passphrase or corrupted wallet');
    expect(originalCall).not.toHaveBeenCalled();
  });

  it('requires callers to provide the credential id when multiple active credentials match', async () => {
    const setup = options();
    const middleware = HelixIDMiddleware({
      ...setup.value,
      walletLoader: {
        load: vi.fn().mockResolvedValue({
          did: setup.did,
          publicKeyHex: setup.keyPair.publicKey,
          privateKeyHex: setup.keyPair.privateKey,
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
    });

    await expect(middleware.callbacks[0]!.handleToolStart({ name: 'orders' }, {})).rejects.toThrow('requires vcId');
  });
});
