import { randomBytes } from 'node:crypto';
import {
  ALLOWED_PRIVILEGE_SCOPES,
  AuditEvents,
  base58btcEncode,
  buildStatusListCredential,
  config,
  DIDDeactivatedError,
  DIDNotFoundError,
  hashCanonicalPayload,
  SCOPE_PATTERN,
  setBit,
  signBytes,
  StatusListIndexExhaustedError,
  VCAlreadyRevokedError,
  VCInvalidPrivilegeScopeError,
  VCNotFoundError,
  VCSubjectDIDNotFoundError,
} from '@helix-id/core';
import type { IAuditLogger } from '@helix-id/core';
import type { VCRepository, Vc } from '../../repositories/vc.repository.js';
import type { IDIDService } from '../did/IDIDService.js';
import type {
  IssueVCInput,
  IssueVCResult,
  IVCService,
  RenewVCOverrides,
  RenewVCResult,
  RevokeVCResult,
  VCDetails,
  VCStatus,
} from './IVCService.js';

const STATUS_LIST_ID = 'helix-status-list-1';
const STATUS_LIST_SIZE = 131_072;
const HELIX_ISSUER_DID = 'did:hedera:testnet:helix-id-operator';

function generateVcId(): string {
  return `vc:helix:${randomBytes(12).toString('hex')}`;
}

function validateScopes(scopes: string[] | undefined): string[] {
  const values = scopes ?? [];
  for (const scope of values) {
    if (!SCOPE_PATTERN.test(scope) || !(ALLOWED_PRIVILEGE_SCOPES as readonly string[]).includes(scope)) {
      throw new VCInvalidPrivilegeScopeError(scope);
    }
  }
  return values;
}

