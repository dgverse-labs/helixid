import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { ErrorCode } from '@helixid/core';

import auditLogRoutes from '../../src/routes/audit-log/index.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log.repository.js';

describe('Audit log route surface', () => {
  async function makeApp(repository: Pick<AuditLogRepository, 'list'>) {
    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(auditLogRoutes, {
      prefix: '/v1/audit-log',
      auditLogRepository: repository as AuditLogRepository,
      auditLogger: {
        log: async () => undefined,
      },
      adminApiKey: 'test-admin-key-0001',
    });
    await app.ready();
    return app;
  }

  it('lists audit events behind admin auth', async () => {
    const app = await makeApp({
      list: async () => [
        {
          id: '1',
          eventType: 'VC_ISSUED',
          timestamp: new Date('2026-07-03T00:00:00.000Z'),
          requestId: 'req-1',
          payload: {
            subjectDid: 'did:hedera:testnet:agent',
            vcId: 'vc:helix:abc',
            result: 'success',
          },
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?eventType=VC_ISSUED&limit=10',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([
      {
        id: '1',
        eventType: 'VC_ISSUED',
        timestamp: '2026-07-03T00:00:00.000Z',
        subjectDid: 'did:hedera:testnet:agent',
        vcId: 'vc:helix:abc',
        result: 'success',
        delegatedTo: 'did:hedera:testnet:agent',
      },
    ]);
    await app.close();
  });

  it('requires admin auth', async () => {
    const app = await makeApp({ list: async () => [] });

    const response = await app.inject({ method: 'GET', url: '/v1/audit-log' });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe(ErrorCode.ADMIN_AUTH_REQUIRED);
    await app.close();
  });

  it('records VP verification audit entries behind admin auth', async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(auditLogRoutes, {
      prefix: '/v1/audit-log',
      auditLogRepository: { list: async () => [] } as AuditLogRepository,
      auditLogger: { log },
      adminApiKey: 'test-admin-key-0001',
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/vp-verification',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: {
        vpId: 'vp:test:1',
        agentDid: 'did:key:agent',
        targetService: 'orders',
        result: 'success',
        delegatedFrom: 'did:key:parent',
        delegatedTo: 'did:key:agent',
        parentVcId: 'vc:parent',
        delegationDepth: 1,
        verifiedAt: '2026-07-03T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'VP_VERIFIED',
        requestId: expect.any(String),
        vpId: 'vp:test:1',
        agentDid: 'did:key:agent',
        subjectDid: 'did:key:agent',
        targetService: 'orders',
        result: 'success',
        delegatedFrom: 'did:key:parent',
        delegatedTo: 'did:key:agent',
        parentVcId: 'vc:parent',
        delegationDepth: 1,
        source: 'sdk',
      }),
    );
    await app.close();
  });

  it('derives delegation context from verification audit payloads', async () => {
    const app = await makeApp({
      list: async () => [
        {
          id: '1',
          eventType: 'VP_VERIFIED',
          timestamp: new Date('2026-07-03T00:00:00.000Z'),
          requestId: 'req-1',
          payload: {
            subjectDid: 'did:key:agent',
            vpId: 'vp:test:1',
            result: 'success',
            delegatedFrom: 'did:key:parent',
            delegatedTo: 'did:key:agent',
            parentVcId: 'vc:parent',
            delegationDepth: 2,
          },
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?eventType=VP_VERIFIED&limit=10',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual([
      {
        id: '1',
        eventType: 'VP_VERIFIED',
        timestamp: '2026-07-03T00:00:00.000Z',
        subjectDid: 'did:key:agent',
        vcId: 'vp:test:1',
        result: 'success',
        delegatedFrom: 'did:key:parent',
        delegatedTo: 'did:key:agent',
        parentVcId: 'vc:parent',
        delegationDepth: 2,
      },
    ]);
    await app.close();
  });
});
