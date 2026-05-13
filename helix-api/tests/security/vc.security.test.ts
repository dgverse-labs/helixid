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

import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'node:crypto';
import * as bs58 from 'bs58';

import { VCService } from '../../src/services/vc/vc.service.js';
import { VcRepository } from '../../src/repositories/vc.repository.js';
import { DIDService } from '../../src/services/did/did.service.js';
import { DidRepository } from '../../src/repositories/did.repository.js';
import { ApiAuditLogger } from '../../src/audit/index.js';
import { MockHederaClient } from '../../src/hedera/mock/MockHederaClient.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import vcRoutes from '../../src/routes/vc/index.js';

describe('VC Security', () => {
  let app: any;
  let prisma: PrismaClient;
  let didId: string;
  const signingKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(async () => {
    prisma = new PrismaClient({ 
      datasources: { db: { url: process.env['DATABASE_URL'] || 'postgresql://postgres:postgres@localhost:5432/helixid?schema=public' } } 
    });
    
    const auditLogger = new ApiAuditLogger(prisma);
    const didRepo = new DidRepository(prisma);
    const vcRepo = new VcRepository(prisma);
    
    const didService = new DIDService(didRepo, new MockHederaClient(), auditLogger);
    const vcService = new VCService(vcRepo, didService, auditLogger, signingKeyHex, 'http://localhost:3000');

    app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
    await app.register(vcRoutes, { prefix: '/v1/vcs', vcService });
    await app.ready();

    const didRec = await didRepo.createDid({
      id: 'did:helix:securitysubject',
      subjectType: 'agent',
      controller: 'did:helix:securitysubject',
      publicKey: 'b'.repeat(64),
      hederaTransactionId: 'tx-2',
      didDocument: { id: 'did:helix:securitysubject' },
    });
    didId = didRec.id;
  });

  afterEach(async () => {
    await prisma.vc.deleteMany();
    await prisma.status_list_entries.deleteMany();
  });

  afterAll(async () => {
    await prisma.did.deleteMany();
    await app.close();
    await prisma.$disconnect();
  });

  it('SECURITY: issued VC proof value verifies against signing public key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vcs',
      payload: { subjectDid: didId, subjectType: 'user' },
    });
    const { vc } = JSON.parse(res.body);

    const proofValue = vc.proof.proofValue;
    const signature = bs58.default.decode(proofValue);
    
    const credentialWithoutProof = { ...vc };
    delete credentialWithoutProof.proof;
    const canonical = JSON.stringify(credentialWithoutProof);

    const publicKey = crypto.createPublicKey({
      key: crypto.createPrivateKey({
        key: Buffer.from(signingKeyHex, 'hex'),
        format: 'der',
        type: 'pkcs8',
      }),
    });

    const isValid = crypto.verify(null, Buffer.from(canonical), publicKey, signature);
    expect(isValid).toBe(true);
  });

  it('SECURITY: tampered VC fails verification', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vcs',
      payload: { subjectDid: didId, subjectType: 'agent', agentName: 'Original' },
    });
    const { vc } = JSON.parse(res.body);

    // Tamper with subject
    vc.credentialSubject.agentName = 'TAMPERED';

    const proofValue = vc.proof.proofValue;
    const signature = bs58.default.decode(proofValue);
    const credentialWithoutProof = { ...vc };
    delete credentialWithoutProof.proof;
    const canonical = JSON.stringify(credentialWithoutProof);

    const publicKey = crypto.createPublicKey({
      key: crypto.createPrivateKey({
        key: Buffer.from(signingKeyHex, 'hex'),
        format: 'der',
        type: 'pkcs8',
      }),
    });

    const isValid = crypto.verify(null, Buffer.from(canonical), publicKey, signature);
    expect(isValid).toBe(false);
  });

  it('SECURITY: concurrent issuance assigns unique status indices', async () => {
    const requests = Array.from({ length: 5 }, () => app.inject({
      method: 'POST',
      url: '/v1/vcs',
      payload: { subjectDid: didId, subjectType: 'user' },
    }));

    const responses = await Promise.all(requests);
    const indices = responses.map(r => JSON.parse(r.body).statusListIndex);
    
    // Check for uniqueness
    const uniqueIndices = new Set(indices);
    expect(uniqueIndices.size).toBe(5);
  });
});
