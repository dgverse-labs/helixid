// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// End-to-end unit test of the prepare/finalize split from
// docs/proposal-sdk-api-only.md: the service builds the unsigned payload,
// the test plays the role of the SDK by signing the returned hash locally
// with a real Ed25519 key (never touching the service), then finalize()
// must accept that signature and return a fully signed VC.

import { describe, it, expect } from 'vitest';
import {
  DIDNotFoundError,
  buildDIDDocument,
  generateKeyPair,
  hashCanonicalPayload,
  publicKeyToMultibase,
  signData,
  createStatusList,
  setBit,
  buildStatusListCredential,
  MaxDelegationDepthExceededError,
  MaxRenewalCountExceededError,
  RenewalWindowNotOpenError,
  RenewalWindowExpiredError,
  ScopeEscalationDeniedError,
  VCRevokedError,
  VCMissingCredentialStatusError,
  PreparedPayloadNotFoundError,
  PreparedPayloadExpiredError,
  PreparedPayloadAlreadyConsumedError,
  PreparedPayloadPurposeMismatchError,
  PreparedPayloadSignatureInvalidError,
  type SignedVC,
} from '@helixid/core';
import { PreparedPayloadService } from '../../../src/services/prepared-payload/prepared-payload.service.js';
import { PreparedPayloadRepository } from '../../../src/repositories/prepared-payload.repository.js';
import type { IDIDService } from '../../../src/services/did/did.service.js';

function didKey(publicKeyHex: string): string {
  return `did:key:${publicKeyToMultibase(publicKeyHex)}`;
}

/** A "did:key" always looks unresolvable to the persisted-DID service, so
 * finalize() falls back to core (self-certifying) resolution — exactly the
 * path a real delegator/SP key takes. */
class AlwaysMissingDIDService implements Partial<IDIDService> {
  async resolveDID(did: string): Promise<never> {
    throw new DIDNotFoundError(did);
  }
}

function makeActor() {
  const keys = generateKeyPair();
  return { did: didKey(keys.publicKey), privateKeyHex: keys.privateKey, publicKeyHex: keys.publicKey };
}

async function signPrepareResult(privateKeyHex: string, canonicalHash: string): Promise<string> {
  return signData(Buffer.from(canonicalHash, 'hex'), privateKeyHex);
}

function makeService(): PreparedPayloadService {
  const repo = new PreparedPayloadRepository();
  const didService = new AlwaysMissingDIDService() as unknown as IDIDService;
  return new PreparedPayloadService(repo, didService);
}

function makeAgentVC(subjectDid: string, delegatedFrom?: string): SignedVC {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: 'vc:helix:agent:test-root',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: 'did:key:z6MkIssuerExample',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T23:59:59.000Z',
    credentialSubject: {
      id: subjectDid,
      type: 'HelixAgent',
      privilegeScopes: ['read:calendar', 'read:email'],
      agentName: 'root-agent',
      delegationDepth: 0,
      maxDelegationDepth: 2,
      ...(delegatedFrom ? { delegatedFrom } : {}),
    },
    proof: {
      type: 'Ed25519Signature2020',
      created: '2026-01-01T00:00:00.000Z',
      verificationMethod: 'did:key:z6MkIssuerExample#key-1',
      proofPurpose: 'assertionMethod',
      proofValue: 'zPlaceholder',
    },
  } as unknown as SignedVC;
}

/** A self-issued-style agent VC with a credentialStatus entry, at a given
 * point in its own validity lifecycle (fraction 0 = just issued, 1 = right
 * at expiry) — used to exercise the renewal-window check deterministically. */
function makeRenewableAgentVC(opts: {
  ownerDid: string;
  statusListIndex: number;
  elapsedFraction: number;
  validityMs?: number;
  renewalCount?: number;
}): SignedVC {
  const validityMs = opts.validityMs ?? 24 * 60 * 60 * 1000; // 24h, like selfIssueVC's default
  const validFrom = new Date(Date.now() - opts.elapsedFraction * validityMs);
  const validUntil = new Date(validFrom.getTime() + validityMs);
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: 'vc:helix:self:test-renewable',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: opts.ownerDid,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    credentialStatus: {
      id: `https://sp.example/status/1#${opts.statusListIndex}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: opts.statusListIndex.toString(),
      statusListCredential: 'https://sp.example/status/1',
    },
    credentialSubject: {
      id: opts.ownerDid,
      type: 'HelixAgent',
      privilegeScopes: ['read:calendar', 'read:email'],
      agentName: opts.ownerDid,
      delegationDepth: 0,
      maxDelegationDepth: 0,
      renewalCount: opts.renewalCount ?? 0,
    },
    evidence: [{ type: 'SelfSignedDevCredential', warning: 'Not for production use' }],
    proof: {
      type: 'Ed25519Signature2020',
      created: validFrom.toISOString(),
      verificationMethod: `${opts.ownerDid}#key-1`,
      proofPurpose: 'assertionMethod',
      proofValue: 'zPlaceholder',
    },
  } as unknown as SignedVC;
}

