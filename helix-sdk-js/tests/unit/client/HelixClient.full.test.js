// Copyright 2026 DgVerse LLP
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HelixClient } from '../../../src/client/HelixClient.js';
import { createStatusList, generateKeyPair, issueJWT, publicKeyToMultibase, selfIssueVC, VPBuilder } from '@helixid/core';
describe('HelixClient Full Unit Tests', () => {
    let mockHttp;
    let client;
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
        const vc = { validUntil: new Date(Date.now() - 1000).toISOString() };
        const status = await client.checkVCStatus(vc);
        expect(status).toBe('expired');
    });
    it('checks VC status - active/revoked', async () => {
        const vc = {
            validUntil: new Date(Date.now() + 10000).toISOString(),
            credentialStatus: { statusListCredential: 'http://list', statusListIndex: '0' }
        };
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
    it('audits successful VP verification when the client can write audit logs', async () => {
        const wallet = generateKeyPair();
        const did = `did:key:${publicKeyToMultibase(wallet.publicKey)}`;
        const vc = await selfIssueVC({ scopes: ['read:orders'] }, { did, privateKeyHex: wallet.privateKey });
        const vp = await new VPBuilder({
            credentials: [vc],
            holderDid: did,
            targetService: 'orders',
            userDid: did,
        }).sign(wallet.privateKey, `${did}#key-1`);
        const auditHttp = {
            get: vi.fn(),
            post: vi.fn().mockResolvedValue({ recorded: true }),
            delete: vi.fn(),
            hasAdminApiKey: vi.fn(() => true),
        };
        const auditClient = new HelixClient(auditHttp, 'http://api');
        const result = await auditClient.verifyVP(vp, { allowSelfSigned: true });
        expect(result).toMatchObject({
            valid: true,
            agentDid: did,
            vpId: vp.id,
        });
        expect(auditHttp.post).toHaveBeenCalledWith('/v1/audit-log/vp-verification', expect.objectContaining({
            vpId: vp.id,
            agentDid: did,
            subjectDid: did,
            targetService: 'orders',
            result: 'success',
            source: 'sdk',
            eventType: 'VP_VERIFIED',
        }));
    });
    it('audits rejected VP verification when verification fails', async () => {
        const auditHttp = {
            get: vi.fn(),
            post: vi.fn().mockResolvedValue({ recorded: true }),
            delete: vi.fn(),
            hasAdminApiKey: vi.fn(() => true),
        };
        const auditClient = new HelixClient(auditHttp, 'http://api');
        await expect(auditClient.verifyVP({ id: 'vp:test', holder: 'did:key:abc' })).rejects.toThrow();
        expect(auditHttp.post).toHaveBeenCalledWith('/v1/audit-log/vp-verification', expect.objectContaining({
            vpId: 'vp:test',
            agentDid: 'did:key:abc',
            result: 'rejected',
            source: 'sdk',
            eventType: 'VP_REJECTED',
        }));
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
        expect(mockHttp.get).toHaveBeenCalledWith('/v1/audit-log?eventType=VC_ISSUED&since=2026-07-03T00%3A00%3A00.000Z&limit=10');
    });
    it('throws SDK_ONLY_MODE_NO_API for enrollment calls without an API URL', async () => {
        const sdkOnly = new HelixClient();
        await expect(sdkOnly.requestOnboardingChallenge('token')).rejects.toMatchObject({
            code: 'SDK_ONLY_MODE_NO_API',
        });
    });
});
//# sourceMappingURL=HelixClient.full.test.js.map