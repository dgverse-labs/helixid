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

  it('uses raw Prisma branches for VC writes and lookups', async () => {
    const rawRecord = {
      vcId: 'vc:raw',
      subjectDid: 'did:raw',
      subjectType: 'agent',
      vcJson: { type: ['VerifiableCredential', 'HelixAgentCredential'] },
      privilegeScopes: ['read:orders'],
      statusListIndex: 0,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      renewedByVcId: null,
      createdAt: new Date(),
    };
    const rawPrisma = {
      $connect: vi.fn(),
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([rawRecord])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          rawRecord,
          { ...rawRecord, vcId: 'vc:string', vcJson: '{"type":["VerifiableCredential"]}' },
          { ...rawRecord, vcId: 'vc:null', vcJson: null },
        ]),
      vc: mockPrisma.vc,
      statusListEntry: mockPrisma.statusListEntry,
      $transaction: mockPrisma.$transaction,
    };
    const rawRepository = new VcRepository(rawPrisma as never);

    await expect(rawRepository.createVc({
      vcId: 'vc:raw',
      subjectDid: 'did:raw',
      subjectType: 'agent',
      vcJson: rawRecord.vcJson,
      statusListIndex: 0,
      expiresAt: rawRecord.expiresAt,
    })).resolves.toMatchObject({ vcId: 'vc:raw' });
    await expect(rawRepository.findByVcId('missing')).resolves.toBeNull();
    await expect(rawRepository.findActiveBySubjectDid('did:raw', 'HelixAgentCredential')).resolves.toEqual([rawRecord]);
  });

  it('throws when raw VC insert returns no row and returns raw active records without type filter', async () => {
    const rawRecord = {
      vcId: 'vc:raw',
      subjectDid: 'did:raw',
      subjectType: 'agent',
      vcJson: { type: ['VerifiableCredential'] },
      privilegeScopes: null,
      statusListIndex: 0,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      renewedByVcId: null,
    };
    const rawPrisma = {
      $connect: vi.fn(),
      $queryRawUnsafe: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([rawRecord]),
      vc: mockPrisma.vc,
      statusListEntry: mockPrisma.statusListEntry,
      $transaction: mockPrisma.$transaction,
    };
    const rawRepository = new VcRepository(rawPrisma as never);

    await expect(rawRepository.createVc({
      vcId: 'vc:raw',
      subjectDid: 'did:raw',
      subjectType: 'agent',
      vcJson: rawRecord.vcJson,
      privilegeScopes: ['read:orders'],
      statusListIndex: 0,
      expiresAt: rawRecord.expiresAt,
    })).rejects.toThrow('VC query returned no rows');
    await expect(rawRepository.findActiveBySubjectDid('did:raw')).resolves.toEqual([rawRecord]);
  });
});
