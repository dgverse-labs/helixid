// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { describe, expect, it } from 'vitest';
import {
  buildStatusListCredential,
  createStatusList,
  generateKeyPair,
  getBit,
  getStatusListLength,
  issueGrant,
  publicKeyToMultibase,
  revokeGrant,
  type IssueGrantOptions,
  type StatusListCredential,
} from '../../src/index.js';
import { DelegationGrantVCSchema } from '../../src/schemas/delegation-grant.js';
import { VCBaseSchema } from '../../src/schemas/vc.js';
import { verifyEd25519Proof } from '../../src/proof.js';
import { buildDIDDocument } from '../../src/crypto/did.js';

const LIST_BITS = 1024;
const LIST_URL = 'https://sp.example/status/1';

function makeIssuer(): { did: string; privateKeyHex: string; publicKeyHex: string } {
  const keyPair = generateKeyPair();
  return {
    did: `did:key:${publicKeyToMultibase(keyPair.publicKey)}`,
    privateKeyHex: keyPair.privateKey,
    publicKeyHex: keyPair.publicKey,
  };
}

function makeStatusList(issuerDid: string): StatusListCredential {
  return buildStatusListCredential('1', createStatusList(LIST_BITS), issuerDid, 'https://sp.example');
}

function grantOptions(statusList: StatusListCredential): IssueGrantOptions {
  return {
    agentDid: 'did:key:z6MkAgent',
    userDid: 'did:web:user.example',
    scopes: ['book:flights', 'modify:booking'],
    durability: 'standing',
    statusList,
    statusListCredentialUrl: LIST_URL,
  };
}

