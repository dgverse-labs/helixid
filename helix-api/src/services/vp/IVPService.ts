import type { SignedVP, UnsignedVP } from '@helix-id/core';

export interface VPTemplateParams {
  agentDid: string;
  userDid: string;
  targetService: string;
  vcType: string;
  vcId?: string;
}

export interface VPTemplateResult {
  unsignedVP: UnsignedVP;
  vpId: string;
  expiresAt: string;
}

export interface VPVerificationResult {
  valid: true;
  agentDid: string;
  userDid: string;
  targetService: string;
  verifiedAt: string;
  session?: {
    token: string;
    expiresAt: string;
    publicKeyEndpoint: string;
  };
}

export interface IVPService {
  generateVPTemplate(params: VPTemplateParams, requestId: string): Promise<VPTemplateResult>;
  verifyVP(signedVP: SignedVP, requestId: string, options?: { issueSession?: boolean }): Promise<VPVerificationResult>;
}
