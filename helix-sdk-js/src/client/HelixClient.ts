import {
  generateKeyPair,
  getBit,
  SDKOnlyModeNoAPIError,
  verifyJWT,
  signBytes,
  type DIDDocument,
  type HelixJWTPayload,
  type KeyPair,
  type ServiceEndpoint,
  type SignedVC,
} from '@helix-id/core';
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

export interface SessionPublicKeyResponse {
  publicKeyHex: string;
  publicKeyMultibase: string;
  alg: 'EdDSA';
  crv: 'Ed25519';
}

export interface HelixClientOptions {
  adminApiKey?: string;
}

type DIDResolveResponse = {
  didDocument?: DIDDocument;
  document?: DIDDocument;
} & DIDDocument;

export class HelixClient {
  private http: HttpAdapterLike;
  private readonly wallet = new AgentWallet();
  private pendingKeyPair: PendingKeyPair | null = null;
  private readonly sdkOnlyMode: boolean;

  constructor(apiUrl?: string);
  constructor(baseUrl: string, options?: HelixClientOptions);
  constructor(http: HttpAdapter, baseUrl: string);
  constructor(first?: string | HttpAdapter, second?: string | HelixClientOptions) {
    this.sdkOnlyMode = first === undefined;
    this.http = first === undefined
      ? {
          post: async () => {
            throw new SDKOnlyModeNoAPIError();
          },
        }
      : typeof first === 'string'
      ? new HttpAdapter(first, typeof second === 'object' ? second : {})
      : first;
  }

