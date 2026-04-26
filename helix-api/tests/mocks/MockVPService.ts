import type { IVPService, VPTemplateParams, VPTemplateResult, VPVerificationResult } from '../../src/services/vp/IVPService.js';

export class MockVPService implements IVPService {
  async generateVPTemplate(params: VPTemplateParams): Promise<VPTemplateResult> {
    return {
      vpId: 'vp:helix:mock',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      unsignedVP: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        id: 'vp:helix:mock',
        holder: params.agentDid,
        verifiableCredential: [{ id: 'vc:mock' }],
        nonce: 'a'.repeat(64),
        expirationDate: new Date(Date.now() + 60_000).toISOString(),
        delegatedBy: params.userDid,
        targetService: params.targetService
      }
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verifyVP(_signedVP: Parameters<IVPService['verifyVP']>[0]): Promise<VPVerificationResult> {
    return {
      valid: true,
      agentDid: 'did:hedera:testnet:agent1',
      userDid: 'did:hedera:testnet:user1',
      targetService: 'amazon',
      verifiedAt: new Date().toISOString()
    };
  }
}
