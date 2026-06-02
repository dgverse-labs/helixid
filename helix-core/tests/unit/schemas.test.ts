import { describe, expect, it } from 'vitest';
import { unsignedVPSchema, signedVPSchema } from '../../src/schemas/vp.js';

describe('VP Schemas', () => {
  const validUnsigned = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiablePresentation'],
    id: 'vp:helix:123',
    holder: 'did:key:123',
    verifiableCredential: [{ id: 'vc:1' }],
    nonce: 'a'.repeat(64),
    expirationDate: new Date().toISOString(),
    delegatedBy: 'did:key:user',
    targetService: 'amazon'
  };

  describe('unsignedVPSchema', () => {
    it('validates a correct payload', () => {
      const result = unsignedVPSchema.safeParse(validUnsigned);
      expect(result.success).toBe(true);
    });

    it('rejects invalid id format', () => {
      const result = unsignedVPSchema.safeParse({ ...validUnsigned, id: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('rejects short nonce', () => {
      const result = unsignedVPSchema.safeParse({ ...validUnsigned, nonce: 'abc' });
      expect(result.success).toBe(false);
    });
  });

  describe('signedVPSchema', () => {
    it('validates a correctly signed payload', () => {
      const signed = {
        ...validUnsigned,
        proof: {
          type: 'Ed25519Signature2020',
          created: new Date().toISOString(),
          verificationMethod: 'did:key:123#key-1',
          proofPurpose: 'assertionMethod',
          proofValue: 'sig'
        }
      };
      const result = signedVPSchema.safeParse(signed);
      expect(result.success).toBe(true);
    });

    it('rejects missing proof', () => {
      const result = signedVPSchema.safeParse(validUnsigned);
      expect(result.success).toBe(false);
    });
  });
});
