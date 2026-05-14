import type {
  IssueVCInput,
  IssueVCResult,
  IVCService,
  RenewVCOverrides,
  RenewVCResult,
  RevokeVCResult,
  VCDetails,
  VCStatus,
} from '../../src/services/vc/IVCService.js';

export class MockVCService implements IVCService {
  private status: VCStatus = 'active';
  private activeVC: Record<string, unknown> | null = {
    id: 'vc:test:1',
    expirationDate: new Date(Date.now() + 60_000).toISOString(),
    credentialSubject: { privilegeScopes: ['read'] }
  };

  setStatus(status: VCStatus): void {
    this.status = status;
  }

  setActiveVC(vc: Record<string, unknown> | null): void {
    this.activeVC = vc;
  }

  async findActiveBySubjectDid(_subjectDid: string, vcType?: string): Promise<Record<string, unknown> | null> {
    if (!this.activeVC) return null;
    if (vcType) {
      const types = (this.activeVC['type'] as string[]) || [];
      if (!types.includes(vcType)) return null;
    }
    return this.activeVC;
  }

  async getVCStatus(): Promise<VCStatus> {
    return this.status;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async issueVC(input: IssueVCInput): Promise<IssueVCResult> {
    const vc = {
      id: 'vc:mock:issued',
      type: ['VerifiableCredential', input.subjectType === 'agent' ? 'HelixAgentCredential' : 'HelixUserCredential'],
      credentialSubject: { id: input.subjectDid }
    };
    return {
      vcId: 'vc:mock:issued',
      vc,
      statusListIndex: 0,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
  }

  async getVC(vcId: string): Promise<VCDetails> {
    return {
      vcId,
      vc: this.activeVC ?? {},
      status: this.status,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null,
      renewedByVcId: null
    };
  }

  async revokeVC(vcId: string): Promise<RevokeVCResult> {
    this.status = 'revoked';
    return { vcId, revoked: true, revokedAt: new Date().toISOString() };
  }

  async renewVC(vcId: string, _overrides: RenewVCOverrides): Promise<RenewVCResult> {
    const issued = await this.issueVC({
      subjectDid: 'did:mock:subject',
      subjectType: 'agent',
      privilegeScopes: ['read:orders'],
      agentName: 'Mock Agent',
      expiresInSeconds: 3600
    });
    return { vcId: issued.vcId, vc: issued.vc, previousVcId: vcId, expiresAt: issued.expiresAt };
  }

  async getStatusListCredential(): Promise<object> {
    return {};
  }
}
