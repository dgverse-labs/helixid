import { z } from 'zod';
import { ALLOWED_PRIVILEGE_SCOPES } from './privilegeScopes.js';

const contextSchema = z.array(z.string()).min(1);
const typeSchema = z.array(z.string()).min(1);

export const credentialStatusSchema = z.object({
  id: z.string().url(),
  type: z.literal('StatusList2021Entry'),
  statusPurpose: z.literal('revocation'),
  statusListIndex: z.string().regex(/^\d+$/),
  statusListCredential: z.string().url(),
});

const proofSchema = z.object({
  type: z.literal('Ed25519Signature2020'),
  created: z.string().datetime(),
  verificationMethod: z.string().min(1),
  proofPurpose: z.literal('assertionMethod'),
  proofValue: z.string().min(1),
});

export const agentVCSchema = z.object({
  '@context': contextSchema,
  id: z.string().regex(/^vc:helix:[a-zA-Z0-9]+$/),
  type: typeSchema.refine((types) => types.includes('VerifiableCredential') && types.includes('HelixAgentCredential')),
  issuer: z.string().min(1),
  issuanceDate: z.string().datetime(),
  expirationDate: z.string().datetime(),
  credentialStatus: credentialStatusSchema,
  credentialSubject: z.object({
    id: z.string().min(1),
    type: z.literal('HelixAgent'),
    privilegeScopes: z.array(z.enum(ALLOWED_PRIVILEGE_SCOPES)).min(1),
    agentName: z.string().min(1),
  }),
});

export const userVCSchema = z.object({
  '@context': contextSchema,
  id: z.string().regex(/^vc:helix:[a-zA-Z0-9]+$/),
  type: typeSchema.refine((types) => types.includes('VerifiableCredential') && types.includes('HelixUserCredential')),
  issuer: z.string().min(1),
  issuanceDate: z.string().datetime(),
  expirationDate: z.string().datetime(),
  credentialStatus: credentialStatusSchema,
  credentialSubject: z.object({
    id: z.string().min(1),
    type: z.literal('HelixUser'),
    userId: z.string().min(1),
  }),
});

export const signedVCSchema = z.union([
  agentVCSchema.extend({ proof: proofSchema }),
  userVCSchema.extend({ proof: proofSchema }),
]);

export type AgentVC = z.infer<typeof agentVCSchema>;
export type UserVC = z.infer<typeof userVCSchema>;
export type SignedVC = z.infer<typeof signedVCSchema>;
