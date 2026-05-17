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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DidRepository } from '../../src/repositories/did.repository.js';
import type { PrismaClient } from '@prisma/client';

describe('DidRepository', () => {
  let mockPrisma: {
    did: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    didUpdate: {
      create: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let repo: DidRepository;

  beforeEach(() => {
    mockPrisma = {
      did: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      didUpdate: {
        create: vi.fn(),
      },
      $transaction: vi.fn((ops) => Promise.all(ops)),
    };
    repo = new DidRepository(mockPrisma as unknown as PrismaClient);
  });

  it('calls prisma.did.create', async () => {
    const data = {
      id: 'did:helix:123',
      subjectType: 'agent',
      controller: 'did:helix:123',
      publicKey: 'hex',
      hederaTransactionId: 'tx',
      didDocument: { id: 'did:helix:123' },
    };
    await repo.createDid(data);
    expect(mockPrisma.did.create).toHaveBeenCalledWith({
      data: {
        ...data,
        publicKeyMultibase: null,
      },
    });
  });

  it('finds DID by ID with updates', async () => {
    await repo.findDidById('did:helix:123');
    expect(mockPrisma.did.findUnique).toHaveBeenCalledWith({
      where: { id: 'did:helix:123' },
      include: { updates: true },
    });
  });

  it('updates DID document and creates update record in a transaction', async () => {
    const doc = { id: 'did:helix:123' };
    const update = { updateType: 'add_service', hederaTransactionId: 'tx', payload: {} };
    
    await repo.updateDidDocument('did:helix:123', doc, update);
    
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.did.update).toHaveBeenCalledWith({
      where: { id: 'did:helix:123' },
      data: { didDocument: doc },
    });
  });
});
