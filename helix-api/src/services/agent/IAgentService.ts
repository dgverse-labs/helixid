export interface EnrollmentTokenResult {
  token: string;
  expiresAt: string;
}

export interface ChallengeResult {
  challengeId: string;
  nonce: string;
  expiresAt: string;
  didCreateSigningPayloadHex?: string;
}

export interface OnboardVerifyResult {
  agentDid: string;
  vc: Record<string, unknown>;
  hederaTransactionId: string;
  vcId: string;
}

export interface UserChallengeVerifyResult {
  did: string;
  verified: true;
  vc?: Record<string, unknown>;
}

export interface ServiceEntry {
  serviceName: string;
  displayName: string;
  verifiedDomain: string;
  publicKeyMultibase: string;
  apiEndpoint: string;
  metadata: Record<string, unknown>;
}

export interface IAgentService {
  generateEnrollmentToken(
    input: { agentName: string; requestedScopes: string[]; requestedDomains?: string[]; maxDelegationDepth?: number },
    requestId: string
  ): Promise<EnrollmentTokenResult>;
  processOnboardStep1(
    input: { enrollmentToken: string; publicKeyHex: string; domains?: string[] },
    requestId: string
  ): Promise<ChallengeResult>;
  processOnboardVerify(
    input: { challengeId: string; signature: string; didCreateSignature?: string },
    requestId: string
  ): Promise<OnboardVerifyResult>;
  issueUserChallenge(input: { did: string; purpose: 'user_verification' }, requestId: string): Promise<ChallengeResult>;
  verifyUserChallenge(
    challengeId: string,
    input: { signature: string },
    requestId: string
  ): Promise<UserChallengeVerifyResult>;
  listServices(): Promise<{ services: ServiceEntry[] }>;
  getService(serviceName: string): Promise<ServiceEntry>;
  createService(
    input: Omit<ServiceEntry, 'metadata'> & { metadata: Record<string, unknown> },
    requestId: string
  ): Promise<ServiceEntry>;
}
