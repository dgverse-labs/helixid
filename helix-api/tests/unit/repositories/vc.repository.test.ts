// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VcRepository } from '../../../src/repositories/vc.repository.js';

describe('VcRepository Unit Tests', () => {
  let mockPrisma: any;
  let repository: VcRepository;

  beforeEach(() => {
    mockPrisma = {
      vc: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      statusListEntry: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((cb) => cb(mockPrisma)),
    };
    repository = new VcRepository(mockPrisma);
  });

  it('creates a VC', async () => {
    const params = {
      vcId: 'vc1',
      subjectDid: 'did:1',
      subjectType: 'user',
      vcJson: {},
      statusListIndex: 0,
      expiresAt: new Date(),
    };
    await repository.createVc(params);
    expect(mockPrisma.vc.create).toHaveBeenCalled();
  });

  it('marks as renewed', async () => {
    await repository.markAsRenewed('v1', 'v2');
    expect(mockPrisma.vc.update).toHaveBeenCalledWith({
      where: { vcId: 'v1' },
      data: { renewedByVcId: 'v2' }
    });
  });

  it('finds active by subject DID', async () => {
    mockPrisma.vc.findMany.mockResolvedValue([{ vcId: 'v1' }]);
    const res = await repository.findActiveBySubjectDid('did:1');
    expect(res).toHaveLength(1);
    expect(mockPrisma.vc.findMany).toHaveBeenCalled();
  });

  it('filters active VCs by credential type', async () => {
    mockPrisma.vc.findMany.mockResolvedValue([
      { vcId: 'v1', vcJson: { type: ['VerifiableCredential', 'HelixAgentCredential'] } },
      { vcId: 'v2', vcJson: '{"type":["VerifiableCredential"]}' },
      { vcId: 'v3', vcJson: null },
    ]);

    const res = await repository.findActiveBySubjectDid('did:1', 'HelixAgentCredential');

    expect(res).toEqual([
      { vcId: 'v1', vcJson: { type: ['VerifiableCredential', 'HelixAgentCredential'] } },
    ]);
  });

  it('back-compat createVC works', async () => {
    await repository.createVC({ vcId: 'v1', subjectDid: 'd1', vcJson: '{}', expiresAt: new Date() });
    expect(mockPrisma.vc.create).toHaveBeenCalled();
  });
});
