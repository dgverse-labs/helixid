// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DidRepository } from '../../../src/repositories/did.repository.js';

describe('DidRepository Unit Tests', () => {
  let mockPrisma: any;
  let repository: DidRepository;

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
      $transaction: vi.fn((cb) => cb),
    };
    repository = new DidRepository(mockPrisma);
  });

  it('creates a DID', async () => {
    await repository.create({ id: 'did:1', subjectType: 'user', controller: 'c', publicKey: 'p', hederaTransactionId: 'tx', didDocument: {} });
    expect(mockPrisma.did.create).toHaveBeenCalled();
  });

  it('finds DID by ID', async () => {
    await repository.findDidById('did:1');
    expect(mockPrisma.did.findUnique).toHaveBeenCalled();
  });

  it('deactivates DID', async () => {
    const now = new Date();
    await repository.deactivateDid('did:1', now);
    expect(mockPrisma.did.update).toHaveBeenCalledWith(expect.objectContaining({ data: { deactivatedAt: now } }));
  });
});
