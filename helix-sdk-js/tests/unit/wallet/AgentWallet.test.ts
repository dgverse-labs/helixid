// Copyright 2026 DgVerse LLP
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentWallet } from '../../../src/wallet/AgentWallet.js';

const credential = AgentWallet.credentialFromVC('v', {
  id: 'v',
  type: ['VerifiableCredential', 'HelixAgentCredential'],
  issuer: 'did:issuer',
  credentialSubject: { id: 'did:agent' },
});

describe('AgentWallet Branch Coverage', () => {
  it('constructor handles no options', () => {
    const w = new AgentWallet();
    expect(w).toBeDefined();
  });

  it('constructor uses privateKeyHex if provided', () => {
    const pk = 'a'.repeat(64);
    const w = new AgentWallet({ privateKeyHex: pk });
    expect(w.getPublicKey()).toBeDefined();
  });

  it('constructor generates keyPair if client provided but no privateKey', () => {
    const mockClient = {} as any;
    const w = new AgentWallet({ client: mockClient });
    expect(w.getPublicKey()).toBeDefined();
  });

  it('throws when getting keys if not initialized', () => {
    const w = new AgentWallet();
    expect(() => w.getPublicKey()).toThrow('Wallet has no in-memory public key');
    expect(() => w.getDID()).toThrow('Wallet has no DID');
    expect(() => w.sign('data')).toThrow('Wallet has no in-memory private key');
  });

  it('throws for client operations if no client provided', async () => {
    const w = new AgentWallet({ privateKeyHex: 'a'.repeat(64) });
    await expect(w.createDID('user')).rejects.toThrow('Wallet has no HelixClient');
    await expect(w.addService({ id: 's1', type: 'T', serviceEndpoint: 'E' })).rejects.toThrow('Wallet has no HelixClient');
    await expect(w.removeService('s1')).rejects.toThrow('Wallet has no HelixClient');
    await expect(w.deactivate()).rejects.toThrow('Wallet has no HelixClient');
  });

  it('successfully sign data', () => {
    const w = new AgentWallet({ privateKeyHex: 'a'.repeat(64) });
    const sig = w.sign('hello');
    expect(sig).toBeDefined();
  });

  it('load throws for corrupted data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-wallet-'));
    const path = join(dir, 'wallet.json');
    const w = new AgentWallet();
    // Save valid wallet first
    await w.save({ did: 'd', publicKeyHex: 'p', privateKeyHex: 'pk', credentials: [credential], createdAt: 'c', updatedAt: 'u' }, 'pass', path);
    // Corrupt it by changing authTag
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.authTag = '00'.repeat(16);
    const fs = await import('node:fs/promises');
    await fs.writeFile(path, JSON.stringify(parsed));
    
    await expect(w.load('pass', path)).rejects.toThrow('Invalid passphrase or corrupted wallet');
    await rm(dir, { recursive: true, force: true });
  });

  it('gets private key and manages multiple credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helix-wallet-'));
    const path = join(dir, 'wallet.json');
    const w = new AgentWallet();
    await w.save({ did: 'd', publicKeyHex: 'p', privateKeyHex: 'pk', credentials: [credential], createdAt: 'c', updatedAt: 'u' }, 'pass', path);
    
    const pk = await w.getPrivateKey('pass', path);
    expect(pk).toBe('pk');

    await w.addCredential('v-new', JSON.stringify({
      id: 'v-new',
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: 'did:issuer',
      credentialSubject: { id: 'did:agent' },
    }), path, 'pass');
    const loaded = await w.load('pass', path);
    expect(loaded.credentials.map((item) => item.vcId)).toEqual(['v', 'v-new']);
    await expect(w.getCredential('v-new', 'pass', path)).resolves.toMatchObject({ vcId: 'v-new' });
    await expect(w.getLatestCredential({ vcType: 'HelixAgentCredential' }, 'pass', path)).resolves.toMatchObject({ vcId: 'v-new' });

    await w.updateCredential('v-new', JSON.stringify({
      id: 'v-new',
      type: ['VerifiableCredential', 'HelixDelegatedAgentCredential'],
      issuer: 'did:issuer',
      credentialSubject: { id: 'did:agent' },
    }), path, 'pass');
    await expect(w.getCredential('v-new', 'pass', path)).resolves.toMatchObject({
      vcId: 'v-new',
      type: ['VerifiableCredential', 'HelixDelegatedAgentCredential'],
    });

    await w.removeCredential('v', path, 'pass');
    await expect(w.listCredentials('pass', path)).resolves.toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });
});
