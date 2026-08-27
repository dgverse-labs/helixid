import { randomUUID } from 'node:crypto';
import { createEd25519Proof } from './proof.js';
import type { SignedVC } from './schemas/vc.js';

export interface SelfIssueOptions {
  scopes: string[];
  expiresIn?: string;
  maxDelegationDepth?: number;
}

function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error('expiresIn must use s, m, h, or d suffix');
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}

export async function selfIssueVC(
  options: SelfIssueOptions,
  wallet: { did: string; privateKeyHex: string },
): Promise<SignedVC> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + parseDuration(options.expiresIn ?? '24h'));
  const payload = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: `vc:helix:self:${randomUUID()}`,
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: wallet.did,
    validFrom: now.toISOString(),
    validUntil: expiresAt.toISOString(),
    credentialSubject: {
      id: wallet.did,
      type: 'HelixAgent' as const,
      privilegeScopes: options.scopes,
      agentName: wallet.did,
      delegationDepth: 0,
      maxDelegationDepth: options.maxDelegationDepth ?? 0,
    },
    evidence: [{ type: 'SelfSignedDevCredential', warning: 'Not for production use' }],
  };

  return {
    ...payload,
    proof: await createEd25519Proof(payload, wallet.privateKeyHex, `${wallet.did}#key-1`),
  };
}
