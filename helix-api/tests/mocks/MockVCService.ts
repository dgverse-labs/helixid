import type { SignedVP } from '@helix-id/core';
import type { IVCService, IssueVCInput, IssueVCResult, VCStatus } from '../../src/services/vc/IVCService.js';

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

  async findRecordByVcId(vcId: string): Promise<{ vcId: string; vc: Record<string, unknown>; status: VCStatus } | null> {
    if (!this.activeVC || this.activeVC['id'] !== vcId) return null;
    return { vcId, vc: this.activeVC, status: this.status };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async issueVC(input: IssueVCInput, _requestId: string): Promise<IssueVCResult> {
    const vc = {
      id: 'vc:mock:issued',
      type: ['VerifiableCredential', input.subjectType === 'agent' ? 'HelixAgentCredential' : 'HelixUserCredential'],
      credentialSubject: { id: input.subjectDid },
      expirationDate: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    };
    return {
      vcId: 'vc:mock:issued',
      vc,
      statusListIndex: 0,
      expiresAt: vc.expirationDate,
    };
  }

  async delegateVC(
    _input: {
      delegatorVP: SignedVP;
      delegateeAgentDid: string;
      requestedScopes: string[];
      expiresInSeconds?: number;
    },
    _requestId: string,
  ): Promise<{
    vcId: string;
    delegateeAgentDid: string;
    delegatedFrom: string;
    delegationDepth: number;
    scopes: string[];
    expiresAt: string;
    vc: Record<string, unknown>;
  }> {
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    return {
      vcId: 'vc:mock:delegated',
      delegateeAgentDid: _input.delegateeAgentDid,
      delegatedFrom: 'did:hedera:testnet:delegator',
      delegationDepth: 1,
      scopes: _input.requestedScopes,
      expiresAt,
      vc: { id: 'vc:mock:delegated', expirationDate: expiresAt },
    };
  }
}
