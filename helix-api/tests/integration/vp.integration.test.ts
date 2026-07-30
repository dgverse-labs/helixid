// Copyright 2026 DgVerse LLP
// Route-level integration for the consolidated POST /v1/vp/verify (§4.2) and
// the retired template endpoint (§2.3/§8).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { VPService } from '../../src/services/vp/vp.service.js';
import vpRoutes from '../../src/routes/vp/index.js';
import { TestAuditLogger } from '../utils/TestAuditLogger.js';
import {
  API_BASE_URL,
  OWN_LIST_ID,
  USER_DID,
  buildSignedVP,
  decodeJwtPayload,
  makeActor,
  makeAgentVC,
  makeOwnStatusList,
  makeVcServiceStub,
  type Actor,
} from '../utils/vp-fixtures.js';

describe('VP integration API', () => {
  let app: FastifyInstance;
  let issuer: Actor;
  let auditLogger: TestAuditLogger;

  beforeAll(async () => {
    issuer = makeActor();
    auditLogger = new TestAuditLogger();
    app = Fastify({ logger: false });
    const service = new VPService(
      makeVcServiceStub({ [OWN_LIST_ID]: makeOwnStatusList(issuer) }),
      auditLogger,
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
    auditLogger.events.length = 0;
  });

  it('POST /v1/vp/template is removed from the API', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });

  it('POST /v1/vp/verify without session verifies and returns the result envelope', async () => {
    const holder = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildSignedVP([vc], holder, USER_DID);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/verify',
      payload: { signedVP: vp },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      valid: true,
      agentDid: holder.did,
      userDid: USER_DID,
      targetService: 'orders',
    });
    expect(response.json().session).toBeUndefined();
  });

  it('POST /v1/vp/verify with session true returns a JWT session', async () => {
    const holder = makeActor();
    const vc = await makeAgentVC(issuer, holder.did, ['read:orders']);
    const vp = await buildSignedVP([vc], holder, USER_DID);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/verify',
      payload: { signedVP: vp, session: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.session.token).toBeTruthy();
    expect(body.session.publicKeyEndpoint).toBe('/v1/sessions/public-key');
    const payload = decodeJwtPayload(body.session.token as string);
    expect(payload['sub']).toBe(holder.did);
    expect(payload['scopes']).toEqual(['read:orders']);
  });

  it('a VP without delegatedBy verifies and omits userDid from the response', async () => {
    const holder = makeActor();
    const vc = await makeAgentVC(issuer, holder.did);
    const vp = await buildSignedVP([vc], holder);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/verify',
      payload: { signedVP: vp },
    });

    expect(response.statusCode).toBe(200);
    expect('userDid' in response.json()).toBe(false);
  });

  it('rejection responses carry the opaque error envelope with requestId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/verify',
      payload: { signedVP: { garbage: true } },
    });

    expect(response.statusCode).toBe(400);
    const error = response.json().error;
    expect(error.code).toBe('VP_VERIFICATION_FAILED');
    expect(error.requestId).toBeTruthy();
  });
});
