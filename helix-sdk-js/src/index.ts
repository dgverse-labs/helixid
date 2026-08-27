// Agent
export { AgentWallet } from './wallet/AgentWallet.js';
export { VPBuilder } from './vp-builder.js';
export { delegate } from './delegation.js';
export type { DelegateOptions } from './delegation.js';
export { renewAgentVC } from './renewal.js';
export type { RenewAgentVCOptions } from './renewal.js';

// Issuer / SP
export { issueGrant } from './grant.js';
export type { IssuerKeyMaterial, IssueGrantOptions, IssueGrantResult } from './grant.js';

// Verifier
export { verifyVP } from './verify.js';
export { checkScope, requireScope } from './scope.js';
export { SessionManager } from './session/index.js';

// Enrollment only / issuer API operations
export { HelixClient } from './client/HelixClient.js';
export type { CreateStatusListOptions, VerifyVPApiResult } from './client/HelixClient.js';

export * from './errors/index.js';
export * from './resolver/IDidResolver.js';
export * from './resolver/HelixDidResolver.js';
export * from './resolver/types.js';
export type {
  DIDDocument,
  ServiceEndpoint,
  VerificationMethod,
} from './core/did.js';
export type { DelegationLink, VerifyVPOptions, VerifyVPResult } from './core/verification-types.js';
export type { SelfIssueOptions } from './core/self-signed.js';
export type { SignedVC } from './core/schemas/vc.js';
export type { SignedVP } from './core/schemas/vp.js';
export type { VPBuilderOptions } from './core/vp-builder-impl.js';
export { generateKeyPair, publicKeyToMultibase, signData, type KeyPair } from './core/keys.js';
export type { SessionClaims, SessionIssueInput, SessionManagerOptions } from './session/index.js';
