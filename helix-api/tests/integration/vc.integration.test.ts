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
import { buildDIDDocument, derivePublicKey, ErrorCode } from '@helix-id/core';

import { VCService } from '../../src/services/vc/vc.service.js';
import { VcRepository } from '../../src/repositories/vc.repository.js';
import { DIDService } from '../../src/services/did/did.service.js';
import { DidRepository } from '../../src/repositories/did.repository.js';
import { ApiAuditLogger } from '../../src/audit/index.js';
import { MockHederaClient } from '../../src/hedera/mock/MockHederaClient.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import vcRoutes from '../../src/routes/vc/index.js';
import statusListRoutes from '../../src/routes/status-list/index.js';
import { createTestPrisma } from '../utils/prisma.js';

describe('VC API Integration', () => {
  let app: any;
  let prisma: PrismaClient;
  let didId: string;
  const signingKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const issuerDid = 'did:hedera:testnet:testissuer';

  beforeAll(async () => {
    prisma = createTestPrisma();
    
    const auditLogger = new ApiAuditLogger(prisma);
    const didRepo = new DidRepository(prisma);
    const vcRepo = new VcRepository(prisma);
    const mockHedera = new MockHederaClient();
    
    const didService = new DIDService(didRepo, mockHedera, auditLogger);
    const vcService = new VCService(
      vcRepo, 
      didService, 
      auditLogger, 
      signingKey,
      issuerDid,
      'http://localhost:3000'
    );

    app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(vcRoutes, { prefix: '/v1/vcs', vcService, adminApiKey: 'test-admin-key-0001' });
    await app.register(statusListRoutes, { prefix: '/v1/status-list', vcService });
    await app.ready();

    // Create a test DID to issue VCs to
    const didRec = await didRepo.createDid({
      id: 'did:hedera:testnet:testsubject',
      subjectType: 'agent',
      controller: 'did:hedera:testnet:testsubject',
      publicKey: 'a'.repeat(64),
      hederaTransactionId: 'tx-1',
      didDocument: { id: 'did:hedera:testnet:testsubject' },
    });
    didId = didRec.id;

    const issuerPublicKey = derivePublicKey(signingKey);
    const issuerDocument = buildDIDDocument(issuerDid, issuerPublicKey);
    await didRepo.createDid({
      id: issuerDid,
      subjectType: 'user',
      controller: issuerDid,
      publicKey: issuerPublicKey,
      publicKeyMultibase: issuerDocument.verificationMethod[0]!.publicKeyMultibase,
      hederaTransactionId: 'tx-issuer',
      didDocument: issuerDocument,
    });
  });

  afterEach(async () => {
    await prisma.vc.deleteMany();
    await prisma.statusListEntry.deleteMany();
  });

  afterAll(async () => {
    await prisma.did.deleteMany();
    await app.close();
    await prisma.$disconnect();
  });

  async function issueUserVC(): Promise<string> {
    const issueRes = await app.inject({
      method: 'POST',
      url: '/v1/vcs',
      headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      payload: { subjectDid: didId, subjectType: 'user', userId: 'test-user' },
    });
    return JSON.parse(issueRes.body).vcId as string;
  }

  describe('POST /v1/vcs', () => {
    it('issues an agent VC successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/vcs',
        headers: { 'x-admin-api-key': 'test-admin-key-0001' },
        payload: {
          subjectDid: didId,
          subjectType: 'agent',
          privilegeScopes: ['read:orders'],
          agentName: 'Test Agent',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.vcId).toMatch(/^vc:helix:[0-9a-f]{24}$/);
      expect(body.vc.validFrom).toBeDefined();
      expect(body.vc.validUntil).toBeDefined();
      expect(body.vc.credentialStatus.type).toBe('BitstringStatusListEntry');
      expect(body.vc.credentialSubject.privilegeScopes).toContain('read:orders');
    });

    it('requires admin authorization for issuance', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/vcs',
        payload: { subjectDid: didId, subjectType: 'user', userId: 'test-user' },
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe(ErrorCode.ADMIN_AUTH_REQUIRED);
    });

    it('returns 404 for unknown subject DID', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/vcs',
        headers: { 'x-admin-api-key': 'test-admin-key-0001' },
        payload: {
          subjectDid: 'did:hedera:testnet:unknown',
          subjectType: 'user',
          userId: 'unknown-user',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe(ErrorCode.VC_SUBJECT_DID_NOT_FOUND);
    });
  });

  describe('POST /v1/vcs/delegate', () => {
    it('is removed from the API', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/vcs/delegate',
        headers: { 'x-admin-api-key': 'test-admin-key-0001' },
        payload: {
          delegatorVP: {},
          delegateeAgentDid: didId,
          requestedScopes: ['read:orders'],
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /v1/vcs/:vcId', () => {
    it('resolves an existing VC', async () => {
      const vcId = await issueUserVC();

      const response = await app.inject({
        method: 'GET',
        url: `/v1/vcs/${vcId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).vcId).toBe(vcId);
      expect(JSON.parse(response.body).status).toBe('active');
    });
  });

  describe('POST /v1/vcs/:vcId/revoke', () => {
    it('revokes a VC and updates the status list', async () => {
      const vcId = await issueUserVC();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/vcs/${vcId}/revoke`,
        headers: { 'x-admin-api-key': 'test-admin-key-0001' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).revoked).toBe(true);

      const getRes = await app.inject({ method: 'GET', url: `/v1/vcs/${vcId}` });
      expect(JSON.parse(getRes.body).status).toBe('revoked');
    });

    it('requires admin authorization', async () => {
      const vcId = await issueUserVC();

      const response = await app.inject({
        method: 'POST',
        url: `/v1/vcs/${vcId}/revoke`,
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error.code).toBe(ErrorCode.ADMIN_AUTH_REQUIRED);
    });
  });

  describe('GET /v1/status-list/:listId', () => {
    it('serves the status list credential with caching headers', async () => {
      await issueUserVC();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/status-list/helix-status-list-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      const body = JSON.parse(response.body);
      expect(body.type).toContain('BitstringStatusListCredential');
    });
  });
});
