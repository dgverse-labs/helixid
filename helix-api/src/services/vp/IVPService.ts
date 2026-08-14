import type { SignedVP } from '@helixid/core';

export interface VPVerificationResult {
  valid: true;
  agentDid: string;
  userDid?: string;
  targetService: string;
  verifiedAt: string;
  session?: {
    token: string;
    expiresAt: string;
    publicKeyEndpoint: string;
  };
}

export interface IVPService {
  verifyVP(signedVP: SignedVP, requestId: string, options?: { issueSession?: boolean }): Promise<VPVerificationResult>;
}
