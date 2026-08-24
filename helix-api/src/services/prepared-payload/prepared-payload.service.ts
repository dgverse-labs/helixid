// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Implements the "prepare"/"finalize" split from docs/proposal-sdk-api-only.md:
// the API constructs the unsigned VC payload (the highest-drift-risk logic if
// every SDK reimplemented it), the client signs the returned hash with its
// own private key — which never leaves the client — and finalize() attaches
// that signature to produce the final SignedVC.
//
// prepareDelegation()/finalizeDelegation() port helix-core's
// buildDelegationVC() payload construction (delegation.ts) minus the signing
// step. prepareGrant()/finalizeGrant() do the same for issueGrant()
// (grant.ts). Both are mechanical, faithful ports — the JSON shape here must
// match helix-core's exactly, since that's what the client's local
// hashCanonicalPayload()/signData() will be hashing and signing against.

import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  HelixError,
  MaxDelegationDepthExceededError,
  MaxRenewalCountExceededError,
  PreparedPayloadAlreadyConsumedError,
  PreparedPayloadExpiredError,
  PreparedPayloadNotFoundError,
  PreparedPayloadPurposeMismatchError,
  PreparedPayloadSignatureInvalidError,
  RenewalWindowExpiredError,
  RenewalWindowNotOpenError,
  VCMissingCredentialStatusError,
  VCRevokedError,
  VC_CONTEXTS,
  base58btcEncode,
  getBit,
  getStatusListLength,
  hashCanonicalPayload,
  resolveDID as resolveDIDCore,
  validateScopeSubset,
  verifySignature,
  type SignedVC,
} from '@helixid/core';
import type {
  FinalizeInput,
  IPreparedPayloadService,
  PrepareAgentRenewalInput,
  PrepareDelegationInput,
  PrepareGrantInput,
  PrepareResult,
} from './IPreparedPayloadService.js';
import type {
  PreparedPayloadRecord,
  PreparedPayloadRepository,
} from '../../repositories/prepared-payload.repository.js';
import type { IDIDService } from '../did/did.service.js';
import { extractEd25519PublicKeyHexFromDIDDocument } from '../did/publicKey.js';

const PREPARE_TTL_SECONDS = 5 * 60;

