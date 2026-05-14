import { randomBytes } from 'node:crypto';
import { getPublicKey } from '@noble/ed25519';
import { getBit, signBytes, type SignedVC } from '@helix-id/core';
import { HttpAdapter } from '../http/HttpAdapter.js';
import { AgentWallet } from '../wallet/AgentWallet.js';

interface PendingKeyPair {
  publicKey: string;
  privateKey: string;
}

interface HttpAdapterLike {
  post<T>(path: string, body: unknown): Promise<T>;
  get?<T>(path: string): Promise<T>;
  delete?<T>(path: string): Promise<T>;
}

export class HelixClient {
  private http: HttpAdapterLike;
  private readonly wallet = new AgentWallet();
  private pendingKeyPair: PendingKeyPair | null = null;

  constructor(baseUrl: string) {
    this.http = new HttpAdapter(baseUrl);
  }

  async requestOnboardingChallenge(
    enrollmentToken: string,
    domains: string[] = []
  ): Promise<{ challengeId: string; nonce: string; expiresAt: string }> {
    const privateKey = randomBytes(32).toString('hex');
    const publicKey = Buffer.from(await getPublicKey(privateKey)).toString('hex');
    this.pendingKeyPair = { publicKey, privateKey };
    return this.http.post('/v1/onboard', {
      enrollmentToken,
      publicKeyHex: publicKey,
      domains
    });
  }

