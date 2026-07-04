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
  findActiveBySubjectDid(
    subjectDid: string,
    vcType?: string,
  ): Promise<Record<string, unknown> | null>;
  findActiveByVcIdForSubject(
    vcId: string,
    subjectDid: string,
    vcType?: string,
  ): Promise<Record<string, unknown> | null>;
  findRecordByVcId(vcId: string): Promise<{
    vcId: string;
    vc: Record<string, unknown>;
    status: VCStatus;
  } | null>;
  getVCStatus(vcId: string): Promise<VCStatus>;
  getStatusList(listId: string): Promise<{ credentialSubject: { encodedList: string } }>;
  createStatusList(input?: {
    listId?: string;
    length?: number;
  }): Promise<{
    '@context': string[];
    id: string;
    type: string[];
    issuer: string;
    validFrom: string;
    credentialSubject: {
      id: string;
      type: 'BitstringStatusList';
      statusPurpose: 'revocation';
      encodedList: string;
    };
  }>;
  issueVC(input: IssueVCInput, requestId: string): Promise<IssueVCResult>;
}
