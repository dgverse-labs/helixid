// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { generateKeyPair } from '../../src/core/index.js';
import { createTestPrisma } from '../utils/prisma.js';

import { DIDService } from '../../src/services/did/did.service.js';
import { DidRepository } from '../../src/repositories/did.repository.js';
import { ApiAuditLogger } from '../../src/audit/index.js';
import { MockHederaClient } from '../../src/hedera/mock/MockHederaClient.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import didRoutes from '../../src/routes/did/index.js';

describe('DID API Security', () => {
  let app: any;
  let prisma: PrismaClient;
  let mockHedera: MockHederaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    mockHedera = new MockHederaClient();
    const auditLogger = new ApiAuditLogger(prisma);
    const didRepository = new DidRepository(prisma);
    const didService = new DIDService(didRepository, mockHedera, auditLogger);

    app = Fastify({ logger: false });
    app.addSchema({
      $id: 'Error',
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            requestId: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
          },
        },
      },
    });
    app.addSchema({ $id: 'BadRequest', type: 'object', $ref: 'Error#' });
    app.addSchema({ $id: 'NotFound', type: 'object', $ref: 'Error#' });
    app.addSchema({ $id: 'Conflict', type: 'object', $ref: 'Error#' });

    app.setErrorHandler(errorHandler);
    await app.register(didRoutes, { didService });
    await app.ready();
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.vc.deleteMany();
    await prisma.statusListEntry.deleteMany();
    await prisma.didUpdate.deleteMany();
    await prisma.did.deleteMany();
    mockHedera.reset();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('SECURITY: prevents key reuse (deduplication)', async () => {
    const { publicKey } = generateKeyPair();
    const payload = { publicKeyHex: publicKey, subjectType: 'agent' };

    await app.inject({ method: 'POST', url: '/v1/dids', payload });
    const res = await app.inject({ method: 'POST', url: '/v1/dids', payload: { ...payload, subjectType: 'user' } });

    expect(res.statusCode).toBe(409);
    const count = await prisma.did.count({ where: { publicKey } });
    expect(count).toBe(1);
  });

  it('SECURITY: deactivated DID is blocked for updates', async () => {
    const { publicKey } = generateKeyPair();
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/dids',
      payload: { publicKeyHex: publicKey, subjectType: 'agent' },
    });
    const { id: did } = JSON.parse(createRes.body);

    await app.inject({ method: 'POST', url: `/v1/dids/${did}/deactivate`, payload: { reason: 'test' } });

    const updateRes = await app.inject({
      method: 'POST',
      url: `/v1/dids/${did}/services`,
      payload: { id: '#s1', type: 'LinkedDomains', serviceEndpoint: 'https://a.com' },
    });

    expect(updateRes.statusCode).toBe(410);
  });

  it('SECURITY: audit log contains no private key material', async () => {
    const { publicKey, privateKey } = generateKeyPair();
    await app.inject({
      method: 'POST',
      url: '/v1/dids',
      payload: { publicKeyHex: publicKey, subjectType: 'agent' },
    });

    const logs = await prisma.auditLog.findMany();
    for (const log of logs) {
      const content = JSON.stringify(log);
      expect(content.toLowerCase()).not.toContain('privatekey');
      // Assert no 64-char hex string that matches our private key
      expect(content).not.toContain(privateKey);
    }
  });

  it('SECURITY: non-HTTPS service endpoints are rejected', async () => {
    const { publicKey } = generateKeyPair();
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/dids',
      payload: { 
        publicKeyHex: publicKey, 
        subjectType: 'agent'
      },
    });
    const { id: did } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/dids/${did}/services`,
      payload: { id: '#s1', type: 'LinkedDomains', serviceEndpoint: 'http://unsecure.com' },
    });

    expect(res.statusCode).toBe(400);
  });
});