describe('PreparedPayloadService — delegation', () => {
  it('prepares a delegation payload whose hash matches hashCanonicalPayload of the returned payload', async () => {
    const service = makeService();
    const delegator = makeActor();
    const fromVC = makeAgentVC(delegator.did);

    const result = await service.prepareDelegation({
      delegatorDid: delegator.did,
      fromVC,
      to: 'did:key:z6MkChildAgentExample',
      scopes: ['read:calendar'],
      expiresIn: 3600,
    });

    expect(result.token).toBeTruthy();
    const rehashed = Buffer.from(hashCanonicalPayload(result.unsignedPayload)).toString('hex');
    expect(rehashed).toBe(result.canonicalHash);
    expect(result.unsignedPayload.issuer).toBe(delegator.did);
    expect((result.unsignedPayload.credentialSubject as { delegationDepth: number }).delegationDepth).toBe(1);
  });

  it('rejects scope escalation beyond the parent VC scopes', async () => {
    const service = makeService();
    const delegator = makeActor();
    const fromVC = makeAgentVC(delegator.did);

    await expect(
      service.prepareDelegation({
        delegatorDid: delegator.did,
        fromVC,
        to: 'did:key:z6MkChildAgentExample',
        scopes: ['admin:everything'],
        expiresIn: 3600,
      }),
    ).rejects.toBeInstanceOf(ScopeEscalationDeniedError);
  });

  it('rejects delegation beyond maxDelegationDepth', async () => {
    const service = makeService();
    const delegator = makeActor();
    const fromVC = makeAgentVC(delegator.did);
    (fromVC.credentialSubject as unknown as { delegationDepth: number }).delegationDepth = 2;
    (fromVC.credentialSubject as unknown as { maxDelegationDepth: number }).maxDelegationDepth = 2;

    await expect(
      service.prepareDelegation({
        delegatorDid: delegator.did,
        fromVC,
        to: 'did:key:z6MkChildAgentExample',
        scopes: ['read:calendar'],
        expiresIn: 3600,
      }),
    ).rejects.toBeInstanceOf(MaxDelegationDepthExceededError);
  });

  it('completes the full prepare -> sign -> finalize round trip', async () => {
    const service = makeService();
    const delegator = makeActor();
    const fromVC = makeAgentVC(delegator.did);

    const prepared = await service.prepareDelegation({
      delegatorDid: delegator.did,
      fromVC,
      to: 'did:key:z6MkChildAgentExample',
      scopes: ['read:calendar'],
      expiresIn: 3600,
    });

    const signatureHex = await signPrepareResult(delegator.privateKeyHex, prepared.canonicalHash);
    const signedVP = await service.finalizeDelegation({
      token: prepared.token,
      verificationMethod: `${delegator.did}#key-1`,
      signatureHex,
    });

    expect(signedVP.issuer).toBe(delegator.did);
    expect(signedVP.proof.proofPurpose).toBe('assertionMethod');
    expect(signedVP.proof.verificationMethod).toBe(`${delegator.did}#key-1`);
  });

  it('rejects finalize with a signature from the wrong key', async () => {
    const service = makeService();
    const delegator = makeActor();
    const impostor = makeActor();
    const fromVC = makeAgentVC(delegator.did);

    const prepared = await service.prepareDelegation({
      delegatorDid: delegator.did,
      fromVC,
      to: 'did:key:z6MkChildAgentExample',
      scopes: ['read:calendar'],
      expiresIn: 3600,
    });

    const badSignature = await signPrepareResult(impostor.privateKeyHex, prepared.canonicalHash);
    await expect(
      service.finalizeDelegation({
        token: prepared.token,
        // verificationMethod claims to be the delegator, but the signature
        // was produced by a different key.
        verificationMethod: `${delegator.did}#key-1`,
        signatureHex: badSignature,
      }),
    ).rejects.toBeInstanceOf(PreparedPayloadSignatureInvalidError);
  });

  it('rejects finalize when verificationMethod DID does not match the expected signer', async () => {
    const service = makeService();
    const delegator = makeActor();
    const impostor = makeActor();
    const fromVC = makeAgentVC(delegator.did);

    const prepared = await service.prepareDelegation({
      delegatorDid: delegator.did,
      fromVC,
      to: 'did:key:z6MkChildAgentExample',
      scopes: ['read:calendar'],
      expiresIn: 3600,
    });

    const signatureHex = await signPrepareResult(impostor.privateKeyHex, prepared.canonicalHash);
    await expect(
      service.finalizeDelegation({
        token: prepared.token,
        verificationMethod: `${impostor.did}#key-1`,
        signatureHex,
      }),
    ).rejects.toBeInstanceOf(PreparedPayloadSignatureInvalidError);
  });

  it('rejects finalize on an unknown token', async () => {
    const service = makeService();
    await expect(
      service.finalizeDelegation({
        token: 'nope',
        verificationMethod: 'did:key:z6MkSomeone#key-1',
        signatureHex: 'ab',
      }),
    ).rejects.toBeInstanceOf(PreparedPayloadNotFoundError);
  });

  it('rejects a second finalize against an already-consumed token', async () => {
    const service = makeService();
    const delegator = makeActor();
    const fromVC = makeAgentVC(delegator.did);

    const prepared = await service.prepareDelegation({
      delegatorDid: delegator.did,
      fromVC,
      to: 'did:key:z6MkChildAgentExample',
      scopes: ['read:calendar'],
      expiresIn: 3600,
    });
    const signatureHex = await signPrepareResult(delegator.privateKeyHex, prepared.canonicalHash);

    await service.finalizeDelegation({
      token: prepared.token,
      verificationMethod: `${delegator.did}#key-1`,
      signatureHex,
    });

    await expect(
      service.finalizeDelegation({
        token: prepared.token,
        verificationMethod: `${delegator.did}#key-1`,
        signatureHex,
      }),
    ).rejects.toBeInstanceOf(PreparedPayloadAlreadyConsumedError);
  });

  it('rejects finalizing a delegation token against the grant endpoint', async () => {
    const service = makeService();
    const delegator = makeActor();
    const fromVC = makeAgentVC(delegator.did);

    const prepared = await service.prepareDelegation({
      delegatorDid: delegator.did,
      fromVC,
      to: 'did:key:z6MkChildAgentExample',
      scopes: ['read:calendar'],
      expiresIn: 3600,
    });
    const signatureHex = await signPrepareResult(delegator.privateKeyHex, prepared.canonicalHash);

    await expect(
      service.finalizeGrant({
        token: prepared.token,
        verificationMethod: `${delegator.did}#key-1`,
        signatureHex,
      }),
    ).rejects.toBeInstanceOf(PreparedPayloadPurposeMismatchError);
  });

  it('rejects finalize after the prepare token has expired', async () => {
    const service = makeService();
    const delegator = makeActor();
    const fromVC = makeAgentVC(delegator.did);

    // expiresIn only controls the *delegation VC's* validity window, not the
    // prepare token's 5-minute TTL — so to exercise expiry we reach into the
    // repository directly rather than waiting 5 real minutes.
    const prepared = await service.prepareDelegation({
      delegatorDid: delegator.did,
      fromVC,
      to: 'did:key:z6MkChildAgentExample',
      scopes: ['read:calendar'],
      expiresIn: 3600,
    });

    const repo = (service as unknown as { repository: PreparedPayloadRepository }).repository;
    const record = await repo.findByToken(prepared.token);
    expect(record).not.toBeNull();
    // Simulate expiry by creating a fresh repository row with the same
    // shape but an already-past expiresAt, and pointing a fresh service at it.
    const expiredRepo = new PreparedPayloadRepository();
    const expiredResult = await expiredRepo.create({
      purpose: 'delegation',
      unsignedPayload: JSON.stringify(prepared.unsignedPayload),
      canonicalHash: prepared.canonicalHash,
      expectedSignerDid: delegator.did,
      expiresAt: new Date(Date.now() - 1000),
    });
    const expiredService = new PreparedPayloadService(
      expiredRepo,
      new AlwaysMissingDIDService() as unknown as IDIDService,
    );
    const signatureHex = await signPrepareResult(delegator.privateKeyHex, prepared.canonicalHash);
    await expect(
      expiredService.finalizeDelegation({
        token: expiredResult.token,
        verificationMethod: `${delegator.did}#key-1`,
        signatureHex,
      }),
    ).rejects.toBeInstanceOf(PreparedPayloadExpiredError);
  });
});

