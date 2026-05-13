import { z } from 'zod';

const contextSchema = z.array(z.string()).min(1);
const typeSchema = z.array(z.string()).min(1);

const proofSchema = z.object({
  type: z.literal('Ed25519Signature2020'),
  created: z.string().datetime(),
  verificationMethod: z.string().min(1),
  proofPurpose: z.literal('assertionMethod'),
  proofValue: z.string().min(1)
});

export const unsignedVPSchema = z.object({
  '@context': contextSchema,
  type: typeSchema,
  id: z.string().regex(/^vp:helix:/),
  holder: z.string().min(1),
  verifiableCredential: z.array(z.record(z.unknown())).min(1),
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
  expirationDate: z.string().datetime(),
  delegatedBy: z.string().min(1),
  targetService: z.string().min(1)
});

export const signedVPSchema = unsignedVPSchema.extend({
  proof: proofSchema
});

export type UnsignedVP = z.infer<typeof unsignedVPSchema>;
export type SignedVP = z.infer<typeof signedVPSchema>;