function getStatus(record: Vc): VCStatus {
  if (record.revokedAt) return 'revoked';
  if (record.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'active';
}

function routeBaseUrl(): string {
  return config.API_BASE_URL.replace(/\/$/, '');
}

export class PrismaVCService implements IVCService {
  constructor(
    private readonly repository: VCRepository,
    private readonly didService: IDIDService,
    private readonly auditLogger: IAuditLogger,
  ) {}

  async findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<Record<string, unknown> | null> {
    const record = await this.repository.findActiveBySubjectDid(subjectDid);
    if (!record) return null;
    const vc = JSON.parse(record.vcJson) as Record<string, unknown>;
    if (vcType) {
      const types = Array.isArray(vc.type) ? vc.type : [];
      if (!types.includes(vcType)) return null;
    }
    return vc;
  }

  async issueVC(input: IssueVCInput, requestId: string): Promise<IssueVCResult> {
    try {
      await this.didService.resolveDID(input.subjectDid, requestId);
    } catch (error) {
      if (error instanceof DIDNotFoundError || error instanceof DIDDeactivatedError) {
        this.auditLogger.log(AuditEvents.VC_ISSUANCE_FAILED, {
          requestId,
          reason: 'VC_SUBJECT_DID_NOT_FOUND',
          subjectDid: input.subjectDid,
        });
        throw new VCSubjectDIDNotFoundError(input.subjectDid);
      }
      throw error;
    }

    if (input.subjectType === 'agent') {
      if (!input.agentName || !input.privilegeScopes?.length) {
        throw new VCInvalidPrivilegeScopeError(input.privilegeScopes?.[0] ?? 'missing');
      }
    }
    if (input.subjectType === 'user' && input.privilegeScopes?.length) {
      throw new VCInvalidPrivilegeScopeError(input.privilegeScopes[0]!);
    }

    const privilegeScopes = validateScopes(input.subjectType === 'agent' ? input.privilegeScopes : []);
    const statusListIndex = await this.repository.claimStatusListIndex(STATUS_LIST_ID);
    if (statusListIndex >= STATUS_LIST_SIZE) {
      this.auditLogger.log(AuditEvents.VC_ISSUANCE_FAILED, {
        requestId,
        reason: 'STATUS_LIST_INDEX_EXHAUSTED',
        subjectDid: input.subjectDid,
      });
      throw new StatusListIndexExhaustedError();
    }

    const vcId = generateVcId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresInSeconds * 1000);
    const statusListUrl = `${routeBaseUrl()}/v1/status-list/${STATUS_LIST_ID}`;
    const credentialStatus = {
      id: `${statusListUrl}#${statusListIndex}`,
      type: 'StatusList2021Entry',
      statusPurpose: 'revocation',
      statusListIndex: String(statusListIndex),
      statusListCredential: statusListUrl,
    };

    const unsignedVc =
      input.subjectType === 'agent'
        ? {
            '@context': ['https://www.w3.org/2018/credentials/v1', 'https://helix-id.io/contexts/v1'],
            id: vcId,
            type: ['VerifiableCredential', 'HelixAgentCredential'],
            issuer: HELIX_ISSUER_DID,
            issuanceDate: now.toISOString(),
            expirationDate: expiresAt.toISOString(),
            credentialStatus,
            credentialSubject: {
              id: input.subjectDid,
              type: 'HelixAgent',
              privilegeScopes,
              agentName: input.agentName,
            },
          }
        : {
            '@context': ['https://www.w3.org/2018/credentials/v1', 'https://helix-id.io/contexts/v1'],
            id: vcId,
            type: ['VerifiableCredential', 'HelixUserCredential'],
            issuer: HELIX_ISSUER_DID,
            issuanceDate: now.toISOString(),
            expirationDate: expiresAt.toISOString(),
            credentialStatus,
            credentialSubject: {
              id: input.subjectDid,
              type: 'HelixUser',
              userId: input.userId ?? input.subjectDid,
            },
          };

    const signatureHex = await signBytes(hashCanonicalPayload(unsignedVc), config.HELIX_SIGNING_KEY);
    const signedVc = {
      ...unsignedVc,
      proof: {
        type: 'Ed25519Signature2020',
        created: now.toISOString(),
        verificationMethod: `${HELIX_ISSUER_DID}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: base58btcEncode(Buffer.from(signatureHex, 'hex')),
      },
    };

    await this.repository.create({
      vcId,
      subjectDid: input.subjectDid,
      subjectType: input.subjectType,
      vcJson: JSON.stringify(signedVc),
      privilegeScopes: JSON.stringify(privilegeScopes),
      statusListIndex,
      expiresAt,
    });

    this.auditLogger.log(AuditEvents.VC_ISSUED, {
      requestId,
      vcId,
      subjectDid: input.subjectDid,
      subjectType: input.subjectType,
      privilegeScopes,
      expiresAt: expiresAt.toISOString(),
      statusListIndex,
    });

    return { vcId, vc: signedVc, statusListIndex, expiresAt: expiresAt.toISOString() };
  }

  async getVC(vcId: string, requestId: string): Promise<VCDetails> {
    const record = await this.repository.findByVcId(vcId);
    if (!record) throw new VCNotFoundError(vcId);
    const status = getStatus(record);
    this.auditLogger.log(AuditEvents.VC_STATUS_CHECKED, {
      requestId,
      vcId,
      status,
      timestamp: new Date().toISOString(),
    });
    return {
      vcId,
      vc: JSON.parse(record.vcJson) as Record<string, unknown>,
      status,
      expiresAt: record.expiresAt.toISOString(),
      revokedAt: record.revokedAt?.toISOString() ?? null,
      renewedByVcId: record.renewedByVcId,
    };
  }

  async revokeVC(vcId: string, requestId: string): Promise<RevokeVCResult> {
    const record = await this.repository.findByVcId(vcId);
    if (!record) {
      this.auditLogger.log(AuditEvents.VC_REVOCATION_FAILED, { requestId, vcId, reason: 'VC_NOT_FOUND' });
      throw new VCNotFoundError(vcId);
    }
    if (record.revokedAt) {
      this.auditLogger.log(AuditEvents.VC_REVOCATION_FAILED, { requestId, vcId, reason: 'VC_ALREADY_REVOKED' });
      throw new VCAlreadyRevokedError();
    }
    const statusList = await this.repository.getStatusListEntry(STATUS_LIST_ID);
    if (!statusList) throw new VCNotFoundError(vcId);
    const updatedList = setBit(statusList.encodedList, record.statusListIndex, 1);
    const revoked = await this.repository.revokeWithStatusList(vcId, STATUS_LIST_ID, updatedList);

    this.auditLogger.log(AuditEvents.VC_REVOKED, {
      requestId,
      vcId,
      timestamp: revoked.revokedAt!.toISOString(),
    });
    this.auditLogger.log(AuditEvents.STATUS_LIST_UPDATED, {
      requestId,
      listId: STATUS_LIST_ID,
      index: record.statusListIndex,
      newBitValue: 1,
      timestamp: new Date().toISOString(),
    });
    return { vcId, revoked: true, revokedAt: revoked.revokedAt!.toISOString() };
  }

  async renewVC(vcId: string, overrides: RenewVCOverrides, requestId: string): Promise<RenewVCResult> {
    const original = await this.repository.findByVcId(vcId);
    if (!original) {
      this.auditLogger.log(AuditEvents.VC_RENEWAL_FAILED, { requestId, vcId, reason: 'VC_NOT_FOUND' });
      throw new VCNotFoundError(vcId);
    }
    if (original.revokedAt) {
      this.auditLogger.log(AuditEvents.VC_RENEWAL_FAILED, { requestId, vcId, reason: 'VC_ALREADY_REVOKED' });
      throw new VCAlreadyRevokedError();
    }

    const originalVc = JSON.parse(original.vcJson) as {
      credentialSubject: { id: string; privilegeScopes?: string[]; agentName?: string; userId?: string };
    };
    const originalTtlSeconds = Math.max(3600, Math.floor((original.expiresAt.getTime() - original.createdAt.getTime()) / 1000));
    const renewalInput: IssueVCInput = {
      subjectDid: original.subjectDid,
      subjectType: original.subjectType as 'agent' | 'user',
      expiresInSeconds: overrides.expiresInSeconds ?? originalTtlSeconds,
    };
    const nextScopes = overrides.privilegeScopes ?? originalVc.credentialSubject.privilegeScopes;
    if (nextScopes) renewalInput.privilegeScopes = nextScopes;
    if (originalVc.credentialSubject.agentName) renewalInput.agentName = originalVc.credentialSubject.agentName;
    if (originalVc.credentialSubject.userId) renewalInput.userId = originalVc.credentialSubject.userId;

    const issued = await this.issueVC(renewalInput, requestId);
    await this.repository.markRenewed(vcId, issued.vcId);
    this.auditLogger.log(AuditEvents.VC_RENEWED, {
      requestId,
      oldVcId: vcId,
      newVcId: issued.vcId,
      timestamp: new Date().toISOString(),
    });
    return {
      vcId: issued.vcId,
      vc: issued.vc,
      previousVcId: vcId,
      expiresAt: issued.expiresAt,
    };
  }

  async getVCStatus(vcId: string): Promise<VCStatus> {
    const record = await this.repository.findByVcId(vcId);
    if (!record) throw new VCNotFoundError(vcId);
    return getStatus(record);
  }

  async getStatusListCredential(listId: string): Promise<object> {
    const statusList = await this.repository.getStatusListEntry(listId);
    if (!statusList) throw new VCNotFoundError(listId);
    return buildStatusListCredential(listId, statusList.encodedList, HELIX_ISSUER_DID, routeBaseUrl());
  }
}
