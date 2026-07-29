import { getBit } from './status-list/index.js';
import { StatusListCredentialSchema } from './status-list/schema.js';
import { resolveDID } from './did-resolver.js';
import { verifyEd25519Proof } from './proof.js';
import {
  DelegationChainInvalidError,
  SelfSignedVCNotAllowedError,
  VCExpiredError,
  VCNotYetValidError,
  VCRevokedError,
  VCSignatureInvalidError,
  VPExpiredError,
  VPInvalidStructureError,
  VPSignatureInvalidError,
} from './errors/HelixError.js';
import type { DelegationLink } from './delegation.js';
import type { SignedVC } from './schemas/vc.js';
import type { SignedVP } from './schemas/vp.js';

export interface VerifyVPOptions {
  expectedTargetService?: string;
  allowSelfSigned?: boolean;
}

export interface VerifyVPResult {
  valid: boolean;
  agentDid: string;
  privilegeScopes: string[];
  vpId: string;
  delegationChain: DelegationLink[];
  warning?: string;
  error?: string;
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
  targetService?: string;
};

function withoutProof<T extends { proof?: unknown }>(value: T): Omit<T, 'proof'> {
  const { proof, ...payload } = value;
  return payload;
}

function assertAgentVC(vc: SignedVC): asserts vc is AgentSignedVC {
  const subject = vc.credentialSubject as { privilegeScopes?: unknown };
  if (!Array.isArray(subject.privilegeScopes)) {
    throw new VPInvalidStructureError('VC does not contain agent privilege scopes');
  }
}

function assertSubset(parentScopes: string[], childScopes: string[]): void {
  const parent = new Set(parentScopes);
  const denied = childScopes.find((scope) => !parent.has(scope));
  if (denied) {
    throw new DelegationChainInvalidError(`scope escalation: ${denied}`);
  }
}

function toDelegationLink(vc: AgentSignedVC): DelegationLink {
  return {
    issuer: vc.issuer,
    subject: vc.credentialSubject.id,
    vcId: vc.id,
    scopes: vc.credentialSubject.privilegeScopes,
    delegationDepth: vc.credentialSubject.delegationDepth ?? 0,
  };
}

async function verifyVCSignature(vc: SignedVC): Promise<void> {
  const issuerDoc = await resolveDID(vc.issuer);
  const valid = await verifyEd25519Proof(
    withoutProof(vc) as Record<string, unknown>,
    vc.proof,
    issuerDoc,
  );
  if (!valid) {
    throw new VCSignatureInvalidError();
  }
}

function verifyValidityWindow(vc: SignedVC): void {
  const now = Date.now();
  if (new Date(vc.validFrom).getTime() > now) {
    throw new VCNotYetValidError();
  }
  if (new Date(vc.validUntil).getTime() <= now) {
    throw new VCExpiredError();
  }
}

async function verifyRevocation(vc: SignedVC): Promise<void> {
  // Delegated children normally omit credentialStatus and inherit revocation
  // from the status-bearing ancestors verified as part of their chain.
  if (!vc.credentialStatus) return;
  const response = await fetch(vc.credentialStatus.statusListCredential, {
    headers: { accept: 'application/vc+json, application/json' },
  });
  if (!response.ok) {
    throw new VCRevokedError('Unable to verify credential revocation status');
  }
  // Fail closed: a fetched list that is not valid JSON or does not match the
  // shared StatusListCredential shape is treated as revoked/untrusted, never
  // trusted for getBit(). Applies equally to helix-api- and SP-hosted lists.
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new VCRevokedError('Status list response is not valid JSON');
  }
  const parsed = StatusListCredentialSchema.safeParse(json);
  if (!parsed.success) {
    throw new VCRevokedError('Status list credential failed schema validation');
  }
  const index = Number(vc.credentialStatus.statusListIndex);
  if (!Number.isInteger(index) || getBit(parsed.data.credentialSubject.encodedList, index) === 1) {
    throw new VCRevokedError();
  }
}

async function verifyCredential(vc: SignedVC, options: VerifyVPOptions): Promise<string | undefined> {
  await verifyVCSignature(vc);
  verifyValidityWindow(vc);

  const selfSigned = vc.issuer === vc.credentialSubject.id;
  if (selfSigned && !options.allowSelfSigned) {
    throw new SelfSignedVCNotAllowedError();
  }
  if (!selfSigned || vc.credentialStatus) {
    await verifyRevocation(vc);
  }
  return selfSigned ? 'self-signed credential, not trusted in production' : undefined;
}

