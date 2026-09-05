import {
  base58btcDecode,
  base58btcEncode,
  hashCanonicalPayload,
  signBytes,
  verifySignature,
} from './crypto/vp.js';
import { extractPublicKeyFromDIDDocument, type DIDDocument } from './crypto/did.js';

export interface LinkedDataProof {
  type: 'Ed25519Signature2020';
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
  proofValue: string;
}

export async function createEd25519Proof(
  payload: Record<string, unknown>,
  privateKeyHex: string,
  verificationMethod: string,
  /** Test-only: overrides `created` instead of `new Date()`, for deterministic golden vectors. */
  createdAt?: Date,
): Promise<LinkedDataProof> {
  const signatureHex = await signBytes(hashCanonicalPayload(payload), privateKeyHex);
  return {
    type: 'Ed25519Signature2020',
    created: (createdAt ?? new Date()).toISOString(),
    verificationMethod,
    proofPurpose: 'assertionMethod',
    proofValue: base58btcEncode(Buffer.from(signatureHex, 'hex')),
  };
}

export async function verifyEd25519Proof(
  payload: Record<string, unknown>,
  proof: { proofValue: string },
  didDocument: DIDDocument,
): Promise<boolean> {
  const verifyProofValue = async (proofValue: string): Promise<boolean> => verifySignature(
    hashCanonicalPayload(payload),
    Buffer.from(base58btcDecode(proofValue)).toString('hex'),
    extractPublicKeyFromDIDDocument(didDocument),
  );

  try {
    if (await verifyProofValue(proof.proofValue)) return true;
  } catch {
    // Retry below for multibase-prefixed values.
  }
  if (proof.proofValue.startsWith('z')) {
    try {
      return await verifyProofValue(proof.proofValue.slice(1));
    } catch {
      return false;
    }
  }
  return false;
}
