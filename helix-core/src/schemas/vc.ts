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

import { z } from 'zod';

/**
 * W3C Verifiable Credential standard contexts
 */
export const VC_CONTEXTS = [
  'https://www.w3.org/2018/credentials/v1',
  'https://helix-id.io/contexts/v1'
] as const;

/**
 * Proof structure following Ed25519Signature2020 (Linked Data Proofs)
 */
export const VCProofSchema = z.object({
  type: z.literal('Ed25519Signature2020'),
  created: z.string().datetime(),
  verificationMethod: z.string(), // e.g., did:helix:<id>#key-1
  proofPurpose: z.literal('assertionMethod'),
  proofValue: z.string(), // base58btc encoded signature
});

export type VCProof = z.infer<typeof VCProofSchema>;

/**
 * Credential Status for W3C StatusList2021
 */
export const VCCredentialStatusSchema = z.object({
  id: z.string().url(), // <API_BASE_URL>/v1/status-list/<listId>#<index>
  type: z.literal('StatusList2021Entry'),
  statusPurpose: z.literal('revocation'),
  statusListIndex: z.string(), // index as string
  statusListCredential: z.string().url(),
});

/**
 * Helix Agent Credential Subject
 */
export const AgentCredentialSubjectSchema = z.object({
  id: z.string(), // Agent DID
  type: z.literal('HelixAgent'),
  privilegeScopes: z.array(z.string()),
  agentName: z.string(),
});

/**
 * Helix User Credential Subject
 */
export const UserCredentialSubjectSchema = z.object({
  id: z.string(), // User DID
  type: z.literal('HelixUser'),
  userId: z.string(),
});

/**
 * Verifiable Credential Base Envelope
 */
const VCBaseSchema = z.object({
  '@context': z.array(z.string()).min(1),
  id: z.string(),
  issuer: z.string(),
  issuanceDate: z.string().datetime(),
  expirationDate: z.string().datetime(),
  credentialStatus: VCCredentialStatusSchema,
  proof: VCProofSchema.optional(),
});

/**
 * Full Agent VC Schema
 */
export const AgentVCSchema = VCBaseSchema.extend({
  type: z.array(z.string()).superRefine((val, ctx) => {
    if (!val.includes('VerifiableCredential') || !val.includes('HelixAgentCredential')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Agent VC types' });
    }
  }),
  credentialSubject: AgentCredentialSubjectSchema,
});

/**
 * Full User VC Schema
 */
export const UserVCSchema = VCBaseSchema.extend({
  type: z.array(z.string()).superRefine((val, ctx) => {
    if (!val.includes('VerifiableCredential') || !val.includes('HelixUserCredential')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid User VC types' });
    }
  }),
  credentialSubject: UserCredentialSubjectSchema,
});

export type AgentVC = z.infer<typeof AgentVCSchema>;
export type UserVC = z.infer<typeof UserVCSchema>;
export type HelixVC = AgentVC | UserVC;

export type SignedVC<T extends HelixVC = HelixVC> = T & {
  proof: VCProof;
};
