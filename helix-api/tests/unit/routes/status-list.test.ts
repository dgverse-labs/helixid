// Copyright 2026 DgVerse LLP
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, createStatusList } from '@helixid/core';
import { errorHandler } from '../../../src/middleware/errorHandler.js';
import statusListRoutes from '../../../src/routes/status-list/index.js';

describe('status-list routes', () => {
  it('creates or replaces the status list with admin auth', async () => {
    const vcService = {
      getStatusList: vi.fn().mockResolvedValue({
        credentialSubject: { encodedList: createStatusList() },
      }),
      createStatusList: vi.fn().mockResolvedValue({
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        id: 'http://localhost:3000/v1/status-list/helix-status-list-1',
        type: ['VerifiableCredential', 'BitstringStatusListCredential'],
        issuer: 'did:web:localhost:3000',
        validFrom: new Date().toISOString(),
        credentialSubject: {
          id: 'http://localhost:3000/v1/status-list/helix-status-list-1#list',
          type: 'BitstringStatusList' as const,
          statusPurpose: 'revocation' as const,
          encodedList: createStatusList(),
        },
      }),
    };

    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(statusListRoutes, {
      prefix: '/v1/status-list',
      vcService: vcService as never,
      adminApiKey: 'test-admin-key',
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/status-list',
      headers: { 'x-admin-api-key': 'test-admin-key' },
      payload: { length: 64 },
    });

    expect(response.statusCode).toBe(201);
    expect(vcService.createStatusList).toHaveBeenCalledWith({ length: 64 });
    expect(JSON.parse(response.body).type).toContain('BitstringStatusListCredential');

    await app.close();
  });

  it('rejects create without admin auth', async () => {
    const vcService = {
      getStatusList: vi.fn(),
      createStatusList: vi.fn(),
    };

    const app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(statusListRoutes, {
      prefix: '/v1/status-list',
      vcService: vcService as never,
      adminApiKey: 'test-admin-key',
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/status-list',
      payload: { length: 64 },
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe(ErrorCode.ADMIN_AUTH_REQUIRED);

    await app.close();
  });
});
