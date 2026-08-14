import { randomBytes, randomUUID } from 'node:crypto';
import { createEd25519Proof } from './proof.js';
import { VPInvalidStructureError } from './errors/HelixError.js';
import type { SignedVC } from './schemas/vc.js';
import type { SignedVP } from './schemas/vp.js';

export interface VPBuilderOptions {
  /** 1 or 2 entries: exactly one agent-authority VC, optionally one consent grant. */
  credentials: SignedVC[];
  holderDid: string;
  targetService: string;
  /** DID or plain email string; when absent, `delegatedBy` is omitted from the payload entirely. */
  userDid?: string;
}

function isAgentAuthorityType(vc: SignedVC): boolean {
  return Array.isArray(vc.type) && vc.type.includes('HelixAgentCredential');
}

function isGrantType(vc: SignedVC): boolean {
  return Array.isArray(vc.type) && vc.type.includes('DelegationGrantCredential');
}

export class VPBuilder {
  constructor(private readonly options: VPBuilderOptions) {
    const credentials = options.credentials;
    if (!Array.isArray(credentials) || credentials.length < 1 || credentials.length > 2) {
      throw new VPInvalidStructureError('VP must carry 1 or 2 credentials');
    }
    const agentEntries = credentials.filter(isAgentAuthorityType);
    const grantEntries = credentials.filter(isGrantType);
    if (
      agentEntries.length !== 1 ||
      grantEntries.length > 1 ||
      agentEntries.length + grantEntries.length !== credentials.length
    ) {
      throw new VPInvalidStructureError(
        'VP credential array must contain exactly one agent-authority credential and at most one consent grant',
      );
    }
  }

  async sign(privateKeyHex: string, verificationMethodId: string): Promise<SignedVP> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const payload = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiablePresentation'],
      id: `vp:helix:${randomUUID()}`,
      holder: this.options.holderDid,
      verifiableCredential: this.options.credentials,
      nonce: randomBytes(32).toString('hex'),
      expirationDate: expiresAt.toISOString(),
      // "No user" is one semantic state with one wire shape: the key is absent,
      // never serialized as null/undefined.
      ...(this.options.userDid !== undefined ? { delegatedBy: this.options.userDid } : {}),
      targetService: this.options.targetService,
    };

    return {
      ...payload,
      proof: await createEd25519Proof(payload, privateKeyHex, verificationMethodId),
    };
  }
}
