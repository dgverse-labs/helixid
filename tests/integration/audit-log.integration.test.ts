import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { ErrorCode } from '../../src/core/index.js';

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

  // Audit-enrichment epic §2a — agent-side consent grants.
  it('records CONSENT_GRANTED entries behind admin auth', async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(auditLogRoutes, {
      prefix: '/v1/audit-log',
      auditLogRepository: { list: async () => [] } as unknown as AuditLogRepository,
      auditLogger: { log },
      adminApiKey: 'test-admin-key-0001',
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/consent-granted',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: {
        vcId: 'vc:helix:grant-1',
        agentDid: 'did:key:agent',
        issuer: 'did:web:airline.example',
        userDid: 'did:key:user',
        scopes: ['book:flight'],
        durability: 'standing',
        grantedAt: '2026-07-03T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'CONSENT_GRANTED',
        vcId: 'vc:helix:grant-1',
        agentDid: 'did:key:agent',
        subjectDid: 'did:key:agent',
        issuer: 'did:web:airline.example',
        userDid: 'did:key:user',
        scopes: ['book:flight'],
        durability: 'standing',
        timestamp: '2026-07-03T00:00:00.000Z',
        source: 'sdk',
      }),
    );
    await app.close();
  });

  it('rejects CONSENT_GRANTED entries missing required identifiers', async () => {
    const app = await makeApp({ list: async () => [] });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/consent-granted',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: { issuer: 'did:web:airline.example' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe(ErrorCode.VALIDATION_ERROR);
    await app.close();
  });

  it('requires admin auth for CONSENT_GRANTED', async () => {
    const app = await makeApp({ list: async () => [] });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/consent-granted',
      payload: { vcId: 'vc:helix:grant-1', agentDid: 'did:key:agent' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('surfaces consent and attempted-rejection fields in the listing', async () => {
    const app = await makeApp({
      list: async () => [
        {
          id: '1',
          eventType: 'VP_REJECTED',
          timestamp: new Date('2026-07-03T00:00:00.000Z'),
          requestId: 'req-1',
          payload: {
            subjectDid: 'did:key:agent',
            vpId: 'vp:test:1',
            attemptedVcId: 'vc:helix:attempted',
            attemptedParentVcId: 'vc:helix:parent',
            attemptedDelegatedFrom: 'did:key:parent',
          },
        },
        {
          id: '2',
          eventType: 'CONSENT_GRANTED',
          timestamp: new Date('2026-07-03T00:00:01.000Z'),
          requestId: 'req-2',
          payload: {
            subjectDid: 'did:key:agent',
            vcId: 'vc:helix:grant-1',
            userDid: 'did:key:user',
            scopes: ['book:flight'],
            durability: 'standing',
          },
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?limit=10',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
    });

    expect(response.statusCode).toBe(200);
    const [rejected, granted] = JSON.parse(response.body);
    expect(rejected).toMatchObject({
      eventType: 'VP_REJECTED',
      attemptedVcId: 'vc:helix:attempted',
      attemptedParentVcId: 'vc:helix:parent',
      attemptedDelegatedFrom: 'did:key:parent',
    });
    // Unverified context must not be laundered into the verified fields.
    expect(rejected.delegatedFrom).toBeUndefined();
    expect(rejected.parentVcId).toBeUndefined();
    expect(granted).toMatchObject({
      eventType: 'CONSENT_GRANTED',
      vcId: 'vc:helix:grant-1',
      userDid: 'did:key:user',
      scopes: ['book:flight'],
      durability: 'standing',
    });
    await app.close();
  });

  // Activity-trail ingestion — the shared envelope SPs and agents both post to.
  it('records an activity event with the full envelope', async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(auditLogRoutes, {
      prefix: '/v1/audit-log',
      auditLogRepository: { list: async () => [] } as unknown as AuditLogRepository,
      auditLogger: { log },
      adminApiKey: 'test-admin-key-0001',
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/events',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: {
        event: 'AUTHZ_DENIED',
        correlationId: 'act_abc123',
        agentDid: 'did:key:agent',
        userDid: 'did:web:traveler.example',
        serviceDid: 'did:web:localhost%3A4102',
        serviceName: 'Helix Stay',
        toolName: 'book_hotel',
        requiredScope: 'book:hotel',
        effectiveScopes: ['book:flights'],
        result: 'blocked',
        reason: 'INSUFFICIENT_EFFECTIVE_SCOPE',
        resultSummary: 'book_hotel blocked',
        timestamp: '2026-07-03T00:00:00.000Z',
        source: 'sp',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUTHZ_DENIED',
        correlationId: 'act_abc123',
        agentDid: 'did:key:agent',
        subjectDid: 'did:key:agent',
        userDid: 'did:web:traveler.example',
        serviceDid: 'did:web:localhost%3A4102',
        serviceName: 'Helix Stay',
        toolName: 'book_hotel',
        requiredScope: 'book:hotel',
        effectiveScopes: ['book:flights'],
        result: 'blocked',
        reason: 'INSUFFICIENT_EFFECTIVE_SCOPE',
        timestamp: '2026-07-03T00:00:00.000Z',
        source: 'sp',
      }),
    );
    await app.close();
  });

  it('falls back to serviceDid as subject when no agent is known', async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(auditLogRoutes, {
      prefix: '/v1/audit-log',
      auditLogRepository: { list: async () => [] } as unknown as AuditLogRepository,
      auditLogger: { log },
      adminApiKey: 'test-admin-key-0001',
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/events',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: { event: 'TOOL_INVOKED', serviceDid: 'did:web:sp', toolName: 'search_flights' },
    });

    expect(response.statusCode).toBe(201);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ subjectDid: 'did:web:sp' }));
    await app.close();
  });

  it('rejects event types outside the ingestion allowlist', async () => {
    const app = await makeApp({ list: async () => [] });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/events',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: { event: 'TOTALLY_MADE_UP', agentDid: 'did:key:agent' },
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe(ErrorCode.VALIDATION_ERROR);
    await app.close();
  });

  it('rejects an activity event with neither agentDid nor serviceDid', async () => {
    const app = await makeApp({ list: async () => [] });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/events',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: { event: 'TOOL_INVOKED', toolName: 'search_flights' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('requires admin auth for activity ingestion', async () => {
    const app = await makeApp({ list: async () => [] });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/audit-log/events',
      payload: { event: 'TOOL_INVOKED', agentDid: 'did:key:agent' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('projects activity fields into the listing', async () => {
    const app = await makeApp({
      list: async () => [
        {
          id: '1',
          eventType: 'AUTHZ_DENIED',
          timestamp: new Date('2026-07-03T00:00:00.000Z'),
          requestId: 'req-1',
          payload: {
            subjectDid: 'did:key:agent',
            correlationId: 'act_abc123',
            serviceName: 'Helix Stay',
            toolName: 'book_hotel',
            requiredScope: 'book:hotel',
            effectiveScopes: ['book:flights'],
            result: 'blocked',
            reason: 'INSUFFICIENT_EFFECTIVE_SCOPE',
            resultSummary: 'book_hotel blocked',
          },
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit-log?limit=10',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)[0]).toMatchObject({
      eventType: 'AUTHZ_DENIED',
      correlationId: 'act_abc123',
      serviceName: 'Helix Stay',
      toolName: 'book_hotel',
      requiredScope: 'book:hotel',
      effectiveScopes: ['book:flights'],
      result: 'blocked',
      reason: 'INSUFFICIENT_EFFECTIVE_SCOPE',
      resultSummary: 'book_hotel blocked',
    });
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
