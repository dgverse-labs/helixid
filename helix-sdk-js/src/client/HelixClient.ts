import {
  AuditEvents,
  generateKeyPair,
  getBit,
  HelixError,
  SDKOnlyModeNoAPIError,
  verifyVP as coreVerifyVP,
  verifyJWT,
  signBytes,
  signData,
  type DIDDocument,
  type HelixJWTPayload,
  type KeyPair,
  type ServiceEndpoint,
  type StatusListCredential,
  type SignedVC,
  type SignedVP,
  type VerifyVPOptions,
  type VerifyVPResult,
} from '@helixid/core';
import { HttpAdapter } from '../http/HttpAdapter.js';
import { AgentWallet } from '../wallet/AgentWallet.js';

function bootstrapProofPayload(input: {
  bootstrapToken: string;
  agentDid: string;
  timestamp: number;
}): string {
  return JSON.stringify({
    bootstrapToken: input.bootstrapToken,
    agentDid: input.agentDid,
    timestamp: input.timestamp,
  });
}

interface PendingKeyPair {
  publicKey: string;
  privateKey: string;
  didCreateSigningPayloadHex?: string | undefined;
}

interface VPVerificationAuditEntry {
  vpId: string;
  agentDid: string;
  targetService?: string;
  result: 'success' | 'rejected';
  reason?: string;
  delegationChain?: VerifyVPResult['delegationChain'];
  delegatedFrom?: string;
  delegatedTo?: string;
  parentVcId?: string;
  delegationDepth?: number;
  // Rejection path only. Read off the raw, unverified VP because verification
  // threw before any `result` existed — best-effort correlation context, never
  // a trust claim about the presented credential.
  attemptedVcId?: string;
  attemptedParentVcId?: string;
  attemptedDelegatedFrom?: string;
  verifiedAt: string;
  source: 'sdk';
}

type AttemptedVPContext = Pick<
  VPVerificationAuditEntry,
  'attemptedVcId' | 'attemptedParentVcId' | 'attemptedDelegatedFrom'
>;

/**
 * Pulls identifying fields off a raw, unverified VP so a rejection can still be
 * correlated to the credential that caused it. Nothing here is validated — the
 * VP is malformed or hostile often enough that every read is guarded, and the
 * whole thing degrades to `{}` rather than throwing out of the audit call.
 */
function readAttemptedVPContext(vp: SignedVP): AttemptedVPContext {
  const context: AttemptedVPContext = {};
  try {
    const credential = vp?.verifiableCredential?.[0] as Record<string, unknown> | undefined;
    const subject = credential?.['credentialSubject'] as Record<string, unknown> | undefined;
    const vcId = credential?.['id'];
    if (typeof vcId === 'string') context.attemptedVcId = vcId;
    const parentVcId = subject?.['parentVcId'];
    if (typeof parentVcId === 'string') context.attemptedParentVcId = parentVcId;
    const delegatedFrom = subject?.['delegatedFrom'];
    if (typeof delegatedFrom === 'string') context.attemptedDelegatedFrom = delegatedFrom;
  } catch {
    // Correlation fields are optional by design; a garbage VP just yields none.
  }
  return context;
}

/**
 * Agent-side record of a consent grant landing in the wallet (spec §2a) — the
 * agent-side analogue of `VC_ISSUED`.
 */
export interface ConsentGrantedAuditEntry {
  vcId: string;
  agentDid: string;
  issuer?: string;
  userDid?: string;
  scopes?: string[];
  durability?: string;
  grantedAt: string;
  source: 'sdk';
}

