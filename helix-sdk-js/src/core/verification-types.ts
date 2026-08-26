// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Type-only shapes duplicated from helix-core's vp-verifier.ts and
// delegation.ts — see docs/proposal-retire-core-package.md. Deliberately
// types only: the actual verifyVP()/delegation logic stays in helix-api
// per the SDK-API-only architecture (proposal-sdk-api-only.md). These
// interfaces just describe the shape of what the API returns, so the SDK
// can type its own HelixClient.verifyVP() wrapper result.

import type { StatusListCredential } from './status-list-schema.js';

export type StatusListResolver = (statusListUrl: string) => Promise<StatusListCredential>;

export interface VerifyVPOptions {
  expectedTargetService?: string;
  allowSelfSigned?: boolean;
  statusListResolver?: StatusListResolver;
}

export interface DelegationLink {
  issuer: string;
  subject: string;
  vcId: string;
  scopes: string[];
  delegationDepth: number;
}

export interface VerifyVPResult {
  valid: boolean;
  agentDid: string;
  privilegeScopes: string[];
  /**
   * Enforcement scopes: equals privilegeScopes when no consent grant is
   * present; the intersection of privilegeScopes and the grant's scopes when
   * one is. checkScope()/requireScope() read this field.
   */
  effectiveScopes: string[];
  vpId: string;
  delegationChain: DelegationLink[];
  warning?: string;
  error?: string;
}
