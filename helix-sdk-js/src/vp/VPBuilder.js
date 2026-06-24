import { base58btcEncode, hashCanonicalPayload, signBytes, verifySignature, VPInvalidStructureError, VPExpiredError, unsignedVPSchema, base58btcDecode } from '@helixid/core';
export class VPBuilder {
    unsignedVP;
    constructor(unsignedVP) {
        this.unsignedVP = unsignedVP;
    }
    async sign(privateKeyHex, verificationMethod) {
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
    static async verify(signedVP, publicKeyHex) {
        const { proof, ...payload } = signedVP;
        const hash = hashCanonicalPayload(payload);
        const valid = await verifySignature(hash, Buffer.from(base58btcDecode(proof.proofValue)).toString('hex'), publicKeyHex);
        return valid;
    }
}
//# sourceMappingURL=VPBuilder.js.map