// Copyright 2026 DgVerse LLP
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentWallet } from '../../../src/wallet/AgentWallet.js';
import { generateKeyPair, publicKeyToMultibase, selfIssueVC } from '@helixid/core';
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
        const mockClient = {};
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
    it('creates and loads an encrypted did:key wallet', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'helix-wallet-'));
        const path = join(dir, 'wallet.json');
        try {
            const created = await AgentWallet.create(path, 'pass');
            expect(created.getDID()).toMatch(/^did:key:z/);
            expect(created.getPublicKey()).toMatch(/^[0-9a-f]{64}$/);
            const loadedAgain = await AgentWallet.create(path, 'pass');
            expect(loadedAgain.getDID()).toBe(created.getDID());
            const loaded = await AgentWallet.load(path, 'pass');
            expect(loaded.getDID()).toBe(created.getDID());
            expect(loaded.credentials).toEqual([]);
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    it('generates keypairs locally without creating a DID', () => {
        const keypair = AgentWallet.generateKeypair();
        expect(keypair.publicKey).toMatch(/^[0-9a-f]{64}$/);
        expect(keypair.privateKey).toMatch(/^[0-9a-f]{64}$/);
    });
    it('builds an in-memory wallet from a keypair and credential', async () => {
        const keypair = generateKeyPair();
        const did = `did:key:${publicKeyToMultibase(keypair.publicKey)}`;
        const vc = await selfIssueVC({ scopes: ['read:orders'] }, { did, privateKeyHex: keypair.privateKey });
        const wallet = AgentWallet.fromKeypairAndCredential(keypair, vc);
        expect(wallet.getDID()).toBe(did);
        expect(wallet.credentials).toHaveLength(1);
        expect(wallet.credentials[0]?.id).toBe(vc.id);
    });
    it('self-issues and persists credentials for the loaded wallet', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'helix-wallet-'));
        const path = join(dir, 'wallet.json');
        try {
            const wallet = await AgentWallet.create(path, 'pass');
            const vc = await wallet.selfIssueVC({
                scopes: ['read:orders', 'write:orders'],
                maxDelegationDepth: 1,
            });
            expect(vc.credentialSubject.id).toBe(wallet.getDID());
            expect(wallet.credentials).toHaveLength(1);
            await expect(wallet.addCredential(vc)).rejects.toMatchObject({
                code: 'CREDENTIAL_ALREADY_IN_WALLET',
            });
            const reloaded = await AgentWallet.load(path, 'pass');
            expect(reloaded.credentials[0]?.id).toBe(vc.id);
            const wrongAgentVC = {
                ...vc,
                id: 'vc:helix:wrong-agent',
                credentialSubject: {
                    ...vc.credentialSubject,
                    id: 'did:key:zWrongAgent',
                },
            };
            await expect(reloaded.addCredential(wrongAgentVC)).rejects.toMatchObject({
                code: 'CREDENTIAL_NOT_FOR_THIS_AGENT',
            });
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
    describe('selectGrant', () => {
        const agentDid = 'did:key:zAgent';
        const spDid = 'did:web:airline.example';
        const userDid = 'did:web:user.example';
        function grantCredential(vcId, issuer, grantUserDid, addedAt) {
            const item = AgentWallet.credentialFromVC(vcId, {
                id: vcId,
                type: ['VerifiableCredential', 'DelegationGrantCredential'],
                issuer,
                credentialSubject: {
                    id: agentDid,
                    type: 'DelegationGrant',
                    userDid: grantUserDid,
                    scopes: ['book:flights'],
                    durability: 'standing',
                },
            });
            return { ...item, addedAt };
        }
        const agentVC = AgentWallet.credentialFromVC('vc:agent', {
            id: 'vc:agent',
            type: ['VerifiableCredential', 'HelixAgentCredential'],
            issuer: spDid,
            credentialSubject: { id: agentDid, type: 'HelixAgent', privilegeScopes: ['read:orders'] },
        });
        it('returns the correct grant among mixed credential types and ignores other SPs/users', () => {
            const wallet = new AgentWallet({
                did: agentDid,
                credentials: [
                    agentVC,
                    grantCredential('vc:grant:other-sp', 'did:web:hotel.example', userDid, '2026-07-01T00:00:00.000Z'),
                    grantCredential('vc:grant:other-user', spDid, 'did:web:someone-else.example', '2026-07-02T00:00:00.000Z'),
                    grantCredential('vc:grant:match', spDid, userDid, '2026-06-01T00:00:00.000Z'),
                ],
            });
            expect(wallet.selectGrant(spDid, userDid)?.vcId).toBe('vc:grant:match');
            expect(wallet.selectGrant('did:web:hotel.example', userDid)?.vcId).toBe('vc:grant:other-sp');
            expect(wallet.selectGrant(spDid, 'did:web:unknown.example')).toBeUndefined();
        });
        it('returns the most recent grant when several match', () => {
            const wallet = new AgentWallet({
                did: agentDid,
                credentials: [
                    grantCredential('vc:grant:old', spDid, userDid, '2026-05-01T00:00:00.000Z'),
                    grantCredential('vc:grant:new', spDid, userDid, '2026-07-01T00:00:00.000Z'),
                    grantCredential('vc:grant:middle', spDid, userDid, '2026-06-01T00:00:00.000Z'),
                ],
            });
            expect(wallet.selectGrant(spDid, userDid)?.vcId).toBe('vc:grant:new');
        });
        it('returns undefined for an empty wallet or a wallet with only agent VCs', () => {
            expect(new AgentWallet({ did: agentDid }).selectGrant(spDid, userDid)).toBeUndefined();
            expect(new AgentWallet({ did: agentDid, credentials: [agentVC] }).selectGrant(spDid, userDid)).toBeUndefined();
        });
    });
});
//# sourceMappingURL=AgentWallet.test.js.map