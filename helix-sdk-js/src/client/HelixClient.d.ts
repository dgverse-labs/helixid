import { type DIDDocument, type HelixJWTPayload, type KeyPair, type ServiceEndpoint, type SignedVC } from '@helixid/core';
import { HttpAdapter } from '../http/HttpAdapter.js';
import { AgentWallet } from '../wallet/AgentWallet.js';
interface PendingKeyPair {
    publicKey: string;
    privateKey: string;
    didCreateSigningPayloadHex?: string | undefined;
}
interface HttpAdapterLike {
    post<T>(path: string, body?: unknown): Promise<T>;
    get?<T>(path: string): Promise<T>;
    delete?<T>(path: string): Promise<T>;
}
export interface CreateDIDOptions {
    subjectType: 'agent' | 'user';
    domains?: string[];
}
export interface CreateDIDResult {
    did: string;
    keyPair: KeyPair;
    didDocument: DIDDocument;
    hederaTransactionId: string;
}
export interface IssueVCOptions {
    subjectDid: string;
    subjectType: 'agent' | 'user';
    privilegeScopes?: string[];
    agentName?: string;
    userId?: string;
    expiresInSeconds?: number;
}
export interface VCResponse {
    vcId: string;
    vc?: Record<string, unknown>;
    status?: string;
    statusListIndex?: number;
    expiresAt?: string;
    [key: string]: unknown;
}
export interface StatusListCredentialResponse {
    credentialSubject: {
        encodedList: string;
    };
    [key: string]: unknown;
}
export interface EnrollResponse {
    agentDid?: string;
    vc: SignedVC | Record<string, unknown>;
    vcId?: string;
}
export interface SessionPublicKeyResponse {
    publicKeyHex: string;
    publicKeyMultibase: string;
    alg: 'EdDSA';
    crv: 'Ed25519';
}
export interface HelixClientOptions {
    adminApiKey?: string;
}
export declare class HelixClient {
    private http;
    private readonly wallet;
    private pendingKeyPair;
    private readonly sdkOnlyMode;
    constructor(apiUrl?: string);
    constructor(baseUrl: string, options?: HelixClientOptions);
    constructor(http: HttpAdapter, baseUrl: string);
    createDID(options: CreateDIDOptions): Promise<CreateDIDResult>;
    resolveDID(did: string, options?: {
        live?: boolean;
    }): Promise<{
        did: string;
        didDocument: DIDDocument;
        source: 'cache' | 'hedera';
    }>;
    addServiceEndpoint(did: string, endpoint: ServiceEndpoint): Promise<{
        did: string;
        didDocument: DIDDocument;
    }>;
    removeServiceEndpoint(did: string, endpointId: string): Promise<{
        did: string;
        didDocument: DIDDocument;
    }>;
    deactivateDID(did: string, reason: string): Promise<{
        did: string;
        deactivated: true;
    }>;
    issueVC(options: IssueVCOptions): Promise<{
        vcId: string;
        vc: Record<string, unknown>;
        statusListIndex: number;
        expiresAt: string;
    }>;
    getVC(vcId: string): Promise<VCResponse>;
    revokeVC(vcId: string): Promise<VCResponse>;
    renewVC(vcId: string, overrides?: {
        privilegeScopes?: string[];
        expiresInSeconds?: number;
    }): Promise<VCResponse>;
    getStatusList(listId: string): Promise<StatusListCredentialResponse>;
    checkVCStatus(vc: SignedVC): Promise<'active' | 'revoked' | 'expired'>;
    fetchSessionPublicKey(): Promise<string>;
    verifySessionToken(token: string, publicKeyHex: string): HelixJWTPayload;
    enroll(bootstrapToken: string, wallet: AgentWallet): Promise<SignedVC>;
    requestOnboardingChallenge(bootstrapToken: string, domains?: string[]): Promise<{
        challengeId: string;
        nonce: string;
        expiresAt: string;
        didCreateSigningPayloadHex?: string;
    }>;
    completeOnboarding(challengeId: string, nonce: string, walletPassphrase: string, walletFilePath: string): Promise<{
        agentDid: string;
        vcId: string;
        walletSaved: true;
    }>;
    requestUserChallenge(userDid: string): Promise<{
        challengeId: string;
        nonce: string;
        expiresAt: string;
    }>;
    verifyUserChallenge(challengeId: string, signature: string): Promise<{
        did: string;
        verified: true;
        vc?: Record<string, unknown>;
    }>;
    listServices(): Promise<Array<Record<string, unknown>>>;
    getService(serviceName: string): Promise<Record<string, unknown>>;
    __setTestHttpAdapter(adapter: HttpAdapterLike): void;
    __getPendingKeyPairForTest(): PendingKeyPair | null;
    private signPendingDidCreatePayload;
    private assertAPIConfigured;
}
export {};
//# sourceMappingURL=HelixClient.d.ts.map