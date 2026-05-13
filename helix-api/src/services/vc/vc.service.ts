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
  getBit, 
  buildStatusListCredential,
  SignedVC,
  HelixVC
} from '@helix-id/core';
import { VcRepository } from '../../repositories/vc.repository.js';
import { IDIDService } from '../did/did.service.js';
import { ApiAuditLogger } from '../../audit/index.js';
import * as crypto from 'node:crypto';
import * as bs58 from 'bs58';

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
  issueVC(params: IssueVCParams, requestId: string): Promise<IssueVCResult>;
  getVC(vcId: string, requestId: string): Promise<VCDetails>;
  revokeVC(vcId: string, requestId: string): Promise<{ vcId: string; revoked: true; revokedAt: string }>;
  renewVC(vcId: string, overrides: RenewVCOptions, requestId: string): Promise<IssueVCResult & { previousVcId: string }>;
  getStatusList(listId: string): Promise<any>;
}

/**
 * Implementation of Verifiable Credential lifecycle management.
 */
export class VCService implements IVCService {
  private readonly DEFAULT_STATUS_LIST_ID = 'helix-status-list-1';
  private readonly HELIX_DID = 'did:helix:00000000000000000000000000000000'; // System Issuer

  constructor(
    private readonly vcRepo: VcRepository,
    private readonly didService: IDIDService,
    private readonly audit: ApiAuditLogger,
    private readonly signingKeyHex: string,
    private readonly apiBaseUrl: string,
  ) {}

  async issueVC(params: IssueVCParams, requestId: string): Promise<IssueVCResult> {
    // 1. Validate subject exists
    try {
      await this.didService.resolveDID(params.subjectDid, requestId);
    } catch (err: any) {
      if (err instanceof HelixError && err.code === ErrorCode.DID_NOT_FOUND) {
        throw new HelixError(ErrorCode.VC_SUBJECT_DID_NOT_FOUND, 'Subject DID not found', 404);
      }
      throw err;
    }

    // 2. Validate scopes (simplification for this story — real app would check a registry)
    if (params.privilegeScopes) {
      for (const scope of params.privilegeScopes) {
        if (!/^[a-z]+:[a-z_]+$/.test(scope)) {
          throw new HelixError(ErrorCode.VC_INVALID_PRIVILEGE_SCOPE, `Invalid scope format: ${scope}`, 400);
        }
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

    const { list: updatedList, claimedIndex } = await this.vcRepo.claimNextIndex(this.DEFAULT_STATUS_LIST_ID);

    // 4. Build VC
    const cuid = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const vcId = `vc:helix:${cuid}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (params.expiresInSeconds || 7776000) * 1000);

    const credential: HelixVC = {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://helix-id.io/contexts/v1'],
      id: vcId,
      type: ['VerifiableCredential', params.subjectType === 'agent' ? 'HelixAgentCredential' : 'HelixUserCredential'],
      issuer: this.HELIX_DID,
      issuanceDate: now.toISOString(),
      expirationDate: expiresAt.toISOString(),
      credentialStatus: {
        id: `${this.apiBaseUrl}/v1/status-list/${this.DEFAULT_STATUS_LIST_ID}#${claimedIndex}`,
        type: 'StatusList2021Entry',
        statusPurpose: 'revocation',
        statusListIndex: claimedIndex.toString(),
        statusListCredential: `${this.apiBaseUrl}/v1/status-list/${this.DEFAULT_STATUS_LIST_ID}`,
      },
      credentialSubject: params.subjectType === 'agent' 
        ? {
            id: params.subjectDid,
            type: 'HelixAgent',
            privilegeScopes: params.privilegeScopes || [],
            agentName: params.agentName || 'Unknown Agent',
          }
        : {
            id: params.subjectDid,
            type: 'HelixUser',
            userId: params.userId || 'unknown_user',
          } as any,
    };

    // 5. Sign VC (SHA-256 + Ed25519)
    const signedVc = this.signCredential(credential);

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
      vc: record.vcJson as any,
      status,
      expiresAt: record.expiresAt.toISOString(),
      revokedAt: record.revokedAt?.toISOString() || null,
      renewedByVcId: record.renewedByVcId,
    };
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

    const newVcResult = await this.issueVC({
      subjectDid: record.subjectDid,
      subjectType: record.subjectType as 'agent' | 'user',
      privilegeScopes: overrides.privilegeScopes || (record.privilegeScopes as string[]),
      expiresInSeconds: overrides.expiresInSeconds as number | undefined,
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

  async getStatusList(listId: string): Promise<any> {
    const list = await this.vcRepo.findStatusListById(listId);
    if (!list) {
      throw new HelixError(ErrorCode.STATUS_LIST_NOT_FOUND, 'Status list not found', 404);
    }

    return buildStatusListCredential(
      listId,
      list.encodedList,
      this.HELIX_DID,
      this.apiBaseUrl
    );
  }

  private signCredential(credential: HelixVC): SignedVC {
    const canonical = JSON.stringify(credential);
    const hash = crypto.createHash('sha256').update(canonical).digest();
    
    // Sign with private key
    // In a real implementation, we'd use a dedicated lib or WebCrypto. 
    // For Ed25519 with node:crypto:
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(this.signingKeyHex, 'hex'),
      format: 'der',
      type: 'pkcs8',
    });
    
    // Note: Node's sign() expects raw data, not hash for Ed25519
    const signature = crypto.sign(null, Buffer.from(canonical), privateKey);
    const proofValue = bs58.default.encode(signature);

    return {
      ...credential,
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: `${this.HELIX_DID}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue,
      },
    };
  }
}
