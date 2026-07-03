// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

export interface AuditLogRecord {
  id: string;
  timestamp: string;
  eventType: string;
  requestId: string | null;
  payloadJson: string;
}

export interface AuditLogQuery {
  eventType?: string | undefined;
  since?: Date | undefined;
  limit: number;
}

type PrismaAuditRow = {
  id: string;
  timestamp: Date;
  eventType: string;
  requestId: string;
  payloadJson: string;
};

type PrismaLike = PrismaClient & {
  auditLog: {
    findMany(args: unknown): Promise<PrismaAuditRow[]>;
  };
};

type SqliteAuditRow = {
  id: number;
  timestamp: string;
  event_type: string;
  request_id: string | null;
  payload_json: string;
};

/**
 * Read side of the audit log. Writes happen in ApiAuditLogger; this
 * repository only exists so GET /v1/audit-log can query what was stored.
 * When neither Postgres nor SQLite is enabled there is nothing to read
 * (stdout/file destinations are not queryable), so findMany returns [].
 */
export class AuditLogRepository {
  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  async findMany(query: AuditLogQuery): Promise<AuditLogRecord[]> {
    if (this.prisma) {
      const rows = await (this.prisma as PrismaLike).auditLog.findMany({
        where: {
          ...(query.eventType ? { eventType: query.eventType } : {}),
          ...(query.since ? { timestamp: { gte: query.since } } : {}),
        },
        orderBy: { timestamp: 'desc' },
        take: query.limit,
      });
      return rows.map((row) => ({
        id: String(row.id),
        timestamp: new Date(row.timestamp).toISOString(),
        eventType: row.eventType,
        requestId: row.requestId ?? null,
        payloadJson: row.payloadJson,
      }));
    }

    if (this.sqlite) {
      const conditions: string[] = [];
      if (query.eventType) {
        conditions.push(`event_type = ${sqliteLiteral(query.eventType)}`);
      }
      if (query.since) {
        // timestamp is stored as an ISO-8601 string, so lexicographic
        // comparison matches chronological order.
        conditions.push(`timestamp >= ${sqliteLiteral(query.since.toISOString())}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = this.sqlite.query<SqliteAuditRow>(`
        SELECT * FROM audit_log ${where}
        ORDER BY timestamp DESC, id DESC
        LIMIT ${sqliteLiteral(query.limit)}
      `);
      return rows.map((row) => ({
        id: String(row.id),
        timestamp: row.timestamp,
        eventType: row.event_type,
        requestId: row.request_id,
        payloadJson: row.payload_json,
      }));
    }

    return [];
  }
}
