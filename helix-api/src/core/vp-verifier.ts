import { getBit, type StatusListCredential } from './status-list/index.js';
import { StatusListCredentialSchema } from './status-list/schema.js';
import { resolveDID } from './did-resolver.js';
import { verifyEd25519Proof } from './proof.js';
import {
  ConsentGrantInvalidError,
  ConsentGrantSubjectMismatchError,
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
import { DelegationGrantVCSchema, type DelegationGrantVC } from './schemas/delegation-grant.js';
import type { DelegationLink } from './delegation.js';
import type { SignedVC } from './schemas/vc.js';
import type { SignedVP } from './schemas/vp.js';

/**
 * Resolves a status-list URL to its credential JSON. The default resolver
 * fetches over HTTP; helix-api injects one that reads its own locally-hosted
 * lists from its repository and falls back to HTTP for everything else.
 * Whatever the resolver returns is still schema-validated before use.
 */
export type StatusListResolver = (statusListUrl: string) => Promise<StatusListCredential>;

export interface VerifyVPOptions {
  expectedTargetService?: string;
  allowSelfSigned?: boolean;
  statusListResolver?: StatusListResolver;
}

export interface VerifyVPResult {
  valid: boolean;
  agentDid: string;
  privilegeScopes: string[];
  /**
   * Enforcement scopes: equals privilegeScopes when no consent grant is
   * present; the intersection of privilegeScopes and the grant's scopes when
   * one is. checkScope()/requireScope() read this field.
   */
  effectiveScopes: string[];
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

type GrantSignedVC = DelegationGrantVC & { proof: NonNullable<DelegationGrantVC['proof']> };

function withoutProof<T extends { proof?: unknown }>(value: T): Omit<T, 'proof'> {
  const { proof, ...payload } = value;
  return payload;
}

function isAgentAuthorityType(vc: SignedVC): boolean {
  return Array.isArray(vc.type) && (vc.type as string[]).includes('HelixAgentCredential');
}

function isGrantType(vc: SignedVC): boolean {
  return Array.isArray(vc.type) && (vc.type as string[]).includes('DelegationGrantCredential');
}

function assertAgentVC(vc: SignedVC): asserts vc is AgentSignedVC {
  const subject = vc.credentialSubject as { privilegeScopes?: unknown };
  if (!Array.isArray(subject.privilegeScopes)) {
    throw new VPInvalidStructureError('VC does not contain agent privilege scopes');
  }
}

function assertGrantVC(vc: SignedVC): asserts vc is GrantSignedVC {
  // Structural validation runs BEFORE the signature check (§9.3 G12) — a
  // malformed grant must never reach DID resolution or proof verification.
  const parsed = DelegationGrantVCSchema.safeParse(vc);
  if (!parsed.success) {
    throw new ConsentGrantInvalidError();
  }
  // proof is optional in the zod schema (pre-existing pattern) — an unsigned
  // grant is structurally invalid for verification purposes.
  if (!vc.proof) {
    throw new ConsentGrantInvalidError('Consent grant credential is missing its proof');
  }
}

function assertSubset(parentScopes: string[], childScopes: string[]): void {
  const parent = new Set(parentScopes);
  const denied = childScopes.find((scope) => !parent.has(scope));
  if (denied) {
    throw new DelegationChainInvalidError(`scope escalation: ${denied}`);
  }
}

function intersect(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((scope) => rightSet.has(scope));
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

/**
 * The default resolver: plain HTTP fetch. Exported so injected resolvers
 * (helix-api's local-repo fast path) can delegate to it for URLs they do not
 * own.
 */
export async function fetchStatusList(statusListUrl: string): Promise<StatusListCredential> {
  const response = await fetch(statusListUrl, {
    headers: { accept: 'application/vc+json, application/json' },
  });
  if (!response.ok) {
    throw new VCRevokedError('Unable to verify credential revocation status');
  }
  try {
    return (await response.json()) as StatusListCredential;
  } catch {
    throw new VCRevokedError('Status list response is not valid JSON');
  }
}

async function verifyRevocation(vc: SignedVC, options: VerifyVPOptions): Promise<void> {
  // Delegated children normally omit credentialStatus and inherit revocation
  // from the status-bearing ancestors verified as part of their chain.
  if (!vc.credentialStatus) return;

  const resolveStatusList = options.statusListResolver ?? fetchStatusList;
  let raw: unknown;
  try {
    raw = await resolveStatusList(vc.credentialStatus.statusListCredential);
  } catch (error) {
    // Fail closed regardless of how the resolver failed; preserve the
    // revocation-path error class callers already handle.
    throw error instanceof VCRevokedError
      ? error
      : new VCRevokedError('Unable to verify credential revocation status');
  }

  // Fail closed: a list that does not match the shared StatusListCredential
  // shape is treated as revoked/untrusted, never trusted for getBit(). This
  // applies identically to the default HTTP path and any injected resolver.
  const parsed = StatusListCredentialSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VCRevokedError('Status list credential failed schema validation');
  }
  const index = Number(vc.credentialStatus.statusListIndex);
  if (!Number.isInteger(index)) {
    throw new VCRevokedError();
  }
  let bit: 0 | 1;
  try {
    bit = getBit(parsed.data.credentialSubject.encodedList, index);
  } catch {
    // Unreadable encodedList (bad base64/gzip, index out of bounds) — fail
    // closed instead of letting a plain Error escape verifyVP().
    throw new VCRevokedError('Status list entry could not be read');
  }
  if (bit === 1) {
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
    await verifyRevocation(vc, options);
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

  const entries = vp.verifiableCredential as SignedVC[];
  if (entries.length < 1 || entries.length > 2) {
    throw new VPInvalidStructureError('VP must carry 1 or 2 credentials');
  }

  const agentEntries = entries.filter(isAgentAuthorityType);
  const grantEntries = entries.filter(isGrantType);
  if (
    agentEntries.length !== 1 ||
    grantEntries.length > 1 ||
    agentEntries.length + grantEntries.length !== entries.length
  ) {
    throw new VPInvalidStructureError(
      'VP credential array must contain exactly one agent-authority credential and at most one consent grant',
    );
  }

  const vc = agentEntries[0] as SignedVC;
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

  let effectiveScopes = vc.credentialSubject.privilegeScopes;

  if (grantEntries.length === 1) {
    const grant = grantEntries[0] as SignedVC;
    assertGrantVC(grant);
    await verifyCredential(grant, options);

    const chainDids = delegationChain.map((link) => link.subject);
    const agentMatches =
      grant.credentialSubject.id === vp.holder || chainDids.includes(grant.credentialSubject.id);
    // Plain string equality — DID or email, either form (§2.6). A VP with no
    // delegatedBy at all can never satisfy the user-match rule (§9.3 G6).
    const userMatches = grant.credentialSubject.userDid === vp.delegatedBy;
    if (!agentMatches || !userMatches) {
      throw new ConsentGrantSubjectMismatchError();
    }

    effectiveScopes = intersect(effectiveScopes, grant.credentialSubject.scopes);
  }

  const result: VerifyVPResult = {
    valid: true,
    agentDid: vc.credentialSubject.id,
    privilegeScopes: vc.credentialSubject.privilegeScopes,
    effectiveScopes,
    vpId: vp.id,
    delegationChain,
  };
  if (warning) {
    result.warning = warning;
  }
  return result;
}
