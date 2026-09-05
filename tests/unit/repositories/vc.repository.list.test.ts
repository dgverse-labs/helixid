// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VcRepository } from '../../../src/repositories/vc.repository.js';

describe('VcRepository.findMany', () => {
  describe('with prisma', () => {
    let mockPrisma: any;
    let repository: VcRepository;

    beforeEach(() => {
      mockPrisma = { vc: { findMany: vi.fn().mockResolvedValue([]) } };
      repository = new VcRepository(mockPrisma);
    });

    it('queries all VCs newest first', async () => {
      await repository.findMany();
      expect(mockPrisma.vc.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
      });
    });

    it('filters by subjectDid when provided', async () => {
      await repository.findMany({ subjectDid: 'did:1' });
      expect(mockPrisma.vc.findMany).toHaveBeenCalledWith({
        where: { subjectDid: 'did:1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('with sqlite', () => {
    it('builds the WHERE clause and maps rows', async () => {
      const query = vi.fn().mockReturnValue([
        {
          vc_id: 'vc:1',
          subject_did: 'did:1',
          subject_type: 'agent',
          vc_json: '{"id":"vc:1"}',
          privilege_scopes: '["read:orders"]',
          status_list_index: 0,
          expires_at: '2026-09-01T00:00:00.000Z',
          revoked_at: null,
          renewed_by_vc_id: null,
          delegated_from: null,
          delegation_depth: null,
          max_delegation_depth: null,
          parent_vc_id: 'vc:parent',
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
        },
      ]);
      const repository = new VcRepository(undefined, { query } as any);

      const result = await repository.findMany({ subjectDid: 'did:1' });

      const sql = query.mock.calls[0]![0] as string;
      expect(sql).toContain("WHERE subject_did = 'did:1'");
      expect(sql).toContain('ORDER BY created_at DESC');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        vcId: 'vc:1',
        subjectDid: 'did:1',
        privilegeScopes: ['read:orders'],
        parentVcId: 'vc:parent',
      });
    });
  });

  describe('in memory', () => {
    it('filters by subjectDid and sorts newest first', async () => {
      const repository = new VcRepository();
      const base = {
        subjectType: 'agent',
        vcJson: {},
        statusListIndex: 0,
        expiresAt: new Date(Date.now() + 60_000),
      };
      await repository.createVc({ ...base, vcId: 'vc:old', subjectDid: 'did:1' });
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 5));
      await repository.createVc({ ...base, vcId: 'vc:new', subjectDid: 'did:1' });
      await repository.createVc({ ...base, vcId: 'vc:other', subjectDid: 'did:2' });

      const all = await repository.findMany();
      expect(all).toHaveLength(3);

      const filtered = await repository.findMany({ subjectDid: 'did:1' });
      expect(filtered.map((r) => r.vcId)).toEqual(['vc:new', 'vc:old']);
    });
  });
});
