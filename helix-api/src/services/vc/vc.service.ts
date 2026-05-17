// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { 
  HelixError, 
  ErrorCode, 
  createStatusList, 
  setBit, 
  buildStatusListCredential,
  ALLOWED_PRIVILEGE_SCOPES,
  SCOPE_PATTERN,
  base58btcEncode,
  hashCanonicalPayload,
  signBytes,
  type HelixVC,
  type SignedVC,
} from '@helix-id/core';
import * as crypto from 'node:crypto';
import { VcRepository } from '../../repositories/vc.repository.js';
import type { IDIDService } from '../did/did.service.js';
import type { ApiAuditLogger } from '../../audit/index.js';

type CredentialSubject = {
  agentName?: string;
  userId?: string;
};

type StoredCredentialJson = {
  credentialSubject?: CredentialSubject;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function asSignedVC(value: unknown): SignedVC {
  return value as SignedVC;
}

export interface IssueVCParams {
  subjectDid: string;
  subjectType: 'agent' | 'user';
  privilegeScopes?: string[] | undefined;
  agentName?: string | undefined;
  userId?: string | undefined;
  expiresInSeconds?: number | undefined;
}

export interface IssueVCResult {
  vcId: string;
  vc: SignedVC;
  statusListIndex: number;
  expiresAt: string;
}

export interface VCDetails {
  vcId: string;
  vc: SignedVC;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: string;
  revokedAt: string | null;
  renewedByVcId: string | null;
}

export interface RenewVCOptions {
  privilegeScopes?: string[] | undefined;
  expiresInSeconds?: number | undefined;
}

/**
 * Interface for Verifiable Credential lifecycle operations.
 */
export interface IVCService {
  findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<Record<string, unknown> | null>;
  issueVC(params: IssueVCParams, requestId: string): Promise<IssueVCResult>;
  getVC(vcId: string, requestId: string): Promise<VCDetails>;
  revokeVC(vcId: string, requestId: string): Promise<{ vcId: string; revoked: true; revokedAt: string }>;
  renewVC(vcId: string, overrides: RenewVCOptions, requestId: string): Promise<IssueVCResult & { previousVcId: string }>;
  getVCStatus(vcId: string): Promise<'active' | 'revoked' | 'expired'>;
  getStatusList(listId: string): Promise<ReturnType<typeof buildStatusListCredential>>;
}

/**
 * Implementation of Verifiable Credential lifecycle management.
 */
export class VCService implements IVCService {
  private readonly DEFAULT_STATUS_LIST_ID = 'helix-status-list-1';

  constructor(
    private readonly vcRepo: VcRepository,
    private readonly didService: IDIDService,
    private readonly audit: ApiAuditLogger,
    private readonly signingKeyHex: string,
    private readonly issuerDid: string,
    private readonly apiBaseUrl: string,
  ) {}

  async findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<Record<string, unknown> | null> {
    const records = await this.vcRepo.findActiveBySubjectDid(subjectDid, vcType);
    const record = records.at(-1);
    if (!record) return null;
    return (typeof record.vcJson === 'string' ? JSON.parse(record.vcJson) : record.vcJson) as Record<string, unknown>;
  }

  async issueVC(params: IssueVCParams, requestId: string): Promise<IssueVCResult> {
    // 1. Validate subject exists
    try {
      await this.didService.resolveDID(params.subjectDid, requestId);
    } catch (err: unknown) {
      if (err instanceof HelixError && err.code === ErrorCode.DID_NOT_FOUND) {
        throw new HelixError(ErrorCode.VC_SUBJECT_DID_NOT_FOUND, 'Subject DID not found', 404);
      }
      throw err;
    }

    // 2. Validate scopes (simplification for this story — real app would check a registry)
    if (params.subjectType === 'agent' && (!params.privilegeScopes?.length || !params.agentName)) {
      throw new HelixError(ErrorCode.VALIDATION_ERROR, 'Agent VCs require privilegeScopes and agentName', 400);
    }
    if (params.subjectType === 'user' && (!params.userId || params.privilegeScopes?.length)) {
      throw new HelixError(ErrorCode.VALIDATION_ERROR, 'User VCs require userId and must not include privilegeScopes', 400);
    }
    for (const scope of params.privilegeScopes ?? []) {
        if (!SCOPE_PATTERN.test(scope) || !(ALLOWED_PRIVILEGE_SCOPES as readonly string[]).includes(scope)) {
          throw new HelixError(ErrorCode.VC_INVALID_PRIVILEGE_SCOPE, `Invalid scope format: ${scope}`, 400);
        }
    }

    // 3. Claim status list index
    let list = await this.vcRepo.findStatusListById(this.DEFAULT_STATUS_LIST_ID);
    if (!list) {
      const initialEncoded = createStatusList();
      list = await this.vcRepo.createStatusList(this.DEFAULT_STATUS_LIST_ID, initialEncoded);
    }

    if (list.nextIndex >= 131072) {
      throw new HelixError(ErrorCode.STATUS_LIST_INDEX_EXHAUSTED, 'Default status list is full', 503);
    }

    const { claimedIndex } = await this.vcRepo.claimNextIndex(this.DEFAULT_STATUS_LIST_ID);

    // 4. Build VC
    const cuid = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const vcId = `vc:helix:${cuid}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (params.expiresInSeconds || 7776000) * 1000);

    const credentialStatus = {
      id: `${this.apiBaseUrl}/v1/status-list/${this.DEFAULT_STATUS_LIST_ID}#${claimedIndex}`,
      type: 'StatusList2021Entry' as const,
      statusPurpose: 'revocation' as const,
      statusListIndex: claimedIndex.toString(),
      statusListCredential: `${this.apiBaseUrl}/v1/status-list/${this.DEFAULT_STATUS_LIST_ID}`,
    };
    const credential: HelixVC = params.subjectType === 'agent' ? {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://helix-id.io/contexts/v1'],
      id: vcId,
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: this.issuerDid,
      issuanceDate: now.toISOString(),
      expirationDate: expiresAt.toISOString(),
      credentialStatus,
      credentialSubject: {
        id: params.subjectDid,
        type: 'HelixAgent',
        privilegeScopes: params.privilegeScopes!,
        agentName: params.agentName!,
      },
    } : {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://helix-id.io/contexts/v1'],
      id: vcId,
      type: ['VerifiableCredential', 'HelixUserCredential'],
      issuer: this.issuerDid,
      issuanceDate: now.toISOString(),
      expirationDate: expiresAt.toISOString(),
      credentialStatus,
      credentialSubject: {
        id: params.subjectDid,
        type: 'HelixUser',
        userId: params.userId!,
      },
    };

    // 5. Sign VC (SHA-256 + Ed25519)
    const signedVc = await this.signCredential(credential);

    // 6. Persist
    await this.vcRepo.createVc({
      vcId,
      subjectDid: params.subjectDid,
      subjectType: params.subjectType,
      vcJson: signedVc,
      privilegeScopes: params.privilegeScopes,
      statusListIndex: claimedIndex,
      expiresAt,
    });

    // 7. Audit
    await this.audit.log({
      event: 'VC_ISSUED',
      timestamp: now.toISOString(),
      requestId,
      vcId,
      subjectDid: params.subjectDid,
      subjectType: params.subjectType,
      privilegeScopes: params.privilegeScopes,
      expiresAt: expiresAt.toISOString(),
      statusListIndex: claimedIndex,
    });

    return {
      vcId,
      vc: signedVc,
      statusListIndex: claimedIndex,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getVC(vcId: string, requestId: string): Promise<VCDetails> {
    void requestId;
    const record = await this.vcRepo.findByVcId(vcId);
    if (!record) {
      throw new HelixError(ErrorCode.VC_NOT_FOUND, 'Credential not found', 404);
    }

    const now = new Date();
    let status: 'active' | 'revoked' | 'expired' = 'active';
    if (record.revokedAt) status = 'revoked';
    else if (record.expiresAt < now) status = 'expired';

    return {
      vcId: record.vcId,
      vc: asSignedVC(record.vcJson),
      status,
      expiresAt: record.expiresAt.toISOString(),
      revokedAt: record.revokedAt?.toISOString() || null,
      renewedByVcId: record.renewedByVcId,
    };
  }

  async getVCStatus(vcId: string): Promise<'active' | 'revoked' | 'expired'> {
    const record = await this.vcRepo.findByVcId(vcId);
    if (!record) throw new HelixError(ErrorCode.VC_NOT_FOUND, 'Credential not found', 404);
    if (record.revokedAt) return 'revoked';
    if (record.expiresAt < new Date()) return 'expired';
    return 'active';
  }

  async revokeVC(vcId: string, requestId: string): Promise<{ vcId: string; revoked: true; revokedAt: string }> {
    const record = await this.vcRepo.findByVcId(vcId);
    if (!record) {
      throw new HelixError(ErrorCode.VC_NOT_FOUND, 'Credential not found', 404);
    }

    if (record.revokedAt) {
      throw new HelixError(ErrorCode.VC_ALREADY_REVOKED, 'Credential already revoked', 409);
    }

    const list = await this.vcRepo.findStatusListById(this.DEFAULT_STATUS_LIST_ID);
    if (!list) throw new Error('Status list missing during revocation');

    const newEncoded = setBit(list.encodedList, record.statusListIndex, 1);
    
    const updatedRecord = await this.vcRepo.revokeVc(vcId, this.DEFAULT_STATUS_LIST_ID, newEncoded);

    await this.audit.log({
      event: 'VC_REVOKED',
      timestamp: new Date().toISOString(),
      requestId,
      vcId,
      subjectDid: record.subjectDid,
    });

    return {
      vcId,
      revoked: true,
      revokedAt: updatedRecord.revokedAt!.toISOString(),
    };
  }

  async renewVC(vcId: string, overrides: RenewVCOptions, requestId: string): Promise<IssueVCResult & { previousVcId: string }> {
    const record = await this.vcRepo.findByVcId(vcId);
    if (!record) {
      throw new HelixError(ErrorCode.VC_NOT_FOUND, 'Credential not found', 404);
    }
    if (record.revokedAt) {
      throw new HelixError(ErrorCode.VC_ALREADY_REVOKED, 'Cannot renew a revoked credential', 409);
    }

    const vcJson = asRecord(record.vcJson) as StoredCredentialJson;
    const newVcResult = await this.issueVC({
      subjectDid: record.subjectDid,
      subjectType: record.subjectType as 'agent' | 'user',
      privilegeScopes: overrides.privilegeScopes || (record.privilegeScopes as unknown as string[]),
      agentName: vcJson.credentialSubject?.agentName,
      userId: vcJson.credentialSubject?.userId,
      expiresInSeconds: overrides.expiresInSeconds,
      // Carry over other metadata if needed
    }, requestId);

    await this.vcRepo.markAsRenewed(vcId, newVcResult.vcId);

    await this.audit.log({
      event: 'VC_RENEWED',
      timestamp: new Date().toISOString(),
      requestId,
      oldVcId: vcId,
      newVcId: newVcResult.vcId,
      subjectDid: record.subjectDid,
    });

    return {
      ...newVcResult,
      previousVcId: vcId,
    };
  }

  async getStatusList(listId: string): Promise<ReturnType<typeof buildStatusListCredential>> {
    const list = await this.vcRepo.findStatusListById(listId);
    if (!list) {
      throw new HelixError(ErrorCode.STATUS_LIST_NOT_FOUND, 'Status list not found', 404);
    }

    return buildStatusListCredential(
      listId,
      list.encodedList,
      this.issuerDid,
      this.apiBaseUrl
    );
  }

  private async signCredential(credential: HelixVC): Promise<SignedVC> {
    const signatureHex = await signBytes(hashCanonicalPayload(credential), this.signingKeyHex);
    const proofValue = base58btcEncode(Buffer.from(signatureHex, 'hex'));

    return {
      ...credential,
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: `${this.issuerDid}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue,
      },
    };
  }
}