interface HttpAdapterLike {
  post<T>(path: string, body?: unknown): Promise<T>;
  get?<T>(path: string): Promise<T>;
  delete?<T>(path: string): Promise<T>;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
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

export interface ListVCFilters {
  subjectDid?: string;
  status?: 'active' | 'revoked' | 'expired';
  limit?: number;
}

export interface VCSummary {
  vcId: string;
  subjectDid: string;
  agentName?: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  issuedAt: string;
  expiresAt: string;
  parentVcId?: string;
}

export interface AuditLogFilters {
  eventType?: string;
  since?: string;
  limit?: number;
}

export interface AuditLogEvent {
  id: string;
  eventType: string;
  timestamp: string;
  subjectDid?: string;
  vcId?: string;
  targetService?: string;
  result?: string;
  delegatedFrom?: string;
  delegatedTo?: string;
  parentVcId?: string;
  delegationDepth?: number;
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

export interface CreateStatusListOptions {
  listId?: string;
  length?: number;
}

type DIDResolveResponse = {
  didDocument?: DIDDocument;
  document?: DIDDocument;
} & DIDDocument;

const SDK_ONLY_HTTP_ADAPTER: HttpAdapterLike = {
  post: async <T>(): Promise<T> => {
    throw new SDKOnlyModeNoAPIError();
  },
};

export class HelixClient {
  private http: HttpAdapterLike;
  private readonly wallet = new AgentWallet();
  private pendingKeyPair: PendingKeyPair | null = null;
  private readonly sdkOnlyMode: boolean;
  private readonly apiAuditEnabled: boolean;

  constructor(apiUrl?: string);
  constructor(baseUrl: string, options?: HelixClientOptions);
  constructor(http: HttpAdapter, baseUrl: string);
  constructor(first?: string | HttpAdapter, second?: string | HelixClientOptions) {
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
    const response = await this.http.get<DIDResolveResponse>(
      `/v1/dids/${encodeURIComponent(did)}${query}`,
    );
    const didDocument = response.didDocument ?? response.document ?? response;
    return {
      did,
      didDocument,
      source: options?.live ? 'hedera' : 'cache',
    };
  }

  async addServiceEndpoint(
    did: string,
    endpoint: ServiceEndpoint,
  ): Promise<{ did: string; didDocument: DIDDocument }> {
    const didDocument = await this.http.post<DIDDocument>(
      `/v1/dids/${encodeURIComponent(did)}/services`,
      endpoint,
    );
    return { did, didDocument };
  }

