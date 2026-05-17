export type VCStatus = 'active' | 'revoked' | 'expired';

export interface IssueVCInput {
  subjectDid: string;
  subjectType: 'agent' | 'user';
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

export interface IVCService {
  findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<Record<string, unknown> | null>;
  getVCStatus(vcId: string): Promise<VCStatus>;
  issueVC(input: IssueVCInput, requestId: string): Promise<IssueVCResult>;
}