  async completeOnboarding(
    challengeId: string,
    nonce: string,
    walletPassphrase: string,
    walletFilePath: string
  ): Promise<{ agentDid: string; vcId: string; walletSaved: true }> {
    if (!this.pendingKeyPair) {
      throw new Error('No pending onboarding keypair');
    }

    const signature = await signBytes(Buffer.from(nonce, 'hex'), this.pendingKeyPair.privateKey);
    const result = await this.http.post<{
      agentDid: string;
      vc: Record<string, unknown>;
      vcId: string;
    }>('/v1/onboard/verify', { challengeId, signature });

    await this.wallet.save(
      {
        did: result.agentDid,
        publicKeyHex: this.pendingKeyPair.publicKey,
        privateKeyHex: this.pendingKeyPair.privateKey,
        vcId: result.vcId,
        vcJson: JSON.stringify(result.vc),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      walletPassphrase,
      walletFilePath
    );

    this.pendingKeyPair = null;
    return { agentDid: result.agentDid, vcId: result.vcId, walletSaved: true };
  }

  async requestUserChallenge(userDid: string): Promise<{ challengeId: string; nonce: string; expiresAt: string }> {
    return this.http.post('/v1/challenges', { did: userDid, purpose: 'user_verification' });
  }

  async verifyUserChallenge(
    challengeId: string,
    signature: string
  ): Promise<{ did: string; verified: true; vc?: Record<string, unknown> }> {
    return this.http.post(`/v1/challenges/${challengeId}/verify`, { signature });
  }

  async listServices(): Promise<Array<Record<string, unknown>>> {
    if (!this.http.get) {
      throw new Error('GET not implemented by adapter');
    }
    const response = await this.http.get<{ services: Array<Record<string, unknown>> }>('/v1/services');
    return response.services;
  }

  async getService(serviceName: string): Promise<Record<string, unknown>> {
    if (!this.http.get) {
      throw new Error('GET not implemented by adapter');
    }
    return this.http.get(`/v1/services/${serviceName}`);
  }

  // ─── B1: DID Lifecycle Methods ───────────────────────────────────────────────

  async createDID(options: {
    subjectType: 'agent' | 'user';
    domains?: string[];
  }): Promise<{
    did: string;
    keyPair: { publicKeyHex: string; privateKeyHex: string };
    didDocument: Record<string, unknown>;
    hederaTransactionId: string;
  }> {
    const privateKeyBytes = randomBytes(32);
    const privateKeyHex = privateKeyBytes.toString('hex');
    const publicKeyBytes = await getPublicKey(privateKeyHex);
    const publicKeyHex = Buffer.from(publicKeyBytes).toString('hex');

    const result = await this.http.post<{
      did: string;
      didDocument: Record<string, unknown>;
      hederaTransactionId: string;
    }>('/v1/dids', {
      publicKeyHex,
      subjectType: options.subjectType,
      domains: options.domains ?? [],
    });

    return {
      ...result,
      keyPair: { publicKeyHex, privateKeyHex },
    };
  }

  async resolveDID(
    did: string,
    options?: { live?: boolean }
  ): Promise<{ did: string; didDocument: Record<string, unknown>; source: 'cache' | 'hedera' }> {
    if (!this.http.get) {
      throw new Error('GET not implemented by adapter');
    }
    const query = options?.live ? '?live=true' : '';
    return this.http.get(`/v1/dids/${did}${query}`);
  }

  async addServiceEndpoint(
    did: string,
    endpoint: { id: string; type: string; serviceEndpoint: string }
  ): Promise<{ didDocument: Record<string, unknown> }> {
    return this.http.post(`/v1/dids/${did}/services`, endpoint);
  }

  async removeServiceEndpoint(
    did: string,
    endpointId: string
  ): Promise<{ didDocument: Record<string, unknown> }> {
    if (!this.http.delete) {
      throw new Error('DELETE not implemented by adapter');
    }
    // ensure endpointId is properly URL encoded if it contains #
    const encodedId = encodeURIComponent(endpointId);
    return this.http.delete(`/v1/dids/${did}/services/${encodedId}`);
  }

  async deactivateDID(did: string, reason: string): Promise<{ did: string; deactivated: true }> {
    return this.http.post(`/v1/dids/${did}/deactivate`, { reason });
  }

  // ─── B2: VC Lifecycle Methods ───────────────────────────────────────────────

  async issueVC(options: {
    subjectDid: string;
    subjectType: 'agent' | 'user';
    privilegeScopes?: string[];
    agentName?: string;
    userId?: string;
    expiresInSeconds: number;
  }): Promise<{ vcId: string; vc: Record<string, unknown>; statusListIndex: number; expiresAt: string }> {
    return this.http.post('/v1/vcs', options);
  }

  async getVC(vcId: string): Promise<{
    vcId: string;
    vc: Record<string, unknown>;
    status: 'active' | 'revoked' | 'expired';
    expiresAt: string;
    revokedAt: string | null;
    renewedByVcId: string | null;
  }> {
    if (!this.http.get) {
      throw new Error('GET not implemented by adapter');
    }
    return this.http.get(`/v1/vcs/${vcId}`);
  }

  async revokeVC(vcId: string): Promise<{ vcId: string; revoked: true; revokedAt: string }> {
    return this.http.post(`/v1/vcs/${vcId}/revoke`, {});
  }

  async renewVC(
    vcId: string,
    options: { privilegeScopes?: string[]; expiresInSeconds?: number } = {}
  ): Promise<{ vcId: string; vc: Record<string, unknown>; previousVcId: string; expiresAt: string }> {
    return this.http.post(`/v1/vcs/${vcId}/renew`, options);
  }

  async getStatusList(listId: string): Promise<Record<string, unknown>> {
    if (!this.http.get) {
      throw new Error('GET not implemented by adapter');
    }
    return this.http.get(`/v1/status-list/${listId}`);
  }

  async checkVCStatus(vc: SignedVC): Promise<'active' | 'revoked' | 'expired'> {
    if (new Date(vc.expirationDate).getTime() <= Date.now()) {
      return 'expired';
    }
    const index = Number(vc.credentialStatus.statusListIndex);
    const statusListUrl = vc.credentialStatus.statusListCredential;
    const response = await fetch(statusListUrl);
    if (!response.ok) {
      throw new Error(`Status list fetch failed: ${response.status}`);
    }
    const statusList = await response.json() as {
      credentialSubject?: { encodedList?: string };
    };
    const encodedList = statusList.credentialSubject?.encodedList;
    if (!encodedList) {
      throw new Error('Status list response did not include encodedList');
    }
    return getBit(encodedList, index) === 1 ? 'revoked' : 'active';
  }

  __setTestHttpAdapter(adapter: HttpAdapterLike): void {
    this.http = adapter;
  }

  __getPendingKeyPairForTest(): PendingKeyPair | null {
    return this.pendingKeyPair;
  }
}