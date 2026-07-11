import { randomUUID } from 'node:crypto';
import { createEd25519Proof } from './proof.js';
import {
  MaxDelegationDepthExceededError,
  ScopeEscalationDeniedError,
} from './errors/HelixError.js';
import type { SignedVC } from './schemas/vc.js';

export interface DelegateOptions {
  to: string;
  scopes: string[];
  expiresIn: number;
  fromVC: SignedVC;
}

export interface DelegationLink {
  issuer: string;
  subject: string;
  vcId: string;
  scopes: string[];
  delegationDepth: number;
}

type AgentSignedVC = SignedVC & {
  credentialSubject: SignedVC['credentialSubject'] & {
    privilegeScopes: string[];
    delegatedFrom?: string;
    delegationDepth?: number;
    maxDelegationDepth?: number;
    parentVcId?: string;
  };
  delegationChain?: SignedVC[];
};

function assertAgentVC(vc: SignedVC): asserts vc is AgentSignedVC {
  const subject = vc.credentialSubject as { privilegeScopes?: unknown };
  if (!Array.isArray(subject.privilegeScopes)) {
    throw new ScopeEscalationDeniedError('credential has no privilege scopes');
  }
}

function assertSubset(parentScopes: string[], childScopes: string[]): void {
  const parent = new Set(parentScopes);
  for (const scope of childScopes) {
    if (!parent.has(scope)) {
      throw new ScopeEscalationDeniedError(scope);
    }
  }
}

export async function buildDelegationVC(
  options: DelegateOptions,
  wallet: { did: string; privateKeyHex: string },
): Promise<SignedVC> {
  assertAgentVC(options.fromVC);
  const parentSubject = options.fromVC.credentialSubject;
  const parentDepth = parentSubject.delegationDepth ?? 0;
  const maxDepth = parentSubject.maxDelegationDepth ?? 0;

  assertSubset(parentSubject.privilegeScopes, options.scopes);
  if (parentDepth + 1 > maxDepth) {
    throw new MaxDelegationDepthExceededError();
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + options.expiresIn * 1000);
  const parentChain = options.fromVC.delegationChain ?? [];
  const payload = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: `vc:helix:delegation:${randomUUID()}`,
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: wallet.did,
    validFrom: now.toISOString(),
    validUntil: expiresAt.toISOString(),
    credentialSubject: {
      id: options.to,
      type: 'HelixAgent' as const,
      privilegeScopes: options.scopes,
      agentName: options.to,
      delegatedFrom: wallet.did,
      delegationDepth: parentDepth + 1,
      maxDelegationDepth: maxDepth,
      parentVcId: options.fromVC.id,
    },
    delegationChain: [...parentChain, options.fromVC],
  };

  return {
    ...payload,
    proof: await createEd25519Proof(payload, wallet.privateKeyHex, `${wallet.did}#key-1`),
  };
}