describe('PreparedPayloadService — grant', () => {
  it('completes the full prepare -> sign -> finalize round trip', async () => {
    const service = makeService();
    const issuer = makeActor();
    const statusList = buildStatusListCredential(
      'sp-status-list-1',
      createStatusList(),
      issuer.did,
      'https://sp.example',
    );

    const prepared = await service.prepareGrant({
      issuerDid: issuer.did,
      agentDid: 'did:key:z6MkAgentExample',
      userDid: 'did:key:z6MkUserExample',
      scopes: ['read:calendar'],
      durability: 'standing',
      statusList,
      statusListCredentialUrl: 'https://sp.example/status/1',
    });

    const signatureHex = await signPrepareResult(issuer.privateKeyHex, prepared.canonicalHash);
    const grantVC = await service.finalizeGrant({
      token: prepared.token,
      verificationMethod: `${issuer.did}#key-1`,
      signatureHex,
    });

    expect(grantVC.issuer).toBe(issuer.did);
    expect((grantVC as unknown as { type: string[] }).type).toContain('DelegationGrantCredential');
    expect(grantVC.proof.verificationMethod).toBe(`${issuer.did}#key-1`);
  });
});

describe('PreparedPayloadService — agent-renewal', () => {
  function statusListWith(index: number, revoked: boolean) {
    let encodedList = createStatusList();
    if (revoked) encodedList = setBit(encodedList, index, 1);
    return buildStatusListCredential('sp-status-list-1', encodedList, 'did:key:z6MkIssuerExample', 'https://sp.example');
  }

  it('rejects renewal when currentVC has no credentialStatus', async () => {
    const service = makeService();
    const owner = makeActor();
    const currentVC = makeAgentVC(owner.did); // no credentialStatus field
    const statusList = statusListWith(0, false);

    await expect(
      service.prepareAgentRenewal({
        currentVC,
        statusList,
        statusListCredentialUrl: 'https://sp.example/status/1',
        expiresIn: 3600,
      }),
    ).rejects.toBeInstanceOf(VCMissingCredentialStatusError);
  });

  it('rejects renewal of a revoked VC', async () => {
    const service = makeService();
    const owner = makeActor();
    const currentVC = makeRenewableAgentVC({ ownerDid: owner.did, statusListIndex: 5, elapsedFraction: 0.9 });
    const statusList = statusListWith(5, true); // revoked

    await expect(
      service.prepareAgentRenewal({
        currentVC,
        statusList,
        statusListCredentialUrl: 'https://sp.example/status/1',
        expiresIn: 3600,
      }),
    ).rejects.toBeInstanceOf(VCRevokedError);
  });

  it('rejects renewal requested too early (window not open)', async () => {
    const service = makeService();
    const owner = makeActor();
    // Only 10% elapsed; window opens at 80%.
    const currentVC = makeRenewableAgentVC({ ownerDid: owner.did, statusListIndex: 1, elapsedFraction: 0.1 });
    const statusList = statusListWith(1, false);

    await expect(
      service.prepareAgentRenewal({
        currentVC,
        statusList,
        statusListCredentialUrl: 'https://sp.example/status/1',
        expiresIn: 3600,
      }),
    ).rejects.toBeInstanceOf(RenewalWindowNotOpenError);
  });

  it('rejects renewal requested long after expiry (grace period passed)', async () => {
    const service = makeService();
    const owner = makeActor();
    // elapsedFraction > 1 puts validUntil in the past beyond the 24h grace window.
    const currentVC = makeRenewableAgentVC({
      ownerDid: owner.did,
      statusListIndex: 2,
      elapsedFraction: 3, // validFrom = now - 3*24h, validUntil = now - 2*24h
    });
    const statusList = statusListWith(2, false);

    await expect(
      service.prepareAgentRenewal({
        currentVC,
        statusList,
        statusListCredentialUrl: 'https://sp.example/status/1',
        expiresIn: 3600,
      }),
    ).rejects.toBeInstanceOf(RenewalWindowExpiredError);
  });

  it('rejects renewal requesting scopes beyond the current VC', async () => {
    const service = makeService();
    const owner = makeActor();
    const currentVC = makeRenewableAgentVC({ ownerDid: owner.did, statusListIndex: 3, elapsedFraction: 0.9 });
    const statusList = statusListWith(3, false);

    await expect(
      service.prepareAgentRenewal({
        currentVC,
        statusList,
        statusListCredentialUrl: 'https://sp.example/status/1',
        expiresIn: 3600,
        scopes: ['admin:everything'],
      }),
    ).rejects.toBeInstanceOf(ScopeEscalationDeniedError);
  });

  it('rejects renewal once the renewal count cap is reached', async () => {
    const service = makeService();
    const owner = makeActor();
    const currentVC = makeRenewableAgentVC({
      ownerDid: owner.did,
      statusListIndex: 4,
      elapsedFraction: 0.9,
      renewalCount: 5, // at MAX_RENEWAL_COUNT
    });
    const statusList = statusListWith(4, false);

    await expect(
      service.prepareAgentRenewal({
        currentVC,
        statusList,
        statusListCredentialUrl: 'https://sp.example/status/1',
        expiresIn: 3600,
      }),
    ).rejects.toBeInstanceOf(MaxRenewalCountExceededError);
  });

  it('completes the full prepare -> sign -> finalize round trip and increments renewalCount', async () => {
    const service = makeService();
    const owner = makeActor();
    const currentVC = makeRenewableAgentVC({
      ownerDid: owner.did,
      statusListIndex: 6,
      elapsedFraction: 0.9,
      renewalCount: 2,
    });
    const statusList = statusListWith(6, false);

    const prepared = await service.prepareAgentRenewal({
      currentVC,
      statusList,
      statusListCredentialUrl: 'https://sp.example/status/1',
      expiresIn: 3600,
    });

    expect(prepared.unsignedPayload.issuer).toBe(owner.did);
    expect(
      (prepared.unsignedPayload.credentialSubject as { renewalCount: number }).renewalCount,
    ).toBe(3);
    expect(
      (prepared.unsignedPayload.credentialSubject as { renewedFrom: string }).renewedFrom,
    ).toBe(currentVC.id);

    const signatureHex = await signPrepareResult(owner.privateKeyHex, prepared.canonicalHash);
    const renewedVC = await service.finalizeAgentRenewal({
      token: prepared.token,
      verificationMethod: `${owner.did}#key-1`,
      signatureHex,
    });

    expect(renewedVC.issuer).toBe(owner.did);
    expect(renewedVC.proof.verificationMethod).toBe(`${owner.did}#key-1`);
  });

  it('allows narrowing scopes on renewal', async () => {
    const service = makeService();
    const owner = makeActor();
    const currentVC = makeRenewableAgentVC({ ownerDid: owner.did, statusListIndex: 7, elapsedFraction: 0.9 });
    const statusList = statusListWith(7, false);

    const prepared = await service.prepareAgentRenewal({
      currentVC,
      statusList,
      statusListCredentialUrl: 'https://sp.example/status/1',
      expiresIn: 3600,
      scopes: ['read:calendar'],
    });

    expect(
      (prepared.unsignedPayload.credentialSubject as { privilegeScopes: string[] }).privilegeScopes,
    ).toEqual(['read:calendar']);
  });

  it('rejects finalizing an agent-renewal token against the delegation endpoint', async () => {
    const service = makeService();
    const owner = makeActor();
    const currentVC = makeRenewableAgentVC({ ownerDid: owner.did, statusListIndex: 8, elapsedFraction: 0.9 });
    const statusList = statusListWith(8, false);

    const prepared = await service.prepareAgentRenewal({
      currentVC,
      statusList,
      statusListCredentialUrl: 'https://sp.example/status/1',
      expiresIn: 3600,
    });
    const signatureHex = await signPrepareResult(owner.privateKeyHex, prepared.canonicalHash);

    await expect(
      service.finalizeDelegation({
        token: prepared.token,
        verificationMethod: `${owner.did}#key-1`,
        signatureHex,
      }),
    ).rejects.toBeInstanceOf(PreparedPayloadPurposeMismatchError);
  });
});
