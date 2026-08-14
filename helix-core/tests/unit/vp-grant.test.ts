// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// VP doc §9.1 (builder B1–B9), §9.3 (grants G1–G12), §9.5 (status-list
// validation S1–S5), with the §9.9 fixture set.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDelegationVC,
  buildStatusListCredential,
  createStatusList,
  generateKeyPair,
  issueGrant,
  publicKeyToMultibase,
  revokeGrant,
  setBit,
  verifyVP,
  VPBuilder,
  type SignedVC,
  type StatusListCredential,
} from '../../src/index.js';
import { createEd25519Proof } from '../../src/proof.js';

const SP_LIST_URL = 'https://sp.example/status/1';
const USER_DID = 'did:web:user.example';
const USER_EMAIL = 'user@example.com';

function didKey(publicKeyHex: string): string {
  return `did:key:${publicKeyToMultibase(publicKeyHex)}`;
}

interface Actor {
  did: string;
  privateKeyHex: string;
}

function makeActor(): Actor {
  const keys = generateKeyPair();
  return { did: didKey(keys.publicKey), privateKeyHex: keys.privateKey };
}

async function signVC(
  payload: Record<string, unknown>,
  signer: Actor,
): Promise<SignedVC> {
  return {
    ...payload,
    proof: await createEd25519Proof(payload, signer.privateKeyHex, `${signer.did}#key-1`),
  } as SignedVC;
}

// §9.9: minimal signed root HelixAgentCredential (non-delegated).
async function makeAgentVC(
  issuer: Actor,
  holderDid: string,
  scopes: string[] = ['read:orders', 'book:flights'],
  overrides: Record<string, unknown> = {},
): Promise<SignedVC> {
  const now = Date.now();
  return signVC(
    {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
      id: `vc:test:agent:${crypto.randomUUID()}`,
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: issuer.did,
      validFrom: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + 60 * 60_000).toISOString(),
      credentialSubject: {
        id: holderDid,
        type: 'HelixAgent',
        privilegeScopes: scopes,
        agentName: 'test-agent',
        delegationDepth: 0,
        maxDelegationDepth: 2,
      },
      ...overrides,
    },
    issuer,
  );
}

function makeSpStatusList(sp: Actor): StatusListCredential {
  return buildStatusListCredential('1', createStatusList(256), sp.did, 'https://sp.example');
}

// §9.9: signed DelegationGrantCredential fixture via the Epic 3 issuance path.
async function makeGrant(
  sp: Actor,
  agentDid: string,
  userDid: string,
  scopes: string[],
  statusList: StatusListCredential,
  durability: 'standing' | 'session' = 'standing',
): Promise<SignedVC> {
  const { grantVC } = await issueGrant(
    {
      agentDid,
      userDid,
      scopes,
      durability,
      statusList,
      statusListCredentialUrl: SP_LIST_URL,
    },
    sp,
  );
  return grantVC;
}

function stubFetch(bodies: Record<string, unknown>): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const body = bodies[String(url)];
    if (body === undefined) {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

async function buildVP(
  credentials: SignedVC[],
  holder: Actor,
  userDid?: string,
  targetService = 'orders',
) {
  const builder = new VPBuilder({
    credentials,
    holderDid: holder.did,
    targetService,
    ...(userDid !== undefined ? { userDid } : {}),
  });
  return builder.sign(holder.privateKeyHex, `${holder.did}#key-1`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VPBuilder (§9.1)', () => {
  it('B1: 1 credential with userDid — array length 1, delegatedBy present', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildVP([vc], holder, USER_DID);

    expect(vp.verifiableCredential).toHaveLength(1);
    expect(vp.delegatedBy).toBe(USER_DID);
  });

  it('B2: userDid omitted — delegatedBy key absent entirely', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildVP([vc], holder);

    expect('delegatedBy' in vp).toBe(false);
  });

  it('B3: agentVC + grantVC — length 2, order preserved', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], makeSpStatusList(sp));
    const vp = await buildVP([vc, grant], holder, USER_DID);

    expect(vp.verifiableCredential).toHaveLength(2);
    expect((vp.verifiableCredential[0] as SignedVC).type).toContain('HelixAgentCredential');
    expect((vp.verifiableCredential[1] as SignedVC).type).toContain('DelegationGrantCredential');
  });

  it('B4/B5: 0 or 3 credentials — structural error before signing', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);

    expect(
      () => new VPBuilder({ credentials: [], holderDid: holder.did, targetService: 'orders' }),
    ).toThrowError(/1 or 2 credentials/);
    expect(
      () =>
        new VPBuilder({
          credentials: [vc, vc, vc],
          holderDid: holder.did,
          targetService: 'orders',
        }),
    ).toThrowError(/1 or 2 credentials/);
  });

  it('B6/B7: two agent VCs, or two grants — structural error', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], statusList);

    expect(
      () => new VPBuilder({ credentials: [vc, vc], holderDid: holder.did, targetService: 'orders' }),
    ).toThrowError(/exactly one agent-authority/);
    expect(
      () =>
        new VPBuilder({ credentials: [grant, grant], holderDid: holder.did, targetService: 'orders' }),
    ).toThrowError(/exactly one agent-authority/);
  });

  it('B8: email-valued userDid builds identically to a DID-valued one', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildVP([vc], holder, USER_EMAIL);

    expect(vp.delegatedBy).toBe(USER_EMAIL);
    expect(vp.verifiableCredential).toHaveLength(1);
  });

  it('B9: signed VPs for B1 and B3 shapes round-trip through verifyVP()', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], statusList);
    stubFetch({ [SP_LIST_URL]: statusList });

    const single = await buildVP([vc], holder, USER_DID);
    await expect(verifyVP(single)).resolves.toMatchObject({ valid: true });

    const withGrant = await buildVP([vc, grant], holder, USER_DID);
    await expect(verifyVP(withGrant)).resolves.toMatchObject({ valid: true });
  });
});

