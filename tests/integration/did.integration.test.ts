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
import type { PrismaClient } from '@prisma/client';
import { generateKeyPair, ErrorCode } from '../../src/core/index.js';

import { DIDService } from '../../src/services/did/did.service.js';
import { DidRepository } from '../../src/repositories/did.repository.js';
import { ApiAuditLogger } from '../../src/audit/index.js';
import { MockHederaClient } from '../../src/hedera/mock/MockHederaClient.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import didRoutes from '../../src/routes/did/index.js';
import { createTestPrisma } from '../utils/prisma.js';
import { registerErrorSchemas } from '../utils/registerErrorSchemas.js';

describe('DID API Integration', () => {
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
    registerErrorSchemas(app);
    app.setErrorHandler(errorHandler);
    await app.register(didRoutes, { didService });
    await app.ready();
  });

  afterEach(async () => {
    await prisma.vc.deleteMany();
    await prisma.statusListEntry.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.didUpdate.deleteMany();
    await prisma.did.deleteMany();
    mockHedera.reset();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /v1/dids', () => {
    it('creates a new DID and anchors it to Hedera', async () => {
      const { publicKey } = generateKeyPair();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/dids',
        payload: {
          publicKeyHex: publicKey,
          subjectType: 'agent',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toMatch(/^did:hedera:testnet:[0-9a-f]{32}$/);
      expect(body.publicKey).toBe(publicKey);
      expect(mockHedera.anchoredPayloads).toHaveLength(1);
    });

    it('returns 409 when the same public key is used twice', async () => {
      const { publicKey } = generateKeyPair();
      const payload = { publicKeyHex: publicKey, subjectType: 'agent' };

      await app.inject({ method: 'POST', url: '/v1/dids', payload });
      const response = await app.inject({ method: 'POST', url: '/v1/dids', payload });

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe(ErrorCode.DID_ALREADY_EXISTS);
    });

    it('returns 400 for invalid public key', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/dids',
        payload: { publicKeyHex: 'too-short', subjectType: 'agent' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /v1/dids/:did', () => {
    it('resolves an existing DID', async () => {
      const { publicKey } = generateKeyPair();
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/dids',
        payload: { publicKeyHex: publicKey, subjectType: 'user' },
      });
      const { id: did } = JSON.parse(createRes.body);

      const response = await app.inject({
        method: 'GET',
        url: `/v1/dids/${did}`,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).id).toBe(did);
    });

    it('returns 404 for unknown DID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/dids/did:hedera:testnet:0123456789abcdef0123456789abcdef',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /v1/dids/:did/services', () => {
    it('adds a service endpoint and re-anchors', async () => {
      const { publicKey } = generateKeyPair();
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/dids',
        payload: { publicKeyHex: publicKey, subjectType: 'agent' },
      });
      const { id: did } = JSON.parse(createRes.body);

      const response = await app.inject({
        method: 'POST',
        url: `/v1/dids/${did}/services`,
        payload: {
          id: '#service-1',
          type: 'LinkedDomains',
          serviceEndpoint: 'https://example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockHedera.anchoredPayloads).toHaveLength(2);
    });
  });
});
