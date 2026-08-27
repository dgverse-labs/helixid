// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

// Barrel export — re-exports all public modules from helix-core.
// helix-api and helix-sdk-js import from '@helixid/core', not from sub-paths.
export * from './config/index.js';
export * from './crypto/index.js';
export * from './schemas/index.js';
export * from './errors/index.js';
export * from './audit/index.js';
export * from './status-list/index.js';
export { resolveDID, clearDIDCache } from './did-resolver.js';
export { createEd25519Proof, verifyEd25519Proof } from './proof.js';
export type { LinkedDataProof } from './proof.js';
export { VPBuilder } from './vp-builder.js';
export { verifyVP, fetchStatusList } from './vp-verifier.js';
export { buildDelegationVC } from './delegation.js';
export { issueGrant, revokeGrant } from './grant.js';
export type {
  IssueGrantOptions,
  IssuerKeyMaterial,
  RevokeGrantTarget,
  SignedStatusListCredential,
} from './grant.js';
export { selfIssueVC } from './self-signed.js';
export type { VPBuilderOptions, VPBuilderSignOverrides } from './vp-builder.js';
export type { StatusListResolver, VerifyVPOptions, VerifyVPResult } from './vp-verifier.js';
export type { DelegateOptions, DelegationLink } from './delegation.js';
export type { SelfIssueOptions } from './self-signed.js';
