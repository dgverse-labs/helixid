import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentWallet } from '../../../src/wallet/AgentWallet.js';

const wallet = new AgentWallet();

describe('AgentWallet', () => {
  it('saves encrypted wallet without plaintext private key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-wallet-'));
    const path = join(dir, 'wallet.json');
    const privateKeyHex = 'a'.repeat(64);
    await wallet.save(
      {
        did: 'did:hedera:testnet:agent1',
        publicKeyHex: 'b'.repeat(64),
        privateKeyHex,
        vcId: 'vc:1',
        vcJson: '{}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      'password',
      path
    );
    const raw = await readFile(path, 'utf8');
    expect(raw.includes(privateKeyHex)).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('loads saved wallet with correct passphrase', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-wallet-'));
    const path = join(dir, 'wallet.json');
    await wallet.save(
      {
        did: 'did:hedera:testnet:agent1',
        publicKeyHex: 'b'.repeat(64),
        privateKeyHex: 'a'.repeat(64),
        vcId: 'vc:1',
        vcJson: '{}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      'password',
      path
    );
    const loaded = await wallet.load('password', path);
    expect(loaded.privateKeyHex).toBe('a'.repeat(64));
    await rm(dir, { recursive: true, force: true });
  });

  it('throws for wrong passphrase', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-wallet-'));
    const path = join(dir, 'wallet.json');
    await wallet.save(
      {
        did: 'did:hedera:testnet:agent1',
        publicKeyHex: 'b'.repeat(64),
        privateKeyHex: 'a'.repeat(64),
        vcId: 'vc:1',
        vcJson: '{}',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      'password',
      path
    );
    await expect(wallet.load('wrong-password', path)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});
