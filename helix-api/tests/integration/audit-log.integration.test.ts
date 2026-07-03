// Copyright 2026 DgVerse LLP
import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import auditRoutes from '../../src/routes/audit/index.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';

const ADMIN_KEY = 'test-admin-key-0001';

async function buildApp(findMany = vi.fn().mockResolvedValue([])): Promise<{
  app: FastifyInstance;
  findMany: ReturnType<typeof vi.fn>;
}> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await app.register(auditRoutes, {
    prefix: '/v1/audit-log',
    auditLogRepository: { findMany } as never,
    adminApiKey: ADMIN_KEY,
  });
  await app.ready();
  return { app, findMany };
}

describe('GET /v1/audit-log', () => {
  it('rejects requests without the admin key', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/v1/audit-log' });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('maps spec event names to canonical types and back', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: '1',
        timestamp: '2026-06-02T00:00:00.000Z',
        eventType: 'AGENT_ONBOARDED',
        requestId: 'req_1',
        payloadJson: JSON.stringify({ agentDid: 'did:agent:1', agentName: 'billing' }),
      },
    ]);
    const { app } = await buildApp(findMany);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?eventType=onboarding_complete&since=2026-06-01T00:00:00.000Z&limit=5',
      headers: { 'x-admin-api-key': ADMIN_KEY },
    });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith({
      eventType: 'AGENT_ONBOARDED',
      since: new Date('2026-06-01T00:00:00.000Z'),
      limit: 5,
    });
    expect(response.json()).toEqual([
      {
        id: '1',
        eventType: 'onboarding_complete',
        timestamp: '2026-06-02T00:00:00.000Z',
        subjectDid: 'did:agent:1',
      },
    ]);
    await app.close();
  });

  it('extracts subjectDid, vcId, targetService and result from the payload', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: '2',
        timestamp: '2026-06-02T00:00:00.000Z',
        eventType: 'VC_REVOKED',
        requestId: 'req_2',
        payloadJson: JSON.stringify({ subjectDid: 'did:agent:2', vcId: 'vc:2' }),
      },
      {
        id: '3',
        timestamp: '2026-06-02T00:00:01.000Z',
        eventType: 'VP_VERIFIED',
        requestId: 'req_3',
        payloadJson: JSON.stringify({
          agentDid: 'did:agent:3',
          targetService: 'orders-api',
          result: 'success',
        }),
      },
      {
        id: '4',
        timestamp: '2026-06-02T00:00:02.000Z',
        eventType: 'DID_CREATED',
        requestId: 'req_4',
        payloadJson: 'not-json',
      },
    ]);
    const { app } = await buildApp(findMany);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit-log',
      headers: { 'x-admin-api-key': ADMIN_KEY },
    });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith({ eventType: undefined, since: undefined, limit: 50 });
    expect(response.json()).toEqual([
      {
        id: '2',
        eventType: 'vc_revoked',
        timestamp: '2026-06-02T00:00:00.000Z',
        subjectDid: 'did:agent:2',
        vcId: 'vc:2',
      },
      {
        id: '3',
        eventType: 'vp_verified',
        timestamp: '2026-06-02T00:00:01.000Z',
        subjectDid: 'did:agent:3',
        targetService: 'orders-api',
        result: 'success',
      },
      {
        id: '4',
        eventType: 'did_created',
        timestamp: '2026-06-02T00:00:02.000Z',
      },
    ]);
    await app.close();
  });

  it('accepts canonical event names as a filter', async () => {
    const { app, findMany } = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?eventType=VC_RENEWED',
      headers: { 'x-admin-api-key': ADMIN_KEY },
    });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith({
      eventType: 'VC_RENEWED',
      since: undefined,
      limit: 50,
    });
    await app.close();
  });

  it('rejects unknown eventType, invalid since and invalid limit', async () => {
    const { app } = await buildApp();
    const headers = { 'x-admin-api-key': ADMIN_KEY };

    const badEvent = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?eventType=nonsense',
      headers,
    });
    expect(badEvent.statusCode).toBe(400);

    const badSince = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?since=not-a-date',
      headers,
    });
    expect(badSince.statusCode).toBe(400);

    const badLimit = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?limit=zero',
      headers,
    });
    expect(badLimit.statusCode).toBe(400);

    await app.close();
  });
});
