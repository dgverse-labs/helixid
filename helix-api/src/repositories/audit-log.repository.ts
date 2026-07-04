import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

export interface AuditLogRecord {
  id: string;
  eventType: string;
  timestamp: Date;
  requestId: string | null;
  payload: Record<string, unknown>;
}

export interface ListAuditLogFilters {
  eventType?: string | undefined;
  since?: Date | undefined;
  limit: number;
}

type PrismaLike = PrismaClient & {
  auditLog: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        eventType: string;
        timestamp: Date;
        requestId: string | null;
        payloadJson: string;
      }>
    >;
  };
};

type SqliteAuditLogRow = {
  id: number;
  event_type: string;
  timestamp: string;
  request_id: string | null;
  payload_json: string;
};

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fromSqliteRow(row: SqliteAuditLogRow): AuditLogRecord {
  return {
    id: String(row.id),
    eventType: row.event_type,
    timestamp: new Date(row.timestamp),
    requestId: row.request_id,
    payload: parsePayload(row.payload_json),
  };
}

export class AuditLogRepository {
  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  private get db(): PrismaLike {
    return this.prisma as PrismaLike;
  }

  async list(filters: ListAuditLogFilters): Promise<AuditLogRecord[]> {
    if (this.prisma) {
      const where: Record<string, unknown> = {};
      if (filters.eventType) where.eventType = filters.eventType;
      if (filters.since) where.timestamp = { gte: filters.since };
      const rows = await this.db.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: filters.limit,
      });
      return rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        timestamp: row.timestamp,
        requestId: row.requestId,
        payload: parsePayload(row.payloadJson),
      }));
    }

    if (this.sqlite) {
      const conditions: string[] = [];
      if (filters.eventType) conditions.push(`event_type = ${sqliteLiteral(filters.eventType)}`);
      if (filters.since) conditions.push(`timestamp >= ${sqliteLiteral(filters.since.toISOString())}`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = this.sqlite.query<SqliteAuditLogRow>(`
        SELECT * FROM audit_log
        ${where}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${filters.limit}
      `);
      return rows.map((row) => fromSqliteRow(row));
    }

    return [];
  }
}
