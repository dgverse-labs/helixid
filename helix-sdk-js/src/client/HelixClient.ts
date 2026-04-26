import { randomBytes } from 'node:crypto';
import { getPublicKey } from '@noble/ed25519';
import { hashCanonicalPayload, signBytes } from '@helix-id/core';
import { HttpAdapter } from '../http/HttpAdapter.js';
import { AgentWallet } from '../wallet/AgentWallet.js';

interface PendingKeyPair {
  publicKey: string;
  privateKey: string;
}

interface HttpAdapterLike {
  post<T>(path: string, body: unknown): Promise<T>;
  get?<T>(path: string): Promise<T>;
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

    const signature = await signBytes(hashCanonicalPayload({ nonce }), this.pendingKeyPair.privateKey);
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

  __setTestHttpAdapter(adapter: HttpAdapterLike): void {
    this.http = adapter;
  }

  __getPendingKeyPairForTest(): PendingKeyPair | null {
    return this.pendingKeyPair;
  }
}