async function verifyDelegationChain(leaf: AgentSignedVC, options: VerifyVPOptions): Promise<DelegationLink[]> {
  if (!leaf.credentialSubject.delegatedFrom) {
    return [toDelegationLink(leaf)];
  }
  const chain = [...(leaf.delegationChain ?? []), leaf];
  if (chain.length < 2) {
    throw new DelegationChainInvalidError('delegated credential is missing its parent chain');
  }

  for (const vc of chain) {
    await verifyCredential(vc, options);
    assertAgentVC(vc);
  }

  const root = chain[0] as AgentSignedVC;
  if (root.issuer === root.credentialSubject.id) {
    throw new DelegationChainInvalidError('delegation root must be signed by a trusted issuer DID');
  }
  if ((root.credentialSubject.delegationDepth ?? 0) !== 0) {
    throw new DelegationChainInvalidError('root credential depth must be 0');
  }
  const maxDepth = root.credentialSubject.maxDelegationDepth ?? 0;

  for (let index = 1; index < chain.length; index += 1) {
    const parent = chain[index - 1] as AgentSignedVC;
    const child = chain[index] as AgentSignedVC;
    if (child.issuer !== parent.credentialSubject.id) {
      throw new DelegationChainInvalidError('child issuer does not match parent subject DID');
    }
    if (child.credentialSubject.delegatedFrom !== parent.credentialSubject.id) {
      throw new DelegationChainInvalidError('delegatedFrom does not match parent subject DID');
    }
    if (child.credentialSubject.parentVcId !== parent.id) {
      throw new DelegationChainInvalidError('parentVcId does not match parent VC id');
    }
    if (child.credentialSubject.delegationDepth !== index) {
      throw new DelegationChainInvalidError('delegationDepth values are not sequential');
    }
    if (child.credentialSubject.maxDelegationDepth !== maxDepth) {
      throw new DelegationChainInvalidError('maxDelegationDepth changed inside the chain');
    }
    if ((child.credentialSubject.delegationDepth ?? 0) > maxDepth) {
      throw new DelegationChainInvalidError('leaf delegationDepth exceeds root maxDelegationDepth');
    }
    assertSubset(parent.credentialSubject.privilegeScopes, child.credentialSubject.privilegeScopes);
  }

  return chain.map((vc) => toDelegationLink(vc as AgentSignedVC));
}

export async function verifyVP(
  vp: SignedVP,
  options: VerifyVPOptions = {},
): Promise<VerifyVPResult> {
  if (new Date(vp.expirationDate).getTime() <= Date.now()) {
    throw new VPExpiredError();
  }
  if (options.expectedTargetService && vp.targetService !== options.expectedTargetService) {
    throw new VPInvalidStructureError('VP targetService does not match expected target service');
  }

  const holderDoc = await resolveDID(vp.holder);
  const vpSignatureValid = await verifyEd25519Proof(
    withoutProof(vp) as Record<string, unknown>,
    vp.proof,
    holderDoc,
  );
  if (!vpSignatureValid) {
    throw new VPSignatureInvalidError();
  }

  const vc = vp.verifiableCredential[0] as SignedVC | undefined;
  if (!vc?.proof) {
    throw new VPInvalidStructureError('VP does not contain a signed VC');
  }
  assertAgentVC(vc);
  if (vc.targetService && vc.targetService !== vp.targetService) {
    throw new VPInvalidStructureError('VC targetService does not match VP targetService');
  }

  // Delegated credentials are verified once as a complete chain so that a
  // status-less child inherits revocation from its status-bearing ancestors.
  // Non-delegated credentials continue to verify their own status directly.
  const warning = vc.credentialSubject.delegatedFrom
    ? undefined
    : await verifyCredential(vc, options);
  const delegationChain = await verifyDelegationChain(vc, options);

  const result: VerifyVPResult = {
    valid: true,
    agentDid: vc.credentialSubject.id,
    privilegeScopes: vc.credentialSubject.privilegeScopes,
    vpId: vp.id,
    delegationChain,
  };
  if (warning) {
    result.warning = warning;
  }
  return result;
}
