import type { IVPService, VPVerificationResult } from '../../src/services/vp/IVPService.js';

export class MockVPService implements IVPService {
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
