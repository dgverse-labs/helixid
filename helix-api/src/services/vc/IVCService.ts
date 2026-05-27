import type { SignedVP } from '@helix-id/core';

export type VCStatus = 'active' | 'revoked' | 'expired';

export interface IssueVCInput {
  subjectDid: string;
  subjectType: 'agent' | 'user';
  privilegeScopes?: string[];
  agentName?: string;
  userId?: string;
  expiresInSeconds: number;
  delegatedFrom?: string;
  delegationDepth?: number;
  maxDelegationDepth?: number;
  parentVcId?: string;
}

export interface IssueVCResult {
  vcId: string;
  vc: Record<string, unknown>;
  statusListIndex: number;
  expiresAt: string;
}

export interface IVCService {
  findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<Record<string, unknown> | null>;
  findRecordByVcId(vcId: string): Promise<{
    vcId: string;
    vc: Record<string, unknown>;
    status: VCStatus;
  } | null>;
  getVCStatus(vcId: string): Promise<VCStatus>;
  issueVC(input: IssueVCInput, requestId: string): Promise<IssueVCResult>;
  delegateVC(input: {
    delegatorVP: SignedVP;
    delegateeAgentDid: string;
    requestedScopes: string[];
    expiresInSeconds?: number;
  }, requestId: string): Promise<{
    vcId: string;
    delegateeAgentDid: string;
    delegatedFrom: string;
    delegationDepth: number;
    scopes: string[];
    expiresAt: string;
    vc: Record<string, unknown>;
  }>;
}