describe('verifyVP grant behavior (§9.3)', () => {
  it('G1: agent + grant, direct agent-match, DID user-match — intersected scopes', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders', 'book:flights']);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights', 'modify:booking'], statusList);
    stubFetch({ [SP_LIST_URL]: statusList });

    const result = await verifyVP(await buildVP([vc, grant], holder, USER_DID));

    expect(result.valid).toBe(true);
    expect(result.privilegeScopes).toEqual(['read:orders', 'book:flights']);
    expect(result.effectiveScopes).toEqual(['book:flights']);
  });

  it('G2: delegated sub-agent presents a grant issued to an ancestor DID', async () => {
    const issuer = makeActor();
    const parent = makeActor();
    const sub = makeActor();
    const sp = makeActor();
    const parentVC = await makeAgentVC(issuer, parent.did, ['read:orders', 'book:flights']);
    const childVC = await buildDelegationVC(
      { to: sub.did, scopes: ['book:flights'], expiresIn: 3600, fromVC: parentVC },
      parent,
    );
    const statusList = makeSpStatusList(sp);
    // Grant subject is the ANCESTOR (parent), not the presenting sub-agent.
    const grant = await makeGrant(sp, parent.did, USER_DID, ['book:flights'], statusList);
    stubFetch({ [SP_LIST_URL]: statusList });

    const result = await verifyVP(await buildVP([childVC, grant], sub, USER_DID));

    expect(result.valid).toBe(true);
    expect(result.effectiveScopes).toEqual(['book:flights']);
    expect(result.delegationChain).toHaveLength(2);
  });

  it('G3: grant subject matches neither presenter nor any ancestor', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const stranger = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, stranger.did, USER_DID, ['book:flights'], statusList);
    stubFetch({ [SP_LIST_URL]: statusList });

    await expect(verifyVP(await buildVP([vc, grant], holder, USER_DID))).rejects.toMatchObject({
      code: 'CONSENT_GRANT_SUBJECT_MISMATCH',
    });
  });

  it('G4: agent-match passes but user-match fails', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, 'did:web:someone-else.example', ['book:flights'], statusList);
    stubFetch({ [SP_LIST_URL]: statusList });

    await expect(verifyVP(await buildVP([vc, grant], holder, USER_DID))).rejects.toMatchObject({
      code: 'CONSENT_GRANT_SUBJECT_MISMATCH',
    });
  });

  it('G5: user-match via the email fallback form on both sides', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, USER_EMAIL, ['book:flights'], statusList);
    stubFetch({ [SP_LIST_URL]: statusList });

    const result = await verifyVP(await buildVP([vc, grant], holder, USER_EMAIL));
    expect(result.valid).toBe(true);
  });

  it('G6: grant present but vp.delegatedBy absent — rejected', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], statusList);
    stubFetch({ [SP_LIST_URL]: statusList });

    await expect(verifyVP(await buildVP([vc, grant], holder))).rejects.toMatchObject({
      code: 'CONSENT_GRANT_SUBJECT_MISMATCH',
    });
  });

  it('G7: expired grant rejects the whole VP even with a valid agent VC', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const fresh = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], statusList);
    const { proof: _p, ...grantPayload } = fresh;
    const expiredGrant = await signVC(
      { ...grantPayload, validUntil: new Date(Date.now() - 1000).toISOString() },
      sp,
    );
    stubFetch({ [SP_LIST_URL]: statusList });

    await expect(
      verifyVP(await buildVP([vc, expiredGrant], holder, USER_DID)),
    ).rejects.toMatchObject({ code: 'VC_EXPIRED' });
  });

  it('G8: revoked grant rejects the whole VP', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], statusList);
    // §9.9 revoked-grant fixture: bit set via the Epic 3 revocation path.
    const revokedList = await revokeGrant(statusList, sp, { vc: grant });
    stubFetch({ [SP_LIST_URL]: revokedList });

    await expect(verifyVP(await buildVP([vc, grant], holder, USER_DID))).rejects.toMatchObject({
      code: 'VC_REVOKED',
    });
  });

  it('G9: grant with an invalid signature rejects the whole VP', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], statusList);
    const tampered = {
      ...grant,
      credentialSubject: {
        ...(grant.credentialSubject as Record<string, unknown>),
        scopes: ['book:flights', 'admin:everything'],
      },
    } as SignedVC;
    stubFetch({ [SP_LIST_URL]: statusList });

    await expect(verifyVP(await buildVP([vc, tampered], holder, USER_DID))).rejects.toMatchObject({
      code: 'VC_SIGNATURE_INVALID',
    });
  });

  it('G10: grant scopes are a superset — agent ceiling still applies', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did, ['book:flights']);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(
      sp,
      holder.did,
      USER_DID,
      ['book:flights', 'modify:booking', 'admin:everything'],
      statusList,
    );
    stubFetch({ [SP_LIST_URL]: statusList });

    const result = await verifyVP(await buildVP([vc, grant], holder, USER_DID));
    expect(result.effectiveScopes).toEqual(['book:flights']);
  });

  it('G11: grant scopes narrower — grant is the ceiling', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders', 'book:flights', 'modify:booking']);
    const statusList = makeSpStatusList(sp);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], statusList);
    stubFetch({ [SP_LIST_URL]: statusList });

    const result = await verifyVP(await buildVP([vc, grant], holder, USER_DID));
    expect(result.effectiveScopes).toEqual(['book:flights']);
  });

  it('G12: malformed grant (missing scopes) — ConsentGrantInvalidError before any signature work', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const now = Date.now();
    const malformedGrant = (await signVC(
      {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
        id: 'vc:helix:grant:malformed',
        type: ['VerifiableCredential', 'DelegationGrantCredential'],
        issuer: sp.did,
        validFrom: new Date(now - 60_000).toISOString(),
        validUntil: new Date(now + 60_000).toISOString(),
        credentialSubject: {
          id: holder.did,
          type: 'DelegationGrant',
          userDid: USER_DID,
          durability: 'standing',
          // scopes deliberately missing
        },
      },
      sp,
    )) as SignedVC;
    const fetchSpy = stubFetch({});

    await expect(
      verifyVP(await buildVP([vc, malformedGrant], holder, USER_DID)),
    ).rejects.toMatchObject({ code: 'CONSENT_GRANT_INVALID' });
    // Structural failure fires before the grant's signature/revocation work.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('status-list runtime validation (§9.5)', () => {
  async function vpWithStatusBearingVC(issuer: Actor, holder: Actor, listUrl: string) {
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders'], {
      credentialStatus: {
        id: `${listUrl}#3`,
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: '3',
        statusListCredential: listUrl,
      },
    });
    return buildVP([vc], holder, USER_DID);
  }

  it('S1: well-formed fetched list parses and verification proceeds', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const list = buildStatusListCredential('s1', createStatusList(64), issuer.did, 'https://issuer.example');
    stubFetch({ 'https://issuer.example/status/s1': list });

    const vp = await vpWithStatusBearingVC(issuer, holder, 'https://issuer.example/status/s1');
    await expect(verifyVP(vp)).resolves.toMatchObject({ valid: true });
  });

  it('S2: fetched JSON missing required fields — treated as revoked, no crash', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    stubFetch({ 'https://issuer.example/status/s2': { hello: 'not a status list' } });

    const vp = await vpWithStatusBearingVC(issuer, holder, 'https://issuer.example/status/s2');
    await expect(verifyVP(vp)).rejects.toMatchObject({ code: 'VC_REVOKED' });
  });

  it('S3: schema-valid list with an unreadable encodedList — clean rejection', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const garbage = buildStatusListCredential('s3', 'not-gzip-base64url!!!', issuer.did, 'https://issuer.example');
    stubFetch({ 'https://issuer.example/status/s3': garbage });

    const vp = await vpWithStatusBearingVC(issuer, holder, 'https://issuer.example/status/s3');
    await expect(verifyVP(vp)).rejects.toMatchObject({ code: 'VC_REVOKED' });
  });

  it('S4: non-200 response — existing VCRevokedError path unaffected', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    stubFetch({}); // every URL 404s

    const vp = await vpWithStatusBearingVC(issuer, holder, 'https://issuer.example/status/s4');
    await expect(verifyVP(vp)).rejects.toMatchObject({ code: 'VC_REVOKED' });
  });

  it('S5: injected resolver returning a malformed record fails closed identically', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const fetchSpy = stubFetch({});

    const vp = await vpWithStatusBearingVC(issuer, holder, 'https://issuer.example/status/s5');
    await expect(
      verifyVP(vp, {
        statusListResolver: async () => ({ bogus: true }) as never,
      }),
    ).rejects.toMatchObject({ code: 'VC_REVOKED' });
    // The injected resolver replaced the HTTP path entirely.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('S5b: injected resolver serving a healthy local record passes', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const list = buildStatusListCredential('s5b', createStatusList(64), issuer.did, 'https://issuer.example');
    const fetchSpy = stubFetch({});

    const vp = await vpWithStatusBearingVC(issuer, holder, 'https://issuer.example/status/s5b');
    await expect(
      verifyVP(vp, { statusListResolver: async () => list }),
    ).resolves.toMatchObject({ valid: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
