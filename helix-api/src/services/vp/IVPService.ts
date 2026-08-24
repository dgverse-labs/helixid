import type { DelegationLink, SignedVP } from '@helixid/core';

export interface VPVerificationResult {
  valid: true;
  agentDid: string;
  userDid?: string;
  targetService: string;
  verifiedAt: string;
  /** Full privilege scope set carried by the presented VC. */
  privilegeScopes: string[];
  /**
   * Enforcement scopes: equals privilegeScopes when no consent grant is
   * present; the intersection of privilegeScopes and the grant's scopes when
   * one is. Mirrors core's VerifyVPResult.effectiveScopes — SDK-side
   * checkScope()/requireScope() read this field.
   */
  effectiveScopes: string[];
  vpId: string;
  delegationChain: DelegationLink[];
  warning?: string;
  session?: {
    token: string;
    expiresAt: string;
    publicKeyEndpoint: string;
  };
}

export interface IVPService {
  verifyVP(
    signedVP: SignedVP,
    requestId: string,
    options?: { issueSession?: boolean; expectedTargetService?: string; allowSelfSigned?: boolean },
  ): Promise<VPVerificationResult>;
}
