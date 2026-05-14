export type VCStatus = 'active' | 'revoked' | 'expired';
export type SubjectType = 'agent' | 'user';

export interface IssueVCInput {
  subjectDid: string;
  subjectType: SubjectType;
  privilegeScopes?: string[];
  agentName?: string;
  userId?: string;
  expiresInSeconds: number;
}

export interface IssueVCResult {
  vcId: string;
  vc: Record<string, unknown>;
  statusListIndex: number;
  expiresAt: string;
}

export interface VCDetails {
  vcId: string;
  vc: Record<string, unknown>;
  status: VCStatus;
  expiresAt: string;
  revokedAt: string | null;
  renewedByVcId: string | null;
}

export interface RevokeVCResult {
  vcId: string;
  revoked: true;
  revokedAt: string;
}

export interface RenewVCOverrides {
  privilegeScopes?: string[];
  expiresInSeconds?: number;
}

export interface RenewVCResult {
  vcId: string;
  vc: Record<string, unknown>;
  previousVcId: string;
  expiresAt: string;
}

export interface IVCService {
  findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<Record<string, unknown> | null>;
  issueVC(input: IssueVCInput, requestId: string): Promise<IssueVCResult>;
  getVC(vcId: string, requestId: string): Promise<VCDetails>;
  revokeVC(vcId: string, requestId: string): Promise<RevokeVCResult>;
  renewVC(vcId: string, overrides: RenewVCOverrides, requestId: string): Promise<RenewVCResult>;
  getVCStatus(vcId: string): Promise<VCStatus>;
  getStatusListCredential(listId: string): Promise<object>;
}
