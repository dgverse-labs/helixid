import type { IVCService, IssueVCInput } from './IVCService.js';
import { VCRepository } from '../../repositories/vc.repository.js';

export class PrismaVCService implements IVCService {
  constructor(private readonly repository: VCRepository) {}

  async findActiveBySubjectDid(did: string, vcType?: string): Promise<Record<string, unknown> | null> {
    const vcs = await this.repository.findActiveBySubjectDid(did, vcType);
    if (vcs.length === 0) return null;
    if (vcs.length > 1) {
      // In a real implementation, we might want to throw VPMultipleActiveVCError if not disambiguated
      // but for now we take the latest
      return JSON.parse(vcs[vcs.length - 1]!.vcJson);
    }
    return JSON.parse(vcs[0]!.vcJson);
  }

  async getVCStatus(vcId: string): Promise<'active' | 'revoked' | 'expired'> {
    const vc = await this.repository.findByVcId(vcId);
    if (!vc) return 'expired'; // Or throw error
    if (vc.status === 'revoked') return 'revoked';
    if (new Date(vc.expiresAt) < new Date()) return 'expired';
    return 'active';
  }

  async issueVC(input: IssueVCInput, _requestId: string): Promise<Record<string, unknown>> {
    const vcId = `vc:helix:${Math.random().toString(16).slice(2, 14)}`;
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const vcJson = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: vcId,
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: input.issuerDid || 'did:helix:root',
      issuanceDate: new Date().toISOString(),
      expirationDate: expiresAt.toISOString(),
      credentialSubject: {
        id: input.subjectDid,
        ...input.claims
      }
    };

    await this.repository.createVC({
      vcId,
      subjectDid: input.subjectDid,
      issuerDid: input.issuerDid || 'did:helix:root',
      type: 'VerifiableCredential,HelixAgentCredential',
      vcJson: JSON.stringify(vcJson),
      expiresAt
    });

    return vcJson;
  }
}
