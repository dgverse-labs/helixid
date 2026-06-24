import { generateKeyPair, getBit, SDKOnlyModeNoAPIError, verifyJWT, signBytes, signData, } from '@helixid/core';
import { HttpAdapter } from '../http/HttpAdapter.js';
import { AgentWallet } from '../wallet/AgentWallet.js';
function bootstrapProofPayload(input) {
    return JSON.stringify({
        bootstrapToken: input.bootstrapToken,
        agentDid: input.agentDid,
        timestamp: input.timestamp,
    });
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
    constructor(first, second) {
        this.sdkOnlyMode = first === undefined;
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
    async signPendingDidCreatePayload(_challengeId) {
        void _challengeId;
        if (!this.pendingKeyPair?.didCreateSigningPayloadHex) {
            return undefined;
        }
        return signBytes(Buffer.from(this.pendingKeyPair.didCreateSigningPayloadHex, 'hex'), this.pendingKeyPair.privateKey);
    }
    assertAPIConfigured() {
        if (this.sdkOnlyMode) {
            throw new SDKOnlyModeNoAPIError();
        }
    }
}
//# sourceMappingURL=HelixClient.js.map