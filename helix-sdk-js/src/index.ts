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
  DelegationLink,
  DIDDocument,
  SelfIssueOptions,
  ServiceEndpoint,
  SignedVC,
  SignedVP,
  VerificationMethod,
  VerifyVPOptions,
  VerifyVPResult,
  VPBuilderOptions,
} from '@helixid/core';
export type { SessionClaims, SessionIssueInput, SessionManagerOptions } from './session/index.js';
