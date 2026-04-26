import type { IVCService, IssueVCInput, VCStatus } from '../../src/services/vc/IVCService.js';

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
  async issueVC(input: IssueVCInput): Promise<Record<string, unknown>> {
    return {
      id: 'vc:mock:issued',
      type: ['VerifiableCredential', input.subjectType === 'agent' ? 'HelixAgentCredential' : 'HelixUserCredential'],
      credentialSubject: { id: input.subjectDid }
    };
  }
}
