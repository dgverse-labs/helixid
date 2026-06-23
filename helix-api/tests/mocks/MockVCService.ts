import { createStatusList, setBit } from '@helixid/core';
import type {
  IVCService,
  IssueVCInput,
  IssueVCResult,
  VCStatus,
} from '../../src/services/vc/IVCService.js';

export class MockVCService implements IVCService {
  private status: VCStatus = 'active';
  private activeVC: Record<string, unknown> | null = {
    id: 'vc:test:1',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    validUntil: new Date(Date.now() + 60_000).toISOString(),
    credentialStatus: {
      statusListCredential: 'http://localhost:3000/v1/status-list/helix-status-list-1',
      statusListIndex: '0',
    },
    credentialSubject: { privilegeScopes: ['read'] },
  };

  setStatus(status: VCStatus): void {
    this.status = status;
  }

  setActiveVC(vc: Record<string, unknown> | null): void {
    this.activeVC = vc;
  }

  async findActiveBySubjectDid(
    _subjectDid: string,
    vcType?: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.activeVC) return null;
    if (vcType) {
      const types = (this.activeVC['type'] as string[]) || [];
      if (!types.includes(vcType)) return null;
    }
    return this.activeVC;
  }

  async findActiveByVcIdForSubject(
    vcId: string,
    _subjectDid: string,
    vcType?: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.activeVC || this.activeVC['id'] !== vcId) return null;
    if (vcType) {
      const types = (this.activeVC['type'] as string[]) || [];
      if (!types.includes(vcType)) return null;
    }
    return this.activeVC;
  }

  async getVCStatus(): Promise<VCStatus> {
    return this.status;
  }

  async getStatusList(): Promise<{ credentialSubject: { encodedList: string } }> {
    const list = this.status === 'revoked' ? setBit(createStatusList(), 0, 1) : createStatusList();
    return { credentialSubject: { encodedList: list } };
  }

  async findRecordByVcId(
    vcId: string,
  ): Promise<{ vcId: string; vc: Record<string, unknown>; status: VCStatus } | null> {
    if (!this.activeVC || this.activeVC['id'] !== vcId) return null;
    return { vcId, vc: this.activeVC, status: this.status };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async issueVC(input: IssueVCInput, _requestId: string): Promise<IssueVCResult> {
    const vc = {
      id: 'vc:mock:issued',
      type: [
        'VerifiableCredential',
        input.subjectType === 'agent' ? 'HelixAgentCredential' : 'HelixUserCredential',
      ],
      credentialSubject: { id: input.subjectDid },
      validUntil: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    };
    return {
      vcId: 'vc:mock:issued',
      vc,
      statusListIndex: 0,
      expiresAt: vc.validUntil,
    };
  }
}
