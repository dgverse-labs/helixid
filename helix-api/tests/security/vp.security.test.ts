// Copyright 2026 DgVerse LLP
// §9.4 A1: the G1–G12 grant matrix run against POST /v1/vp/verify, confirming
// the route is a genuine thin wrapper over core verifyVP() — same accept/
// reject outcomes, with the API's uniform opaque failure envelope.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildDelegationVC, type SignedVP } from '@helixid/core';
import { VPService } from '../../src/services/vp/vp.service.js';
import vpRoutes from '../../src/routes/vp/index.js';
import { TestAuditLogger } from '../utils/TestAuditLogger.js';
import {
  API_BASE_URL,
  OWN_LIST_ID,
  SP_LIST_URL,
  USER_DID,
  buildSignedVP,
  makeActor,
  makeAgentVC,
  makeGrant,
  makeOwnStatusList,
  makeSpStatusList,
  makeVcServiceStub,
  signVC,
  stubFetch,
  type Actor,
} from '../utils/vp-fixtures.js';

const USER_EMAIL = 'user@example.com';

describe('POST /v1/vp/verify — grant matrix (§9.4 A1)', () => {
  let app: FastifyInstance;
  let issuer: Actor;

  beforeAll(async () => {
    issuer = makeActor();
    app = Fastify({ logger: false });
    const service = new VPService(
      makeVcServiceStub({ [OWN_LIST_ID]: makeOwnStatusList(issuer) }),
      new TestAuditLogger(),
      API_BASE_URL,
      { signingKey: issuer.privateKeyHex, issuerDid: issuer.did, ttlSeconds: 600 },
    );
    await app.register(vpRoutes, { prefix: '/v1/vp', vpService: service });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function post(signedVP: SignedVP, session = false) {
    return app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP, session } });
  }

  function expectOpaqueFailure(response: { statusCode: number; json: () => { error: { code: string } } }): void {
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VP_VERIFICATION_FAILED');
  }

  it('G1: valid agent+grant passes with 200', async () => {
    const holder = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders', 'book:flights']);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], spList);

    const response = await post(await buildSignedVP([vc, grant], holder, USER_DID));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ valid: true, agentDid: holder.did });
  });

  it('G2: grant issued to an ancestor DID passes for the delegated sub-agent', async () => {
    const parent = makeActor();
    const sub = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const parentVC = await makeAgentVC(issuer, parent.did, ['book:flights']);
    const childVC = await buildDelegationVC(
      { to: sub.did, scopes: ['book:flights'], expiresIn: 3600, fromVC: parentVC },
      parent,
    );
    const grant = await makeGrant(sp, parent.did, USER_DID, ['book:flights'], spList);

    const response = await post(await buildSignedVP([childVC, grant], sub, USER_DID));
    expect(response.statusCode).toBe(200);
  });

  it('G3: grant for an unrelated agent DID is rejected', async () => {
    const holder = makeActor();
    const stranger = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, stranger.did, USER_DID, ['book:flights'], spList);

    expectOpaqueFailure(await post(await buildSignedVP([vc, grant], holder, USER_DID)));
  });

  it('G4: user-match failure is rejected', async () => {
    const holder = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, 'did:web:other-user.example', ['book:flights'], spList);

    expectOpaqueFailure(await post(await buildSignedVP([vc, grant], holder, USER_DID)));
  });

  it('G5: email-form user identifier matches on both sides', async () => {
    const holder = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, USER_EMAIL, ['book:flights'], spList);

    const response = await post(await buildSignedVP([vc, grant], holder, USER_EMAIL));
    expect(response.statusCode).toBe(200);
  });

  it('G6: grant present but no delegatedBy on the VP is rejected', async () => {
    const holder = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], spList);

    expectOpaqueFailure(await post(await buildSignedVP([vc, grant], holder)));
  });

  it('G7: expired grant rejects the whole VP', async () => {
    const holder = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], spList);
    const { proof: _p, ...payload } = grant;
    const expired = await signVC(
      { ...payload, validUntil: new Date(Date.now() - 1000).toISOString() },
      sp,
    );

    expectOpaqueFailure(await post(await buildSignedVP([vc, expired], holder, USER_DID)));
  });

  it('G8: revoked grant rejects the whole VP', async () => {
    const holder = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], spList);
    const { revokeGrant } = await import('@helixid/core');
    const revokedList = await revokeGrant(spList, sp, { vc: grant });
    stubFetch({ [SP_LIST_URL]: revokedList });

    expectOpaqueFailure(await post(await buildSignedVP([vc, grant], holder, USER_DID)));
  });

  it('G9: tampered grant signature rejects the whole VP', async () => {
    const holder = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], spList);
    const tampered = {
      ...grant,
      credentialSubject: {
        ...(grant.credentialSubject as Record<string, unknown>),
        scopes: ['admin:everything'],
      },
    };

    expectOpaqueFailure(await post(await buildSignedVP([vc, tampered as never], holder, USER_DID)));
  });

  it('G10/G11: session scopes reflect the intersection in both directions', async () => {
    const holder = makeActor();
    const sp = makeActor();
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });

    // G10: grant superset — agent ceiling applies.
    const narrowVC = await makeAgentVC(issuer, holder.did, ['book:flights']);
    const wideGrant = await makeGrant(sp, holder.did, USER_DID, ['book:flights', 'admin:everything'], spList);
    const supersetResponse = await post(await buildSignedVP([narrowVC, wideGrant], holder, USER_DID), true);
    expect(supersetResponse.statusCode).toBe(200);
    const supersetToken = supersetResponse.json().session.token as string;
    const supersetScopes = JSON.parse(
      Buffer.from(supersetToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    )['scopes'];
    expect(supersetScopes).toEqual(['book:flights']);

    // G11: grant narrower — grant is the ceiling.
    const wideVC = await makeAgentVC(issuer, holder.did, ['read:orders', 'book:flights']);
    const narrowGrant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], spList);
    const subsetResponse = await post(await buildSignedVP([wideVC, narrowGrant], holder, USER_DID), true);
    expect(subsetResponse.statusCode).toBe(200);
    const subsetToken = subsetResponse.json().session.token as string;
    const subsetScopes = JSON.parse(
      Buffer.from(subsetToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    )['scopes'];
    expect(subsetScopes).toEqual(['book:flights']);
  });

  it('G12: structurally malformed grant is rejected', async () => {
    const holder = makeActor();
    const sp = makeActor();
    stubFetch({});
    const vc = await makeAgentVC(issuer, holder.did);
    const malformed = await signVC(
      {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
        id: 'vc:helix:grant:malformed',
        type: ['VerifiableCredential', 'DelegationGrantCredential'],
        issuer: sp.did,
        validFrom: new Date(Date.now() - 60_000).toISOString(),
        validUntil: new Date(Date.now() + 60_000).toISOString(),
        credentialSubject: {
          id: holder.did,
          type: 'DelegationGrant',
          userDid: USER_DID,
          durability: 'standing',
        },
      },
      sp,
    );

    expectOpaqueFailure(await post(await buildSignedVP([vc, malformed], holder, USER_DID)));
  });

  it('failure responses stay opaque for non-grant failures too (expired VP)', async () => {
    const holder = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildSignedVP([vc], holder, USER_DID);

    expectOpaqueFailure(
      await post({ ...vp, expirationDate: new Date(Date.now() - 1000).toISOString() }),
    );
  });
});
