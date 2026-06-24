import { type UnsignedVP, type SignedVP } from '@helixid/core';
export declare class VPBuilder {
    private unsignedVP;
    constructor(unsignedVP: UnsignedVP);
    sign(privateKeyHex: string, verificationMethod: string): Promise<SignedVP>;
    static verify(signedVP: SignedVP, publicKeyHex: string): Promise<boolean>;
}
//# sourceMappingURL=VPBuilder.d.ts.map