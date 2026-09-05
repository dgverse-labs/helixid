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

import type { SignedVC } from '../../core/index.js';

export interface PrepareResult {
  token: string;
  unsignedPayload: Record<string, unknown>;
  canonicalHash: string;
  expiresAt: string;
}

export interface PrepareDelegationInput {
  /** DID of the delegator — becomes `issuer` and `credentialSubject.delegatedFrom`. */
  delegatorDid: string;
  /** The delegator's own currently-held agent-authority VC. */
  fromVC: SignedVC;
  to: string;
  scopes: string[];
  expiresIn: number;
}

export interface PrepareGrantInput {
  /** SP's own issuer DID — becomes `issuer` of the grant VC. */
  issuerDid: string;
  agentDid: string;
  userDid: string;
  scopes: string[];
  durability: 'standing' | 'session';
  serviceDid?: string;
  /** Current status list credential, unmodified — caller (SP) owns storage. */
  statusList: { credentialSubject: { encodedList: string } };
  statusListCredentialUrl: string;
}

export interface PrepareAgentRenewalInput {
  /**
   * The agent's current (soon-to-expire or already-expired-within-grace) VC.
   * Must carry a `credentialStatus` entry — renewal can't check revocation
   * without one. Renewal is signed by whoever signed this VC (`issuer`).
   */
  currentVC: SignedVC;
  /**
   * Status list the currentVC's credentialStatus entry lives on, unmodified.
   * Caller owns storage, same as PrepareGrantInput.statusList.
   */
  statusList: { credentialSubject: { encodedList: string } };
  statusListCredentialUrl: string;
  expiresIn: number;
  /**
   * Optional narrower scope set for the renewed VC. Must be a subset of
   * currentVC's scopes — renewal can only narrow, never widen. Omit to keep
   * the same scopes.
   */
  scopes?: string[];
}

export interface FinalizeInput {
  token: string;
  verificationMethod: string;
  /** Hex-encoded raw Ed25519 signature over the hash returned by prepare(). */
  signatureHex: string;
  /** Optional; defaults to now if omitted. */
  proofCreatedAt?: string;
}

export interface IPreparedPayloadService {
  prepareDelegation(input: PrepareDelegationInput): Promise<PrepareResult>;
  prepareGrant(input: PrepareGrantInput): Promise<PrepareResult>;
  prepareAgentRenewal(input: PrepareAgentRenewalInput): Promise<PrepareResult>;
  finalizeDelegation(input: FinalizeInput): Promise<SignedVC>;
  finalizeGrant(input: FinalizeInput): Promise<SignedVC>;
  finalizeAgentRenewal(input: FinalizeInput): Promise<SignedVC>;
}
