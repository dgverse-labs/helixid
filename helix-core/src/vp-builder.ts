import { randomBytes, randomUUID } from 'node:crypto';
import { createEd25519Proof } from './proof.js';
import type { SignedVC } from './schemas/vc.js';
import type { SignedVP } from './schemas/vp.js';

export interface VPBuilderOptions {
  vc: SignedVC;
  holderDid: string;
  targetService: string;
  userDid: string;
}

export class VPBuilder {
  constructor(private readonly options: VPBuilderOptions) {}

  async sign(privateKeyHex: string, verificationMethodId: string): Promise<SignedVP> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const payload = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      id: `vp:helix:${randomUUID()}`,
      holder: this.options.holderDid,
      verifiableCredential: [this.options.vc],
      nonce: randomBytes(32).toString('hex'),
      expirationDate: expiresAt.toISOString(),
      delegatedBy: this.options.userDid,
      targetService: this.options.targetService,
    };

    return {
      ...payload,
      proof: await createEd25519Proof(payload, privateKeyHex, verificationMethodId),
    };
  }
}
