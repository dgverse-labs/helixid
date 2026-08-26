// Copyright 2026 DgVerse LLP
// Post-consolidation VPService unit tests (§4.2, §7.3, §9.4 A2/A3/A5/A6).
// The service is a thin wrapper over core verifyVP(): no DB-walk, no template
// step, single audit event per outcome, JWT scopes from effectiveScopes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditEvents } from '../../../src/core/index.js';
import { VPService } from '../../../src/services/vp/vp.service.js';
import { TestAuditLogger } from '../../utils/TestAuditLogger.js';
import {
  API_BASE_URL,
  OWN_LIST_ID,
  SP_LIST_URL,
  USER_DID,
  buildSignedVP,
  decodeJwtPayload,
  makeActor,
  makeAgentVC,
  makeGrant,
  makeOwnStatusList,
  makeSpStatusList,
  makeVcServiceStub,
  stubFetch,
} from '../../utils/vp-fixtures.js';

function makeService(issuer = makeActor()) {
  const auditLogger = new TestAuditLogger();
  const lists = { [OWN_LIST_ID]: makeOwnStatusList(issuer) };
  const service = new VPService(makeVcServiceStub(lists), auditLogger, API_BASE_URL, {
    signingKey: issuer.privateKeyHex,
    issuerDid: issuer.did,
    ttlSeconds: 600,
  });
  return { service, auditLogger, issuer };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VPService (thin wrapper)', () => {
  it('verifies a valid single-credential VP and logs exactly one VP_VERIFIED event (A5)', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const { service, auditLogger } = makeService(issuer);
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildSignedVP([vc], holder, USER_DID);

    const result = await service.verifyVP(vp, 'req-1');

    expect(result).toMatchObject({
      valid: true,
      agentDid: holder.did,
      userDid: USER_DID,
      targetService: 'orders',
    });
    const eventTypes = auditLogger.events.map((entry) => entry.event.event);
    expect(eventTypes.filter((type) => type === AuditEvents.VP_VERIFIED)).toHaveLength(1);
    expect(eventTypes).not.toContain(AuditEvents.CHAIN_VERIFIED);
    expect(eventTypes).not.toContain(AuditEvents.CHAIN_REJECTED);
    expect(eventTypes).not.toContain(AuditEvents.VP_REJECTED);
  });

  it('uses the injected local-repo resolver for its own status lists — no HTTP round-trip (A3)', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const lists = { [OWN_LIST_ID]: makeOwnStatusList(issuer) };
    const getStatusListSpy = vi.fn(async (listId: string) => lists[listId]!);
    const service = new VPService(
      { getStatusList: getStatusListSpy } as never,
      new TestAuditLogger(),
      API_BASE_URL,
    );
    const fetchSpy = stubFetch({});
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildSignedVP([vc], holder, USER_DID);

    await expect(service.verifyVP(vp, 'req-1')).resolves.toMatchObject({ valid: true });
    expect(getStatusListSpy).toHaveBeenCalledWith(OWN_LIST_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves an SP-hosted grant status list over HTTP with schema validation (A4)', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const { service } = makeService(issuer);
    const spList = makeSpStatusList(sp);
    const fetchSpy = stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], spList);
    const vp = await buildSignedVP([vc, grant], holder, USER_DID);

    await expect(service.verifyVP(vp, 'req-1')).resolves.toMatchObject({ valid: true });
    expect(fetchSpy).toHaveBeenCalledWith(SP_LIST_URL, expect.anything());
  });

  it('rejects when the SP-hosted list fails schema validation — fail closed (A4/S2)', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const { service, auditLogger } = makeService(issuer);
    stubFetch({ [SP_LIST_URL]: { not: 'a status list' } });
    const vc = await makeAgentVC(issuer, holder.did);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights'], makeSpStatusList(sp));
    const vp = await buildSignedVP([vc, grant], holder, USER_DID);

    await expect(service.verifyVP(vp, 'req-1')).rejects.toMatchObject({
      code: 'VP_VERIFICATION_FAILED',
    });
    const rejected = auditLogger.events.filter(
      (entry) => entry.event.event === AuditEvents.VP_REJECTED,
    );
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.event['internalReason'])).toContain('VC_REVOKED');
  });

  it('issues a session JWT whose scopes claim is effectiveScopes, not raw VC scopes (A2)', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const sp = makeActor();
    const { service } = makeService(issuer);
    const spList = makeSpStatusList(sp);
    stubFetch({ [SP_LIST_URL]: spList });
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders', 'book:flights']);
    const grant = await makeGrant(sp, holder.did, USER_DID, ['book:flights', 'modify:booking'], spList);
    const vp = await buildSignedVP([vc, grant], holder, USER_DID);

    const result = await service.verifyVP(vp, 'req-1', { issueSession: true });

    expect(result.session?.token).toBeTruthy();
    const payload = decodeJwtPayload(result.session!.token);
    expect(payload['scopes']).toEqual(['book:flights']);
    expect(payload['userDid']).toBe(USER_DID);
  });

  it('session without a grant carries the full VC scopes (effectiveScopes === privilegeScopes)', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const { service } = makeService(issuer);
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders', 'book:flights']);
    const vp = await buildSignedVP([vc], holder, USER_DID);

    const result = await service.verifyVP(vp, 'req-1', { issueSession: true });
    expect(decodeJwtPayload(result.session!.token)['scopes']).toEqual([
      'read:orders',
      'book:flights',
    ]);
  });

  it('logs exactly one VP_REJECTED with the failure reason on rejection (A6)', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const { service, auditLogger } = makeService(issuer);
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders'], {
      validUntil: new Date(Date.now() - 1000).toISOString(),
    });
    const vp = await buildSignedVP([vc], holder, USER_DID);

    await expect(service.verifyVP(vp, 'req-1')).rejects.toMatchObject({
      code: 'VP_VERIFICATION_FAILED',
    });

    const eventTypes = auditLogger.events.map((entry) => entry.event.event);
    expect(eventTypes.filter((type) => type === AuditEvents.VP_REJECTED)).toHaveLength(1);
    expect(eventTypes).not.toContain(AuditEvents.VP_VERIFIED);
    expect(eventTypes).not.toContain(AuditEvents.CHAIN_REJECTED);
    const rejected = auditLogger.events.find(
      (entry) => entry.event.event === AuditEvents.VP_REJECTED,
    );
    expect(String(rejected?.event['internalReason'])).toContain('VC_EXPIRED');
  });

  it('rejects a payload that fails signedVPSchema parsing', async () => {
    const { service } = makeService();
    await expect(service.verifyVP({ nope: true } as never, 'req-1')).rejects.toMatchObject({
      code: 'VP_VERIFICATION_FAILED',
    });
  });

  // Audit-enrichment epic §1: a rejection has no `result` to read from, so the
  // correlation fields come off the raw, unverified VP instead.
  it('enriches VP_REJECTED with attempted* identifiers off the unverified VP', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const { service, auditLogger } = makeService(issuer);
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders'], {
      validUntil: new Date(Date.now() - 1000).toISOString(),
    });
    (vc.credentialSubject as Record<string, unknown>)['parentVcId'] = 'vc:helix:parent-1';
    (vc.credentialSubject as Record<string, unknown>)['delegatedFrom'] = 'did:key:zParent';
    const vp = await buildSignedVP([vc], holder, USER_DID);

    await expect(service.verifyVP(vp, 'req-1')).rejects.toMatchObject({
      code: 'VP_VERIFICATION_FAILED',
    });

    const rejected = auditLogger.events.find(
      (entry) => entry.event.event === AuditEvents.VP_REJECTED,
    );
    expect(rejected?.event['attemptedVcId']).toBe(vc.id);
    expect(rejected?.event['attemptedParentVcId']).toBe('vc:helix:parent-1');
    expect(rejected?.event['attemptedDelegatedFrom']).toBe('did:key:zParent');
  });

  it('still logs VP_REJECTED when the VP is too malformed to read context from', async () => {
    const { service, auditLogger } = makeService();

    // Rejected at schema parsing, before any parsed VP exists — the enrichment
    // must degrade to no fields rather than throw over the audit call.
    await expect(
      service.verifyVP({ verifiableCredential: 'not-an-array' } as never, 'req-1'),
    ).rejects.toMatchObject({ code: 'VP_VERIFICATION_FAILED' });

    const rejected = auditLogger.events.find(
      (entry) => entry.event.event === AuditEvents.VP_REJECTED,
    );
    expect(rejected).toBeDefined();
    expect(rejected?.event['attemptedVcId']).toBeUndefined();
  });

  it('throws when a session is requested but JWT options are not configured', async () => {
    const issuer = makeActor();
    const holder = makeActor();
    const service = new VPService(
      makeVcServiceStub({ [OWN_LIST_ID]: makeOwnStatusList(issuer) }),
      new TestAuditLogger(),
      API_BASE_URL,
    );
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildSignedVP([vc], holder, USER_DID);

    await expect(service.verifyVP(vp, 'req-1', { issueSession: true })).rejects.toMatchObject({
      code: 'VP_VERIFICATION_FAILED',
    });
  });
});