  async createDID(options: CreateDIDOptions): Promise<CreateDIDResult> {
    const keyPair = generateKeyPair();
    const response = await this.http.post<{
      id?: string;
      did?: string;
      didDocument: DIDDocument;
      hederaTransactionId: string;
    }>('/v1/dids', {
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

  async resolveDID(
    did: string,
    options?: { live?: boolean },
  ): Promise<{ did: string; didDocument: DIDDocument; source: 'cache' | 'hedera' }> {
    const query = options?.live ? '?live=true' : '';
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    const response = await this.http.get<DIDResolveResponse>(`/v1/dids/${encodeURIComponent(did)}${query}`);
    const didDocument = response.didDocument ?? response.document ?? response;
    return {
      did,
      didDocument,
      source: options?.live ? 'hedera' : 'cache',
    };
  }

  async addServiceEndpoint(did: string, endpoint: ServiceEndpoint): Promise<{ did: string; didDocument: DIDDocument }> {
    const didDocument = await this.http.post<DIDDocument>(`/v1/dids/${encodeURIComponent(did)}/services`, endpoint);
    return { did, didDocument };
  }

  async removeServiceEndpoint(did: string, endpointId: string): Promise<{ did: string; didDocument: DIDDocument }> {
    if (!this.http.delete) throw new Error('DELETE not implemented by adapter');
    const didDocument = await this.http.delete<DIDDocument>(
      `/v1/dids/${encodeURIComponent(did)}/services/${encodeURIComponent(endpointId)}`,
    );
    return { did, didDocument };
  }

  async deactivateDID(did: string, reason: string): Promise<{ did: string; deactivated: true }> {
    await this.http.post(`/v1/dids/${encodeURIComponent(did)}/deactivate`, { reason });
    return { did, deactivated: true };
  }

  async issueVC(options: IssueVCOptions): Promise<{
    vcId: string;
    vc: Record<string, unknown>;
    statusListIndex: number;
    expiresAt: string;
  }> {
    return this.http.post('/v1/vcs', {
      expiresInSeconds: 7_776_000,
      ...options,
    });
  }

  async getVC(vcId: string): Promise<VCResponse> {
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    return this.http.get(`/v1/vcs/${encodeURIComponent(vcId)}`);
  }

  async revokeVC(vcId: string): Promise<VCResponse> {
    return this.http.post(`/v1/vcs/${encodeURIComponent(vcId)}/revoke`);
  }

  async renewVC(vcId: string, overrides: { privilegeScopes?: string[]; expiresInSeconds?: number } = {}): Promise<VCResponse> {
    return this.http.post(`/v1/vcs/${encodeURIComponent(vcId)}/renew`, overrides);
  }

  async getStatusList(listId: string): Promise<StatusListCredentialResponse> {
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    return this.http.get(`/v1/status-list/${encodeURIComponent(listId)}`);
  }

  async checkVCStatus(vc: SignedVC): Promise<'active' | 'revoked' | 'expired'> {
    const credential = vc as unknown as { validUntil?: string; expirationDate?: string };
    const validUntil = credential.validUntil ?? credential.expirationDate;
    if (validUntil && new Date(validUntil).getTime() <= Date.now()) {
      return 'expired';
    }
    if (!vc.credentialStatus) {
      throw new Error('VC has no credentialStatus');
    }
    const { statusListCredential, statusListIndex } = vc.credentialStatus;
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    const listCredential = await this.http.get<StatusListCredentialResponse>(statusListCredential);
    const encodedList = listCredential.credentialSubject.encodedList;
    return getBit(encodedList, Number(statusListIndex)) === 1 ? 'revoked' : 'active';
  }

  async fetchSessionPublicKey(): Promise<string> {
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    const response = await this.http.get<SessionPublicKeyResponse>('/v1/sessions/public-key');
    return response.publicKeyHex;
  }

  verifySessionToken(token: string, publicKeyHex: string): HelixJWTPayload {
    return verifyJWT(token, publicKeyHex);
  }

  async requestOnboardingChallenge(
    enrollmentToken: string,
    domains: string[] = [],
  ): Promise<{ challengeId: string; nonce: string; expiresAt: string; didCreateSigningPayloadHex?: string }> {
    this.assertAPIConfigured();
    const keyPair = generateKeyPair();
    this.pendingKeyPair = { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
    const challenge = await this.http.post<{
      challengeId: string;
      nonce: string;
      expiresAt: string;
      didCreateSigningPayloadHex?: string;
    }>('/v1/onboard', {
      enrollmentToken,
      publicKeyHex: keyPair.publicKey,
      domains,
    });
    this.pendingKeyPair.didCreateSigningPayloadHex = challenge.didCreateSigningPayloadHex;
    return challenge;
  }

  async completeOnboarding(
    challengeId: string,
    nonce: string,
    walletPassphrase: string,
    walletFilePath: string,
  ): Promise<{ agentDid: string; vcId: string; walletSaved: true }> {
    this.assertAPIConfigured();
    if (!this.pendingKeyPair) throw new Error('No pending onboarding keypair');
    const signature = await signBytes(Buffer.from(nonce, 'hex'), this.pendingKeyPair.privateKey);
    const didCreateSignature = await this.signPendingDidCreatePayload(challengeId);
    const result = await this.http.post<{
      agentDid: string;
      vc: Record<string, unknown>;
      vcId: string;
    }>('/v1/onboard/verify', { challengeId, signature, didCreateSignature });
    await this.wallet.save(
      {
        did: result.agentDid,
        publicKeyHex: this.pendingKeyPair.publicKey,
        privateKeyHex: this.pendingKeyPair.privateKey,
        credentials: [AgentWallet.credentialFromVC(result.vcId, result.vc)],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      walletPassphrase,
      walletFilePath,
    );
    this.pendingKeyPair = null;
    return { agentDid: result.agentDid, vcId: result.vcId, walletSaved: true };
  }

  async requestUserChallenge(userDid: string): Promise<{ challengeId: string; nonce: string; expiresAt: string }> {
    return this.http.post('/v1/challenges', { did: userDid, purpose: 'user_verification' });
  }

  async verifyUserChallenge(
    challengeId: string,
    signature: string,
  ): Promise<{ did: string; verified: true; vc?: Record<string, unknown> }> {
    return this.http.post(`/v1/challenges/${challengeId}/verify`, { signature });
  }

  async listServices(): Promise<Array<Record<string, unknown>>> {
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    const response = await this.http.get<{ services: Array<Record<string, unknown>> }>('/v1/services');
    return response.services;
  }

  async getService(serviceName: string): Promise<Record<string, unknown>> {
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    return this.http.get(`/v1/services/${serviceName}`);
  }

  __setTestHttpAdapter(adapter: HttpAdapterLike): void {
    this.http = adapter;
  }

  __getPendingKeyPairForTest(): PendingKeyPair | null {
    return this.pendingKeyPair;
  }

  private async signPendingDidCreatePayload(_challengeId: string): Promise<string | undefined> {
    void _challengeId;
    if (!this.pendingKeyPair?.didCreateSigningPayloadHex) {
      return undefined;
    }
    return signBytes(
      Buffer.from(this.pendingKeyPair.didCreateSigningPayloadHex, 'hex'),
      this.pendingKeyPair.privateKey,
    );
  }

  private assertAPIConfigured(): void {
    if (this.sdkOnlyMode) {
      throw new SDKOnlyModeNoAPIError();
    }
  }
}