  async removeServiceEndpoint(
    did: string,
    endpointId: string,
  ): Promise<{ did: string; didDocument: DIDDocument }> {
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

  async listVCs(filters: ListVCFilters = {}): Promise<VCSummary[]> {
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    return this.http.get(
      `/v1/vcs${toQueryString({
        subjectDid: filters.subjectDid,
        status: filters.status,
        limit: filters.limit,
      })}`,
    );
  }

  async revokeVC(vcId: string): Promise<VCResponse> {
    return this.http.post(`/v1/vcs/${encodeURIComponent(vcId)}/revoke`);
  }

  async renewVC(
    vcId: string,
    overrides: { privilegeScopes?: string[]; expiresInSeconds?: number } = {},
  ): Promise<VCResponse> {
    return this.http.post(`/v1/vcs/${encodeURIComponent(vcId)}/renew`, overrides);
  }

  async getStatusList(listId: string): Promise<StatusListCredentialResponse> {
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    return this.http.get(`/v1/status-list/${encodeURIComponent(listId)}`);
  }

  async createStatusList(
    options: CreateStatusListOptions = {},
  ): Promise<StatusListCredential> {
    this.assertAPIConfigured();
    return this.http.post<StatusListCredential>('/v1/status-list', options);
  }

  async getAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogEvent[]> {
    if (!this.http.get) throw new Error('GET not implemented by adapter');
    return this.http.get(
      `/v1/audit-log${toQueryString({
        eventType: filters.eventType,
        since: filters.since,
        limit: filters.limit,
      })}`,
    );
  }

  async verifyVP(vp: SignedVP, options: VerifyVPOptions = {}): Promise<VerifyVPResult> {
    try {
      const result = await coreVerifyVP(vp, options);
      const successAudit: VPVerificationAuditEntry = {
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
      if (delegatedFrom !== undefined) successAudit.delegatedFrom = delegatedFrom;
      const delegatedTo = result.delegationChain.at(-1)?.subject;
      if (delegatedTo !== undefined) successAudit.delegatedTo = delegatedTo;
      const parentVcId = result.delegationChain.at(-2)?.vcId;
      if (parentVcId !== undefined) successAudit.parentVcId = parentVcId;
      await this.recordVPVerificationAudit(successAudit);
      return result;
    } catch (error) {
      await this.recordVPVerificationAudit({
        vpId: vp.id,
        agentDid: vp.holder,
        targetService: vp.targetService,
        result: 'rejected',
        reason: this.describeVerificationFailure(error),
        ...readAttemptedVPContext(vp),
        verifiedAt: new Date().toISOString(),
        source: 'sdk',
      });
      throw error;
    }
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

  async enroll(bootstrapToken: string, wallet: AgentWallet): Promise<SignedVC> {
    this.assertAPIConfigured();
    const timestamp = Date.now();
    const agentDid = wallet.getDID();
    const proofSignature = signData(
      bootstrapProofPayload({ bootstrapToken, agentDid, timestamp }),
      wallet.getPrivateKeyHex(),
    );

    const response = await this.http.post<EnrollResponse>('/v1/enroll', {
      bootstrapToken,
      agentDid,
      timestamp,
      proofSignature,
    });

    const vc = response.vc as SignedVC;
    await wallet.addCredential(vc);
    return vc;
  }

  async requestOnboardingChallenge(
    bootstrapToken: string,
    domains: string[] = [],
  ): Promise<{
    challengeId: string;
    nonce: string;
    expiresAt: string;
    didCreateSigningPayloadHex?: string;
  }> {
    this.assertAPIConfigured();
    const keyPair = generateKeyPair();
    this.pendingKeyPair = { publicKey: keyPair.publicKey, privateKey: keyPair.privateKey };
    const challenge = await this.http.post<{
      challengeId: string;
      nonce: string;
      expiresAt: string;
      didCreateSigningPayloadHex?: string;
    }>('/v1/onboard', {
      enrollmentToken: bootstrapToken,
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

  async requestUserChallenge(
    userDid: string,
  ): Promise<{ challengeId: string; nonce: string; expiresAt: string }> {
    return this.http.post('/v1/challenges', { did: userDid, purpose: 'user_verification' });
  }

  async verifyUserChallenge(
    challengeId: string,
    signature: string,
  ): Promise<{ did: string; verified: true; vc?: Record<string, unknown> }> {
    return this.http.post(`/v1/challenges/${challengeId}/verify`, { signature });
  }

  __setTestHttpAdapter(adapter: HttpAdapterLike): void {
    this.http = adapter;
  }

  __getPendingKeyPairForTest(): PendingKeyPair | null {
    return this.pendingKeyPair;
  }

  /**
   * Best-effort consent-grant audit. Called by {@link AgentWallet} once a grant
   * VC is safely stored; a failure here must never surface to the caller, since
   * the credential is already in the wallet either way.
   */
  async recordConsentGrantedAudit(entry: ConsentGrantedAuditEntry): Promise<void> {
    if (!this.apiAuditEnabled) {
      return;
    }

    try {
      await this.http.post('/v1/audit-log/consent-granted', {
        ...entry,
        subjectDid: entry.agentDid,
        eventType: AuditEvents.CONSENT_GRANTED,
      });
    } catch {
      // Audit writes are best-effort. The stored credential remains authoritative.
    }
  }

  private async recordVPVerificationAudit(entry: VPVerificationAuditEntry): Promise<void> {
    if (!this.apiAuditEnabled) {
      return;
    }

    try {
      await this.http.post('/v1/audit-log/vp-verification', {
        ...entry,
        subjectDid: entry.agentDid,
        eventType: entry.result === 'success' ? AuditEvents.VP_VERIFIED : AuditEvents.VP_REJECTED,
      });
    } catch {
      // Audit writes are best-effort. Verification result remains authoritative.
    }
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

  private describeVerificationFailure(error: unknown): string {
    if (error instanceof HelixError) {
      return error.code;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private assertAPIConfigured(): void {
    if (this.sdkOnlyMode) {
      throw new SDKOnlyModeNoAPIError();
    }
  }
}
