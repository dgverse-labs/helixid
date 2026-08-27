// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogRepository } from '../../../src/repositories/audit-log.repository.js';

describe('AuditLogRepository', () => {
  describe('with prisma', () => {
    let mockPrisma: any;
    let repository: AuditLogRepository;

    beforeEach(() => {
      mockPrisma = { auditLog: { findMany: vi.fn() } };
      repository = new AuditLogRepository(mockPrisma);
    });

    it('queries newest first with filters applied', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'row1',
          timestamp: new Date('2026-06-01T00:00:00.000Z'),
          eventType: 'VC_ISSUED',
          requestId: 'req_1',
          payloadJson: '{"vcId":"vc:1"}',
        },
      ]);

      const since = new Date('2026-05-01T00:00:00.000Z');
      const result = await repository.list({ eventType: 'VC_ISSUED', since, limit: 10 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { eventType: 'VC_ISSUED', timestamp: { gte: since } },
        orderBy: { timestamp: 'desc' },
        take: 10,
      });
      expect(result).toEqual([
        {
          id: 'row1',
          timestamp: new Date('2026-06-01T00:00:00.000Z'),
          eventType: 'VC_ISSUED',
          requestId: 'req_1',
          payload: { vcId: 'vc:1' },
        },
      ]);
    });

    it('omits where clauses when no filters are given', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await repository.list({ limit: 50 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { timestamp: 'desc' },
        take: 50,
      });
    });
  });

  describe('with sqlite', () => {
    it('builds WHERE and LIMIT clauses and maps snake_case rows', async () => {
      const query = vi.fn().mockReturnValue([
        {
          id: 7,
          timestamp: '2026-06-01T00:00:00.000Z',
          event_type: 'AGENT_ONBOARDED',
          request_id: 'req_7',
          payload_json: '{"agentDid":"did:1"}',
        },
      ]);
      const repository = new AuditLogRepository(undefined, { query } as any);

      const result = await repository.list({
        eventType: 'AGENT_ONBOARDED',
        since: new Date('2026-05-01T00:00:00.000Z'),
        limit: 20,
      });

      const sql = query.mock.calls[0]![0] as string;
      expect(sql).toContain("event_type = 'AGENT_ONBOARDED'");
      expect(sql).toContain("timestamp >= '2026-05-01T00:00:00.000Z'");
      expect(sql).toContain('ORDER BY timestamp DESC, id DESC');
      expect(sql).toContain('LIMIT 20');
      expect(result).toEqual([
        {
          id: '7',
          timestamp: new Date('2026-06-01T00:00:00.000Z'),
          eventType: 'AGENT_ONBOARDED',
          requestId: 'req_7',
          payload: { agentDid: 'did:1' },
        },
      ]);
    });

    it('omits WHERE when no filters are given', async () => {
      const query = vi.fn().mockReturnValue([]);
      const repository = new AuditLogRepository(undefined, { query } as any);

      await repository.list({ limit: 50 });

      const sql = query.mock.calls[0]![0] as string;
      expect(sql).not.toContain('WHERE');
    });
  });

  it('returns an empty list when no queryable store is configured', async () => {
    const repository = new AuditLogRepository();
    await expect(repository.list({ limit: 50 })).resolves.toEqual([]);
  });
});