describe('VCBaseSchema export (A1)', () => {
  it('is importable from another file and parses a base envelope', () => {
    const result = VCBaseSchema.safeParse({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      id: 'vc:test:1',
      issuer: 'did:web:issuer.example',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(result.success).toBe(true);
  });
});

describe('DelegationGrantVCSchema (B1)', () => {
  const wellFormed = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: 'vc:helix:grant:00000000-0000-4000-8000-000000000001',
    type: ['VerifiableCredential', 'DelegationGrantCredential'],
    issuer: 'did:web:sp.example',
    validFrom: '2026-07-29T00:00:00.000Z',
    validUntil: '2036-07-29T00:00:00.000Z',
    credentialSubject: {
      id: 'did:key:z6MkAgent',
      type: 'DelegationGrant',
      userDid: 'did:web:user.example',
      scopes: ['book:flights'],
      durability: 'standing',
    },
  };

  it('accepts a well-formed grant', () => {
    expect(DelegationGrantVCSchema.safeParse(wellFormed).success).toBe(true);
  });

  it('accepts an optional serviceDid and extra type strings', () => {
    const withExtras = {
      ...wellFormed,
      type: [...wellFormed.type, 'SomethingElse'],
      credentialSubject: { ...wellFormed.credentialSubject, serviceDid: 'did:web:sp.example' },
    };
    expect(DelegationGrantVCSchema.safeParse(withExtras).success).toBe(true);
  });

  it('rejects missing scopes, wrong durability, and missing type strings', () => {
    const noScopes = {
      ...wellFormed,
      credentialSubject: { ...wellFormed.credentialSubject, scopes: undefined },
    };
    expect(DelegationGrantVCSchema.safeParse(noScopes).success).toBe(false);

    const badDurability = {
      ...wellFormed,
      credentialSubject: { ...wellFormed.credentialSubject, durability: 'forever' },
    };
    expect(DelegationGrantVCSchema.safeParse(badDurability).success).toBe(false);

    const badTypes = { ...wellFormed, type: ['VerifiableCredential'] };
    expect(DelegationGrantVCSchema.safeParse(badTypes).success).toBe(false);

    const badUserDid = {
      ...wellFormed,
      credentialSubject: { ...wellFormed.credentialSubject, userDid: undefined },
    };
    expect(DelegationGrantVCSchema.safeParse(badUserDid).success).toBe(false);
  });
});

describe('issueGrant (B2/B3)', () => {
  it('issues a signed grant with no delegationChain field, ever', async () => {
    const issuer = makeIssuer();
    const statusList = makeStatusList(issuer.did);
    const { grantVC } = await issueGrant(grantOptions(statusList), issuer);

    expect('delegationChain' in grantVC).toBe(false);
    expect((grantVC as Record<string, unknown>)['delegationChain']).toBeUndefined();
  });

  it('produces a schema-valid, signature-valid grant VC', async () => {
    const issuer = makeIssuer();
    const statusList = makeStatusList(issuer.did);
    const { grantVC } = await issueGrant(grantOptions(statusList), issuer);

    expect(DelegationGrantVCSchema.safeParse(grantVC).success).toBe(true);
    expect(grantVC.type).toContain('DelegationGrantCredential');
    expect(grantVC.issuer).toBe(issuer.did);
    expect(grantVC.credentialSubject).toMatchObject({
      id: 'did:key:z6MkAgent',
      type: 'DelegationGrant',
      userDid: 'did:web:user.example',
      durability: 'standing',
    });

    const { proof, ...payload } = grantVC;
    const didDocument = buildDIDDocument(issuer.did, issuer.publicKeyHex);
    await expect(
      verifyEd25519Proof(payload as Record<string, unknown>, proof, didDocument),
    ).resolves.toBe(true);
  });

  it('assigns a statusListIndex within the list bit length and leaves the list unmodified', async () => {
    const issuer = makeIssuer();
    const statusList = makeStatusList(issuer.did);
    const listLength = getStatusListLength(statusList.credentialSubject.encodedList);

    for (let run = 0; run < 25; run += 1) {
      const { grantVC, updatedStatusList } = await issueGrant(grantOptions(statusList), issuer);
      const index = Number(grantVC.credentialStatus?.statusListIndex);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(listLength);
      expect(grantVC.credentialStatus?.statusListCredential).toBe(LIST_URL);
      // Issuance never sets bits — only revocation does.
      expect(updatedStatusList.credentialSubject.encodedList).toBe(
        statusList.credentialSubject.encodedList,
      );
    }
  });

  it('gives standing grants a far-future validUntil and session grants a short one', async () => {
    const issuer = makeIssuer();
    const statusList = makeStatusList(issuer.did);
    const { grantVC: standing } = await issueGrant(grantOptions(statusList), issuer);
    const { grantVC: session } = await issueGrant(
      { ...grantOptions(statusList), durability: 'session' },
      issuer,
    );

    const yearMs = 365 * 24 * 60 * 60 * 1000;
    expect(new Date(standing.validUntil).getTime() - Date.now()).toBeGreaterThan(9 * yearMs);
    expect(new Date(session.validUntil).getTime() - Date.now()).toBeLessThanOrEqual(yearMs);
  });
});

describe('revokeGrant (B4)', () => {
  it('flips the correct bit when given the grant VC', async () => {
    const issuer = makeIssuer();
    const statusList = makeStatusList(issuer.did);
    const { grantVC } = await issueGrant(grantOptions(statusList), issuer);
    const index = Number(grantVC.credentialStatus?.statusListIndex);

    const updated = await revokeGrant(statusList, issuer, { vc: grantVC });

    expect(getBit(updated.credentialSubject.encodedList, index)).toBe(1);
    // Only that bit changed.
    for (let bit = 0; bit < LIST_BITS; bit += 1) {
      if (bit === index) continue;
      expect(getBit(updated.credentialSubject.encodedList, bit)).toBe(0);
    }
    expect(updated.proof.type).toBe('Ed25519Signature2020');
  });

  it('flips the correct bit when given a bare index', async () => {
    const issuer = makeIssuer();
    const statusList = makeStatusList(issuer.did);

    const updated = await revokeGrant(statusList, issuer, { statusListIndex: '7' });

    expect(getBit(updated.credentialSubject.encodedList, 7)).toBe(1);
    expect(getBit(statusList.credentialSubject.encodedList, 7)).toBe(0);
  });

  it('re-signs the updated list without embedding a stale proof in the payload', async () => {
    const issuer = makeIssuer();
    const statusList = makeStatusList(issuer.did);
    const once = await revokeGrant(statusList, issuer, { statusListIndex: '3' });

    const twice = await revokeGrant(once, issuer, { statusListIndex: '9' });

    expect(getBit(twice.credentialSubject.encodedList, 3)).toBe(1);
    expect(getBit(twice.credentialSubject.encodedList, 9)).toBe(1);
    const { proof, ...payload } = twice;
    expect('proof' in payload).toBe(false);
    const didDocument = buildDIDDocument(issuer.did, issuer.publicKeyHex);
    await expect(
      verifyEd25519Proof(payload as unknown as Record<string, unknown>, proof, didDocument),
    ).resolves.toBe(true);
  });

  it('throws a clear error when neither a VC index nor a bare index is available', async () => {
    const issuer = makeIssuer();
    const statusList = makeStatusList(issuer.did);
    const { grantVC } = await issueGrant(grantOptions(statusList), issuer);
    const { credentialStatus: _dropped, ...statusless } = grantVC;

    await expect(
      revokeGrant(statusList, issuer, { vc: statusless as typeof grantVC }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      revokeGrant(statusList, issuer, { statusListIndex: 'not-a-number' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