// Renewal policy (see docs/proposal-sdk-api-only.md's "renewal" scope and the
// design discussion it links to). Configurable knobs, not hardcoded forever —
// revisit alongside Item #1 (hosted instance) if enterprise tenants need
// different values per plan/tier.
const RENEWAL_WINDOW_FRACTION = 0.8; // window opens at 80% of validity elapsed
const RENEWAL_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h after validUntil
const MAX_RENEWAL_COUNT = 5; // beyond this, require fresh issuance

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export class PreparedPayloadService implements IPreparedPayloadService {
  constructor(
    private readonly repository: PreparedPayloadRepository,
    private readonly didService: IDIDService,
  ) {}

  // -- delegation ------------------------------------------------------

  async prepareDelegation(input: PrepareDelegationInput): Promise<PrepareResult> {
    const parentSubject = input.fromVC.credentialSubject as {
      privilegeScopes?: unknown;
      delegationDepth?: number;
      maxDelegationDepth?: number;
    };
    if (!Array.isArray(parentSubject.privilegeScopes)) {
      throw new HelixError(
        ErrorCode.VALIDATION_ERROR,
        'fromVC has no privilege scopes to delegate from',
        400,
      );
    }
    const parentDepth = parentSubject.delegationDepth ?? 0;
    const maxDepth = parentSubject.maxDelegationDepth ?? 0;

    validateScopeSubset(parentSubject.privilegeScopes as string[], input.scopes);
    if (parentDepth + 1 > maxDepth) {
      throw new MaxDelegationDepthExceededError();
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.expiresIn * 1000);
    const parentChain =
      (input.fromVC as unknown as { delegationChain?: SignedVC[] }).delegationChain ?? [];

    // Mirrors helix-core/src/delegation.ts buildDelegationVC() payload
    // construction exactly, minus the `proof` field.
    const payload = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
      id: `vc:helix:delegation:${randomUUID()}`,
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: input.delegatorDid,
      validFrom: now.toISOString(),
      validUntil: expiresAt.toISOString(),
      credentialSubject: {
        id: input.to,
        type: 'HelixAgent' as const,
        privilegeScopes: input.scopes,
        agentName: input.to,
        delegatedFrom: input.delegatorDid,
        delegationDepth: parentDepth + 1,
        maxDelegationDepth: maxDepth,
        parentVcId: input.fromVC.id,
      },
      delegationChain: [...parentChain, input.fromVC],
    };

    return this.store('delegation', payload, input.delegatorDid);
  }

  async finalizeDelegation(input: FinalizeInput): Promise<SignedVC> {
    return this.finalize('delegation', input);
  }

  // -- grant -------------------------------------------------------------

  async prepareGrant(input: PrepareGrantInput): Promise<PrepareResult> {
    const listLength = getStatusListLength(input.statusList.credentialSubject.encodedList);
    // Random assignment, same accepted-collision-risk approach as
    // helix-core/src/grant.ts issueGrant() (see epic Part E / register D9).
    const index = Math.floor(Math.random() * listLength);

    const now = new Date();
    const STANDING_GRANT_VALID_MS = 10 * 365 * 24 * 60 * 60 * 1000;
    const SESSION_GRANT_VALID_MS = 24 * 60 * 60 * 1000;
    const validMs = input.durability === 'standing' ? STANDING_GRANT_VALID_MS : SESSION_GRANT_VALID_MS;

    const payload = {
      '@context': [...VC_CONTEXTS],
      id: `vc:helix:grant:${randomUUID()}`,
      type: ['VerifiableCredential', 'DelegationGrantCredential'],
      issuer: input.issuerDid,
      validFrom: now.toISOString(),
      validUntil: new Date(now.getTime() + validMs).toISOString(),
      credentialStatus: {
        id: `${input.statusListCredentialUrl}#${index}`,
        type: 'BitstringStatusListEntry' as const,
        statusPurpose: 'revocation' as const,
        statusListIndex: index.toString(),
        statusListCredential: input.statusListCredentialUrl,
      },
      credentialSubject: {
        id: input.agentDid,
        type: 'DelegationGrant' as const,
        userDid: input.userDid,
        scopes: input.scopes,
        durability: input.durability,
        ...(input.serviceDid !== undefined ? { serviceDid: input.serviceDid } : {}),
      },
    };

    return this.store('grant', payload, input.issuerDid);
  }

  async finalizeGrant(input: FinalizeInput): Promise<SignedVC> {
    return this.finalize('grant', input);
  }

  // -- agent-renewal -------------------------------------------------------
  //
  // Renewal is issuance-repeated-on-a-timer: same signer (issuer) as the VC
  // being renewed, same subject, optionally-narrower scopes, fresh validity
  // window. Standard credential-renewal hygiene, checks 1-3 below (4 is the
  // finalize signature check itself; 5 is the existing audit logger, wired
  // at the route/server level like every other mutating endpoint):
  //   1. currentVC must not be revoked
  //   2. renewed scopes must be a subset of currentVC's scopes (no widening)
  //   3. renewal must fall inside the renewal window: opens once
  //      RENEWAL_WINDOW_FRACTION of currentVC's validity has elapsed, closes
  //      RENEWAL_GRACE_PERIOD_MS after currentVC.validUntil. Outside that
  //      window (too early, or too long expired) a fresh issuance is
  //      required instead — renewal isn't a way to indefinitely extend trust
  //      without ever re-touching the original issuance path.
  //   Also caps total renewals per lineage (MAX_RENEWAL_COUNT) for the same
  //   reason: an indefinitely-renewable credential drifts further from its
  //   original (self-signed, not CA-verified) issuance over time.

  async prepareAgentRenewal(input: PrepareAgentRenewalInput): Promise<PrepareResult> {
    const subject = input.currentVC.credentialSubject as {
      privilegeScopes?: unknown;
      renewalCount?: number;
    };
    if (!Array.isArray(subject.privilegeScopes)) {
      throw new HelixError(ErrorCode.VALIDATION_ERROR, 'currentVC has no privilege scopes', 400);
    }

    const credentialStatus = (
      input.currentVC as unknown as {
        credentialStatus?: { statusListIndex: string };
      }
    ).credentialStatus;
    if (!credentialStatus) {
      throw new VCMissingCredentialStatusError();
    }

    // 1. not revoked
    const currentIndex = Number(credentialStatus.statusListIndex);
    const bit = getBit(input.statusList.credentialSubject.encodedList, currentIndex);
    if (bit === 1) {
      throw new VCRevokedError();
    }

    // 2. scope ceiling — renewal may narrow, never widen
    const requestedScopes = input.scopes ?? (subject.privilegeScopes as string[]);
    validateScopeSubset(subject.privilegeScopes as string[], requestedScopes);

    // 3. renewal window
    const validFrom = new Date(
      (input.currentVC as unknown as { validFrom: string }).validFrom,
    ).getTime();
    const validUntil = new Date(
      (input.currentVC as unknown as { validUntil: string }).validUntil,
    ).getTime();
    const now = Date.now();
    const totalValidityMs = validUntil - validFrom;
    const windowOpensAt = validFrom + RENEWAL_WINDOW_FRACTION * totalValidityMs;
    const windowClosesAt = validUntil + RENEWAL_GRACE_PERIOD_MS;
    if (now < windowOpensAt) {
      throw new RenewalWindowNotOpenError(
        `Renewal window opens at ${new Date(windowOpensAt).toISOString()}`,
      );
    }
    if (now > windowClosesAt) {
      throw new RenewalWindowExpiredError();
    }

    // renewal count cap
    const renewalCount = subject.renewalCount ?? 0;
    if (renewalCount >= MAX_RENEWAL_COUNT) {
      throw new MaxRenewalCountExceededError();
    }

    const listLength = getStatusListLength(input.statusList.credentialSubject.encodedList);
    const newIndex = Math.floor(Math.random() * listLength);
    const newValidFrom = new Date();
    const newValidUntil = new Date(newValidFrom.getTime() + input.expiresIn * 1000);

    // Mirrors helix-core/src/self-signed.ts selfIssueVC() payload shape,
    // minus the `proof`, plus renewal bookkeeping.
    const payload = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
      id: `vc:helix:self:${randomUUID()}`,
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: input.currentVC.issuer,
      validFrom: newValidFrom.toISOString(),
      validUntil: newValidUntil.toISOString(),
      credentialStatus: {
        id: `${input.statusListCredentialUrl}#${newIndex}`,
        type: 'BitstringStatusListEntry' as const,
        statusPurpose: 'revocation' as const,
        statusListIndex: newIndex.toString(),
        statusListCredential: input.statusListCredentialUrl,
      },
      credentialSubject: {
        ...(input.currentVC.credentialSubject as Record<string, unknown>),
        privilegeScopes: requestedScopes,
        renewalCount: renewalCount + 1,
        renewedFrom: input.currentVC.id,
      },
    };

    return this.store('agent-renewal', payload, input.currentVC.issuer as string);
  }

  async finalizeAgentRenewal(input: FinalizeInput): Promise<SignedVC> {
    return this.finalize('agent-renewal', input);
  }

  // -- shared prepare/finalize plumbing -----------------------------------

  private async store(
    purpose: 'delegation' | 'grant' | 'agent-renewal',
    payload: Record<string, unknown>,
    expectedSignerDid: string,
  ): Promise<PrepareResult> {
    const canonicalHash = toHex(hashCanonicalPayload(payload));
    const expiresAt = new Date(Date.now() + PREPARE_TTL_SECONDS * 1000);

    const record = await this.repository.create({
      purpose,
      unsignedPayload: JSON.stringify(payload),
      canonicalHash,
      expectedSignerDid,
      expiresAt,
    });

    return {
      token: record.token,
      unsignedPayload: payload,
      canonicalHash,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async finalize(
    purpose: 'delegation' | 'grant' | 'agent-renewal',
    input: FinalizeInput,
  ): Promise<SignedVC> {
    const record = await this.repository.findByToken(input.token);
    this.assertUsable(record, purpose);

    // verificationMethod is expected to be `${did}#fragment`; the DID must
    // match whoever this payload was prepared for.
    const signerDid = input.verificationMethod.split('#')[0] ?? '';
    if (signerDid !== record!.expectedSignerDid) {
      throw new PreparedPayloadSignatureInvalidError(
        'verificationMethod does not match the DID this payload was prepared for',
      );
    }

    const publicKeyHex = await this.resolveEd25519PublicKeyHex(signerDid);
    const hashBytes = Buffer.from(record!.canonicalHash, 'hex');
    const isValid = await verifySignature(hashBytes, input.signatureHex, publicKeyHex);
    if (!isValid) {
      throw new PreparedPayloadSignatureInvalidError();
    }

    const consumed = await this.repository.markConsumedAtomically(input.token);
    if (!consumed) {
      // Lost a race with a concurrent finalize call against the same token.
      throw new PreparedPayloadAlreadyConsumedError();
    }

    const payload = JSON.parse(record!.unsignedPayload) as Record<string, unknown>;
    return {
      ...payload,
      proof: {
        type: 'Ed25519Signature2020',
        created: input.proofCreatedAt ?? new Date().toISOString(),
        verificationMethod: input.verificationMethod,
        proofPurpose: 'assertionMethod',
        proofValue: base58btcEncode(Buffer.from(input.signatureHex, 'hex')),
      },
    } as unknown as SignedVC;
  }

  private assertUsable(
    record: PreparedPayloadRecord | null,
    purpose: 'delegation' | 'grant' | 'agent-renewal',
  ): asserts record is PreparedPayloadRecord {
    if (!record) {
      throw new PreparedPayloadNotFoundError();
    }
    if (record.purpose !== purpose) {
      throw new PreparedPayloadPurposeMismatchError();
    }
    if (record.consumedAt) {
      throw new PreparedPayloadAlreadyConsumedError();
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new PreparedPayloadExpiredError();
    }
  }

  private async resolveEd25519PublicKeyHex(did: string): Promise<string> {
    try {
      const document = await this.didService.resolveDID(did, 'req_prepare_finalize');
      return extractEd25519PublicKeyHexFromDIDDocument(document);
    } catch (err: unknown) {
      if (err instanceof HelixError && err.code === ErrorCode.DID_NOT_FOUND) {
        const document = await resolveDIDCore(did);
        return extractEd25519PublicKeyHexFromDIDDocument(document);
      }
      throw err;
    }
  }
}
