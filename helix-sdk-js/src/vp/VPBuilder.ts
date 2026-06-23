import {
  base58btcEncode,
  hashCanonicalPayload,
  signBytes,
  verifySignature,
  VPInvalidStructureError,
  VPExpiredError,
  type UnsignedVP,
  type SignedVP,
  unsignedVPSchema,
  base58btcDecode
} from '@helixid/core';

export class VPBuilder {
  constructor(private unsignedVP: UnsignedVP) {}

  public async sign(privateKeyHex: string, verificationMethod: string): Promise<SignedVP> {
    const parsed = unsignedVPSchema.safeParse(this.unsignedVP);
    if (!parsed.success) {
      throw new VPInvalidStructureError();
    }
    const vp = parsed.data;

    if (new Date(vp.expirationDate).getTime() <= Date.now()) {
      throw new VPExpiredError();
    }

    const hash = hashCanonicalPayload(vp);
    const signatureHex = await signBytes(hash, privateKeyHex);
    const signatureBytes = Buffer.from(signatureHex, 'hex');

    return {
      ...vp,
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod,
        proofPurpose: 'assertionMethod',
        proofValue: base58btcEncode(signatureBytes)
      }
    };
  }

  public static async verify(signedVP: SignedVP, publicKeyHex: string): Promise<boolean> {
    const { proof, ...payload } = signedVP;
    const hash = hashCanonicalPayload(payload);
    const valid = await verifySignature(
        hash, 
        Buffer.from(base58btcDecode(proof.proofValue)).toString('hex'), 
        publicKeyHex
    );
    return valid;
  }
}
