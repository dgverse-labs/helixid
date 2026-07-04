import { AuditEvents, generateKeyPair, getBit, HelixError, SDKOnlyModeNoAPIError, verifyVP as coreVerifyVP, verifyJWT, signBytes, signData, } from '@helixid/core';
import { HttpAdapter } from '../http/HttpAdapter.js';
import { AgentWallet } from '../wallet/AgentWallet.js';
function bootstrapProofPayload(input) {
    return JSON.stringify({
        bootstrapToken: input.bootstrapToken,
        agentDid: input.agentDid,
        timestamp: input.timestamp,
    });
}
function toQueryString(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined)
            search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `?${query}` : '';
}
const SDK_ONLY_HTTP_ADAPTER = {
    post: async () => {
        throw new SDKOnlyModeNoAPIError();
    },
};
export class HelixClient {
    http;
    wallet = new AgentWallet();
    pendingKeyPair = null;
    sdkOnlyMode;
    apiAuditEnabled;
    constructor(first, second) {
        this.sdkOnlyMode = first === undefined;
        this.apiAuditEnabled =
            !this.sdkOnlyMode &&
                (typeof first === 'string'
                    ? typeof second === 'object' && second !== null && Boolean(second.adminApiKey)
                    : first !== undefined &&
                        'hasAdminApiKey' in first &&
                        typeof first.hasAdminApiKey === 'function' &&
                        first.hasAdminApiKey());
        this.http =
            first === undefined
                ? SDK_ONLY_HTTP_ADAPTER
                : typeof first === 'string'
                    ? new HttpAdapter(first, typeof second === 'object' ? second : {})
                    : first;
    }
    async createDID(options) {
        const keyPair = generateKeyPair();
        const response = await this.http.post('/v1/dids', {
            publicKeyHex: keyPair.publicKey,
            subjectType: options.subjectType,
            domains: options.domains ?? [],
        });
        return {
            did: response.did ?? response.id ?? response.didDocument.id,
            didDocument: response.didDocument,
            hederaTransactionId: response.hederaTransactionId,
            keyPair,
        };
    }
    async registerService(options) {
        this.assertAPIConfigured();
        return this.http.post('/v1/services', options);
    }
    async resolveDID(did, options) {
        const query = options?.live ? '?live=true' : '';
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        const response = await this.http.get(`/v1/dids/${encodeURIComponent(did)}${query}`);
        const didDocument = response.didDocument ?? response.document ?? response;
        return {
            did,
            didDocument,
            source: options?.live ? 'hedera' : 'cache',
        };
    }
    async addServiceEndpoint(did, endpoint) {
        const didDocument = await this.http.post(`/v1/dids/${encodeURIComponent(did)}/services`, endpoint);
        return { did, didDocument };
    }
    async removeServiceEndpoint(did, endpointId) {
        if (!this.http.delete)
            throw new Error('DELETE not implemented by adapter');
        const didDocument = await this.http.delete(`/v1/dids/${encodeURIComponent(did)}/services/${encodeURIComponent(endpointId)}`);
        return { did, didDocument };
    }
    async deactivateDID(did, reason) {
        await this.http.post(`/v1/dids/${encodeURIComponent(did)}/deactivate`, { reason });
        return { did, deactivated: true };
    }
    async issueVC(options) {
        return this.http.post('/v1/vcs', {
            expiresInSeconds: 7_776_000,
            ...options,
        });
    }
    async getVC(vcId) {
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        return this.http.get(`/v1/vcs/${encodeURIComponent(vcId)}`);
    }
    async listVCs(filters = {}) {
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        return this.http.get(`/v1/vcs${toQueryString({
            subjectDid: filters.subjectDid,
            status: filters.status,
            limit: filters.limit,
        })}`);
    }
    async revokeVC(vcId) {
        return this.http.post(`/v1/vcs/${encodeURIComponent(vcId)}/revoke`);
    }
    async renewVC(vcId, overrides = {}) {
        return this.http.post(`/v1/vcs/${encodeURIComponent(vcId)}/renew`, overrides);
    }
    async getStatusList(listId) {
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        return this.http.get(`/v1/status-list/${encodeURIComponent(listId)}`);
    }
    async createStatusList(options = {}) {
        this.assertAPIConfigured();
        return this.http.post('/v1/status-list', options);
    }
    async getAuditLog(filters = {}) {
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        return this.http.get(`/v1/audit-log${toQueryString({
            eventType: filters.eventType,
            since: filters.since,
            limit: filters.limit,
        })}`);
    }
    async verifyVP(vp, options = {}) {
        try {
            const result = await coreVerifyVP(vp, options);
            const successAudit = {
                vpId: result.vpId,
                agentDid: result.agentDid,
                targetService: vp.targetService,
                result: 'success',
                delegationChain: result.delegationChain,
                delegationDepth: Math.max(result.delegationChain.length - 1, 0),
                verifiedAt: new Date().toISOString(),
                source: 'sdk',
            };
            const delegatedFrom = result.delegationChain.at(-2)?.subject;
            if (delegatedFrom !== undefined) {
                successAudit.delegatedFrom = delegatedFrom;
            }
            const delegatedTo = result.delegationChain.at(-1)?.subject;
            if (delegatedTo !== undefined) {
                successAudit.delegatedTo = delegatedTo;
            }
            const parentVcId = result.delegationChain.at(-2)?.vcId;
            if (parentVcId !== undefined) {
                successAudit.parentVcId = parentVcId;
            }
            await this.recordVPVerificationAudit(successAudit);
            return result;
        }
        catch (error) {
            await this.recordVPVerificationAudit({
                vpId: vp.id,
                agentDid: vp.holder,
                targetService: vp.targetService,
                result: 'rejected',
                reason: this.describeVerificationFailure(error),
                verifiedAt: new Date().toISOString(),
                source: 'sdk',
            });
            throw error;
        }
    }
    async checkVCStatus(vc) {
        const credential = vc;
        const validUntil = credential.validUntil ?? credential.expirationDate;
        if (validUntil && new Date(validUntil).getTime() <= Date.now()) {
            return 'expired';
        }
        if (!vc.credentialStatus) {
            throw new Error('VC has no credentialStatus');
        }
        const { statusListCredential, statusListIndex } = vc.credentialStatus;
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        const listCredential = await this.http.get(statusListCredential);
        const encodedList = listCredential.credentialSubject.encodedList;
        return getBit(encodedList, Number(statusListIndex)) === 1 ? 'revoked' : 'active';
    }
    async fetchSessionPublicKey() {
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        const response = await this.http.get('/v1/sessions/public-key');
        return response.publicKeyHex;
    }
    verifySessionToken(token, publicKeyHex) {
        return verifyJWT(token, publicKeyHex);
    }
    async enroll(bootstrapToken, wallet) {
        this.assertAPIConfigured();
        const timestamp = Date.now();
        const agentDid = wallet.getDID();
        const proofSignature = signData(bootstrapProofPayload({ bootstrapToken, agentDid, timestamp }), wallet.getPrivateKeyHex());
        const response = await this.http.post('/v1/enroll', {
            bootstrapToken,
            agentDid,
            timestamp,
            proofSignature,
        });
        const vc = response.vc;
        await wallet.addCredential(vc);
        return vc;
    }
    async requestOnboardingChallenge(bootstrapToken, domains = []) {
        this.assertAPIConfigured();
        const keyPair = generateKeyPair();
        this.pendingKeyPair = { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
        const challenge = await this.http.post('/v1/onboard', {
            enrollmentToken: bootstrapToken,
            publicKeyHex: keyPair.publicKey,
            domains,
        });
        this.pendingKeyPair.didCreateSigningPayloadHex = challenge.didCreateSigningPayloadHex;
        return challenge;
    }
    async completeOnboarding(challengeId, nonce, walletPassphrase, walletFilePath) {
        this.assertAPIConfigured();
        if (!this.pendingKeyPair)
            throw new Error('No pending onboarding keypair');
        const signature = await signBytes(Buffer.from(nonce, 'hex'), this.pendingKeyPair.privateKey);
        const didCreateSignature = await this.signPendingDidCreatePayload(challengeId);
        const result = await this.http.post('/v1/onboard/verify', { challengeId, signature, didCreateSignature });
        await this.wallet.save({
            did: result.agentDid,
            publicKeyHex: this.pendingKeyPair.publicKey,
            privateKeyHex: this.pendingKeyPair.privateKey,
            credentials: [AgentWallet.credentialFromVC(result.vcId, result.vc)],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }, walletPassphrase, walletFilePath);
        this.pendingKeyPair = null;
        return { agentDid: result.agentDid, vcId: result.vcId, walletSaved: true };
    }
    async requestUserChallenge(userDid) {
        return this.http.post('/v1/challenges', { did: userDid, purpose: 'user_verification' });
    }
    async verifyUserChallenge(challengeId, signature) {
        return this.http.post(`/v1/challenges/${challengeId}/verify`, { signature });
    }
    async listServices() {
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        const response = await this.http.get('/v1/services');
        return response.services;
    }
    async getService(serviceName) {
        if (!this.http.get)
            throw new Error('GET not implemented by adapter');
        return this.http.get(`/v1/services/${serviceName}`);
    }
    __setTestHttpAdapter(adapter) {
        this.http = adapter;
    }
    __getPendingKeyPairForTest() {
        return this.pendingKeyPair;
    }
    async recordVPVerificationAudit(entry) {
        if (!this.apiAuditEnabled) {
            return;
        }
        try {
            await this.http.post('/v1/audit-log/vp-verification', {
                ...entry,
                subjectDid: entry.agentDid,
                eventType: entry.result === 'success' ? AuditEvents.VP_VERIFIED : AuditEvents.VP_REJECTED,
            });
        }
        catch {
            // Audit writes are best-effort. Verification result remains authoritative.
        }
    }
    async signPendingDidCreatePayload(_challengeId) {
        void _challengeId;
        if (!this.pendingKeyPair?.didCreateSigningPayloadHex) {
            return undefined;
        }
        return signBytes(Buffer.from(this.pendingKeyPair.didCreateSigningPayloadHex, 'hex'), this.pendingKeyPair.privateKey);
    }
    describeVerificationFailure(error) {
        if (error instanceof HelixError) {
            return error.code;
        }
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
    assertAPIConfigured() {
        if (this.sdkOnlyMode) {
            throw new SDKOnlyModeNoAPIError();
        }
    }
}
//# sourceMappingURL=HelixClient.js.map
