import { createHash, randomBytes } from 'node:crypto';
import {
  AgentAlreadyOnboardedError,
  AuditEvents,
  ChallengeAlreadyVerifiedError,
  ChallengeExpiredError,
  ChallengeNotFoundError,
  ChallengeSignatureInvalidError,
  ErrorCode,
  EnrollmentTokenAlreadyUsedError,
  EnrollmentTokenExpiredError,
  EnrollmentTokenNotFoundError,
  ServiceAlreadyExistsError,
  ServiceNotFoundError,
  base58btcDecode,
  resolveDID,
  verifySignature,
  type HelixError,
  type IAuditLogger,
  type SignedVC,
} from '@helix-id/core';
import type { AgentRepository } from '../../repositories/agent.repository.js';
import type { IDIDService } from '../did/IDIDService.js';
import type { IVCService } from '../vc/IVCService.js';
import type {
  IAgentService,
  ChallengeResult,
  ServiceEntry,
  EnrollResult,
} from './IAgentService.js';

type DIDVerificationMethodLike = {
  type?: unknown;
  publicKeyHex?: unknown;
  publicKeyMultibase?: unknown;
};

type DIDDocumentLike = {
  verificationMethod?: DIDVerificationMethodLike[];
};

type DIDResolveLike = DIDDocumentLike & {
  document?: DIDDocumentLike;
  didDocument?: DIDDocumentLike;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function ensureHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function ensureServiceName(name: string): boolean {
  return /^[a-z][a-z0-9-]+$/.test(name);
}

function extractPublicKeyHex(doc: Awaited<ReturnType<IDIDService['resolveDID']>>): string {
  const wrapped = doc as DIDResolveLike;
  const document = wrapped.document ?? wrapped.didDocument ?? wrapped;
  const method = document.verificationMethod?.find(
    (item) => typeof item.type === 'string' && item.type.includes('Ed25519'),
  );
  if (!method) {
    throw new ChallengeSignatureInvalidError();
  }
  if (typeof method.publicKeyHex === 'string') {
    return method.publicKeyHex;
  }
  if (typeof method.publicKeyMultibase === 'string' && method.publicKeyMultibase.startsWith('z')) {
    const decoded = base58btcDecode(method.publicKeyMultibase.slice(1));
    return Buffer.from(decoded.slice(2)).toString('hex');
  }
  throw new ChallengeSignatureInvalidError();
}

function extractPublicKeyHexFromDidDocument(doc: DIDDocumentLike): string {
  const method = doc.verificationMethod?.find(
    (item) => typeof item.type === 'string' && item.type.includes('Ed25519'),
  );
  if (!method) {
    throw new ChallengeSignatureInvalidError(
      'Agent DID document has no Ed25519 verification method',
    );
  }
  if (typeof method.publicKeyHex === 'string') {
    return method.publicKeyHex;
  }
  if (typeof method.publicKeyMultibase === 'string' && method.publicKeyMultibase.startsWith('z')) {
    const decoded = base58btcDecode(method.publicKeyMultibase.slice(1));
    return Buffer.from(decoded.slice(2)).toString('hex');
  }
  throw new ChallengeSignatureInvalidError('Agent DID document has unsupported key encoding');
}

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

export class AgentService implements IAgentService {
  constructor(
    private readonly repository: AgentRepository,
    private readonly didService: IDIDService,
    private readonly vcService: IVCService,
    private readonly auditLogger: IAuditLogger,
    private readonly enrollmentTokenTtlSeconds = 900,
    private readonly challengeTtlSeconds = 300,
  ) {}

  async generateEnrollmentToken(
    input: {
      agentName: string;
      requestedScopes: string[];
      requestedDomains?: string[];
      maxDelegationDepth?: number;
    },
    requestId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const token = `enroll:${randomBytes(12).toString('hex')}`;
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + this.enrollmentTokenTtlSeconds * 1000);
    await this.repository.createEnrollmentToken({
      tokenHash,
      agentName: input.agentName,
      requestedScopes: JSON.stringify(input.requestedScopes),
      requestedDomains: JSON.stringify(input.requestedDomains ?? []),
      maxDelegationDepth: input.maxDelegationDepth ?? 0,
      expiresAt,
    });
    this.auditLogger.log(AuditEvents.ENROLLMENT_TOKEN_GENERATED, {
      requestId,
      tokenIdHash: tokenHash,
      agentName: input.agentName,
      requestedScopes: input.requestedScopes,
      expiresAt: expiresAt.toISOString(),
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async enroll(
    input: {
      bootstrapToken: string;
      agentDid: string;
      timestamp: number;
      proofSignature: string;
    },
    requestId: string,
  ): Promise<EnrollResult> {
    const ageMs = Math.abs(Date.now() - input.timestamp);
    if (!Number.isFinite(input.timestamp) || ageMs > 10 * 60 * 1000) {
      throw new ChallengeSignatureInvalidError('Bootstrap proof timestamp is invalid or too old');
    }
    if (!/^[0-9a-f]{128}$/i.test(input.proofSignature)) {
      throw new ChallengeSignatureInvalidError('Bootstrap proof signature is invalid');
    }

    const didDocument = await resolveDID(input.agentDid);
    const publicKeyHex = extractPublicKeyHexFromDidDocument(
      didDocument as unknown as DIDDocumentLike,
    );
    const proofValid = await verifySignature(
      Buffer.from(
        bootstrapProofPayload({
          bootstrapToken: input.bootstrapToken,
          agentDid: input.agentDid,
          timestamp: input.timestamp,
        }),
        'utf8',
      ),
      input.proofSignature,
      publicKeyHex,
    );
    if (!proofValid) {
      throw new ChallengeSignatureInvalidError('Bootstrap proof verification failed');
    }

    const tokenHash = hashToken(input.bootstrapToken);
    const tokenRecord = await this.repository.findEnrollmentTokenByHash(tokenHash);
    if (!tokenRecord) {
      throw new EnrollmentTokenNotFoundError();
    }
    if (tokenRecord.usedAt) {
      throw new EnrollmentTokenAlreadyUsedError();
    }
    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      this.auditLogger.log(AuditEvents.ENROLLMENT_TOKEN_REJECTED, {
        requestId,
        tokenIdHash: tokenHash,
        reason: 'expired',
        timestamp: new Date().toISOString(),
      });
      throw new EnrollmentTokenExpiredError();
    }

    const burned = await this.repository.burnEnrollmentTokenAtomically(tokenHash);
    if (!burned) {
      throw new EnrollmentTokenAlreadyUsedError();
    }

    this.auditLogger.log(AuditEvents.ENROLLMENT_TOKEN_CONSUMED, {
      requestId,
      tokenIdHash: tokenHash,
      agentDid: input.agentDid,
      timestamp: new Date().toISOString(),
    });

    const scopes = JSON.parse(tokenRecord.requestedScopes) as string[];
    const vc = await this.vcService.issueVC(
      {
        subjectDid: input.agentDid,
        subjectType: 'agent',
        privilegeScopes: scopes,
        agentName: tokenRecord.agentName,
        delegationDepth: 0,
        maxDelegationDepth: tokenRecord.maxDelegationDepth ?? 0,
        expiresInSeconds: this.enrollmentTokenTtlSeconds * 100,
      },
      requestId,
    );

    this.auditLogger.log(AuditEvents.AGENT_ONBOARDED, {
      requestId,
      agentDid: input.agentDid,
      agentName: tokenRecord.agentName,
      onboardingMode: 'bootstrap-proof-single-roundtrip',
    });

    return {
      agentDid: input.agentDid,
      vcId: vc.vcId,
      vc: vc.vc as SignedVC as unknown as Record<string, unknown>,
    };
  }

  async processOnboardStep1(
    input: { enrollmentToken: string; publicKeyHex: string; domains?: string[] },
    requestId: string,
  ): Promise<ChallengeResult> {
    if (!/^[0-9a-f]{64}$/i.test(input.publicKeyHex)) {
      throw Object.assign(new Error('Invalid public key'), {
        code: 'INVALID_PUBLIC_KEY',
        httpStatus: 400,
      });
    }
    for (const domain of input.domains ?? []) {
      if (!ensureHttps(domain)) {
        throw Object.assign(new Error('Invalid domain URL'), {
          code: 'INVALID_SERVICE_ENDPOINT_URL',
          httpStatus: 400,
        });
      }
    }

    const tokenHash = hashToken(input.enrollmentToken);
    const tokenRecord = await this.repository.findEnrollmentTokenByHash(tokenHash);
    if (!tokenRecord) {
      throw new EnrollmentTokenNotFoundError();
    }
    if (tokenRecord.usedAt) {
      throw new EnrollmentTokenAlreadyUsedError();
    }
    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      this.auditLogger.log(AuditEvents.ENROLLMENT_TOKEN_REJECTED, {
        requestId,
        tokenIdHash: tokenHash,
        reason: 'expired',
        timestamp: new Date().toISOString(),
      });
      throw new EnrollmentTokenExpiredError();
    }

    const burned = await this.repository.burnEnrollmentTokenAtomically(tokenHash);
    if (!burned) {
      throw new EnrollmentTokenAlreadyUsedError();
    }

    let didCreateRequest;
    try {
      didCreateRequest = await this.didService.prepareDIDCreation(input.publicKeyHex);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Hedera DID creation request failed';
      throw Object.assign(new Error(message), {
        code: ErrorCode.HEDERA_ANCHOR_FAILED,
        httpStatus: 502,
      });
    }
    const challengeId = `chal:${randomBytes(8).toString('hex')}`;
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.challengeTtlSeconds * 1000);
    await this.repository.createChallenge({
      challengeId,
      nonce,
      did: '',
      purpose: 'agent_onboarding',
      pendingPublicKeyHex: input.publicKeyHex,
      pendingDomains: JSON.stringify(input.domains ?? []),
      pendingDidCreateStateJson: didCreateRequest.stateJson,
      pendingDidCreatePayloadHex: didCreateRequest.signingPayloadHex,
      expiresAt,
      enrollmentTokenId: tokenRecord.id,
    });

    this.auditLogger.log(AuditEvents.ENROLLMENT_TOKEN_CONSUMED, {
      requestId,
      tokenIdHash: tokenHash,
      timestamp: new Date().toISOString(),
    });
    this.auditLogger.log(AuditEvents.CHALLENGE_ISSUED, {
      requestId,
      challengeId,
      did: '',
      purpose: 'agent_onboarding',
      expiresAt: expiresAt.toISOString(),
    });

    return {
      challengeId,
      nonce,
      expiresAt: expiresAt.toISOString(),
      didCreateSigningPayloadHex: didCreateRequest.signingPayloadHex,
    };
  }

  async processOnboardVerify(
    input: { challengeId: string; signature: string; didCreateSignature?: string },
    requestId: string,
  ): Promise<{
    agentDid: string;
    vc: Record<string, unknown>;
    hederaTransactionId: string;
    vcId: string;
  }> {
    const challenge = await this.repository.findChallengeById(input.challengeId);
    if (!challenge || challenge.purpose !== 'agent_onboarding') {
      throw new ChallengeNotFoundError();
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new ChallengeExpiredError();
    }
    if (challenge.verifiedAt) {
      throw new ChallengeAlreadyVerifiedError();
    }
    if (!/^[0-9a-f]{128}$/i.test(input.signature)) {
      throw new ChallengeSignatureInvalidError();
    }
    const validSignature = await verifySignature(
      Buffer.from(challenge.nonce, 'hex'),
      input.signature,
      challenge.pendingPublicKeyHex ?? '',
    );
    if (!validSignature) {
      throw new ChallengeSignatureInvalidError();
    }
    if (
      challenge.pendingDidCreateStateJson &&
      !/^[0-9a-f]{128}$/i.test(input.didCreateSignature ?? '')
    ) {
      throw new ChallengeSignatureInvalidError('DID creation signature is invalid');
    }

    const enrollmentToken = challenge.enrollmentTokenId
      ? await this.repository.findEnrollmentTokenById(challenge.enrollmentTokenId)
      : null;

    let didResult;
    try {
      didResult = await this.didService.createDID(
        challenge.pendingPublicKeyHex ?? '',
        'agent',
        JSON.parse(challenge.pendingDomains ?? '[]') as string[],
        requestId,
        challenge.pendingDidCreateStateJson && input.didCreateSignature
          ? {
              stateJson: challenge.pendingDidCreateStateJson,
              signatureHex: input.didCreateSignature,
            }
          : undefined,
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === ErrorCode.DID_ALREADY_EXISTS
      ) {
        throw new AgentAlreadyOnboardedError();
      }
      throw error;
    }

    const scopes = enrollmentToken
      ? (JSON.parse(enrollmentToken.requestedScopes) as string[])
      : ['read:orders'];
    const agentName = enrollmentToken?.agentName ?? 'Agent';
    const vc = await this.vcService.issueVC(
      {
        subjectDid: didResult.did,
        subjectType: 'agent',
        privilegeScopes: scopes,
        agentName,
        delegationDepth: 0,
        maxDelegationDepth: enrollmentToken?.maxDelegationDepth ?? 0,
        expiresInSeconds: this.enrollmentTokenTtlSeconds * 100,
      },
      requestId,
    );

    await this.repository.markChallengeVerified(input.challengeId);
    this.auditLogger.log(AuditEvents.CHALLENGE_VERIFIED, {
      requestId,
      challengeId: input.challengeId,
      did: didResult.did,
      purpose: 'agent_onboarding',
      success: true,
    });
    this.auditLogger.log(AuditEvents.AGENT_ONBOARDED, {
      requestId,
      agentDid: didResult.did,
      agentName,
      hederaTransactionId: didResult.hederaTransactionId,
    });

    return {
      agentDid: didResult.did,
      vc: vc.vc,
      hederaTransactionId: didResult.hederaTransactionId,
      vcId: vc.vcId,
    };
  }

  async issueUserChallenge(
    input: { did: string; purpose: 'user_verification' },
    requestId: string,
  ): Promise<ChallengeResult> {
    await this.didService.resolveDID(input.did);
    const challengeId = `chal:${randomBytes(8).toString('hex')}`;
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.challengeTtlSeconds * 1000);
    await this.repository.createChallenge({
      challengeId,
      nonce,
      did: input.did,
      purpose: 'user_verification',
      pendingPublicKeyHex: null,
      pendingDomains: null,
      expiresAt,
      enrollmentTokenId: null,
    });
    this.auditLogger.log(AuditEvents.CHALLENGE_ISSUED, {
      requestId,
      challengeId,
      did: input.did,
      purpose: input.purpose,
      expiresAt: expiresAt.toISOString(),
    });
    return { challengeId, nonce, expiresAt: expiresAt.toISOString() };
  }

  async verifyUserChallenge(
    challengeId: string,
    input: { signature: string },
    requestId: string,
  ): Promise<{ did: string; verified: true; vc?: Record<string, unknown> }> {
    const challenge = await this.repository.findChallengeById(challengeId);
    if (!challenge || challenge.purpose !== 'user_verification') {
      throw new ChallengeNotFoundError();
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new ChallengeExpiredError();
    }
    if (challenge.verifiedAt) {
      throw new ChallengeAlreadyVerifiedError();
    }
    if (!/^[0-9a-f]{128}$/i.test(input.signature)) {
      throw new ChallengeSignatureInvalidError();
    }
    const didDocument = await this.didService.resolveDID(challenge.did);
    const publicKeyHex = extractPublicKeyHex(didDocument);
    const validSignature = await verifySignature(
      Buffer.from(challenge.nonce, 'hex'),
      input.signature,
      publicKeyHex,
    );
    if (!validSignature) {
      throw new ChallengeSignatureInvalidError();
    }
    await this.repository.markChallengeVerified(challengeId);
    let vc = await this.vcService.findActiveBySubjectDid(challenge.did);
    if (!vc) {
      const issued = await this.vcService.issueVC(
        {
          subjectDid: challenge.did,
          subjectType: 'user',
          userId: challenge.did,
          expiresInSeconds: 7_776_000,
        },
        requestId,
      );
      vc = issued.vc;
    }
    this.auditLogger.log(AuditEvents.CHALLENGE_VERIFIED, {
      requestId,
      challengeId,
      did: challenge.did,
      purpose: 'user_verification',
      success: true,
    });
    this.auditLogger.log(AuditEvents.USER_DID_VERIFIED, {
      requestId,
      userDid: challenge.did,
      timestamp: new Date().toISOString(),
    });
    return { did: challenge.did, verified: true, vc };
  }

  async listServices(): Promise<{ services: ServiceEntry[] }> {
    const services = await this.repository.listActiveServices();
    return {
      services: services.map((service) => ({
        serviceName: service.serviceName,
        displayName: service.displayName,
        verifiedDomain: service.verifiedDomain,
        publicKeyMultibase: service.publicKeyMultibase,
        apiEndpoint: service.apiEndpoint,
        metadata: JSON.parse(service.metadata),
      })),
    };
  }

  async getService(serviceName: string): Promise<ServiceEntry> {
    const service = await this.repository.getServiceByName(serviceName);
    if (!service) {
      throw new ServiceNotFoundError();
    }
    return {
      serviceName: service.serviceName,
      displayName: service.displayName,
      verifiedDomain: service.verifiedDomain,
      publicKeyMultibase: service.publicKeyMultibase,
      apiEndpoint: service.apiEndpoint,
      metadata: JSON.parse(service.metadata),
    };
  }

  async createService(
    input: {
      serviceName: string;
      displayName: string;
      verifiedDomain: string;
      publicKeyMultibase: string;
      apiEndpoint: string;
      metadata: Record<string, unknown>;
    },
    _requestId: string,
  ): Promise<ServiceEntry> {
    void _requestId;
    if (
      !ensureServiceName(input.serviceName) ||
      !ensureHttps(input.verifiedDomain) ||
      !ensureHttps(input.apiEndpoint)
    ) {
      throw Object.assign(new Error('Invalid service data'), {
        code: 'VALIDATION_ERROR',
        httpStatus: 400,
      });
    }
    const existing = await this.repository.findServiceByName(input.serviceName);
    if (existing) {
      throw new ServiceAlreadyExistsError();
    }
    const created = await this.repository.createService({
      serviceName: input.serviceName,
      displayName: input.displayName,
      verifiedDomain: input.verifiedDomain,
      publicKeyMultibase: input.publicKeyMultibase,
      apiEndpoint: input.apiEndpoint,
      metadata: JSON.stringify(input.metadata),
    });
    return {
      serviceName: created.serviceName,
      displayName: created.displayName,
      verifiedDomain: created.verifiedDomain,
      publicKeyMultibase: created.publicKeyMultibase,
      apiEndpoint: created.apiEndpoint,
      metadata: JSON.parse(created.metadata),
    };
  }
}

export function mapAgentError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error && typeof error === 'object' && 'code' in error && 'httpStatus' in error) {
    const typed = error as HelixError;
    return { statusCode: typed.httpStatus, code: typed.code, message: typed.message };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}
