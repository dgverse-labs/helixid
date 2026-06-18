// Agent
export { AgentWallet } from './wallet/AgentWallet.js';
export { VPBuilder } from './vp-builder.js';
export { delegate } from './delegation.js';

// Verifier
export { verifyVP } from './verify.js';
export { checkScope, requireScope } from './scope.js';

// Enrollment only / issuer API operations
export { HelixClient } from './client/HelixClient.js';

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
} from '@helix-id/core';
