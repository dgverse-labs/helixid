// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Storage-driver implementations for AuditLogRepository — see
// storage/driver-registry.ts for the pattern and
// repositories/drivers/did.drivers.ts for the reference implementation.

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../../storage/sqlite.js';
import { sqliteLiteral } from '../../storage/sqlite.js';
import {
  UnsupportedStorageDriverError,
  type StorageDriverDeps,
  type StorageDriverKind,
} from '../../storage/driver-registry.js';
import type { AuditLogRecord, ListAuditLogFilters } from '../audit-log.repository.js';

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

export interface AuditLogStorageDriver {
  list(filters: ListAuditLogFilters): Promise<AuditLogRecord[]>;
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadJson);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class PrismaAuditLogStorageDriver implements AuditLogStorageDriver {
  private readonly db: PrismaLike;

  constructor(prisma: PrismaClient) {
    this.db = prisma as PrismaLike;
  }

  async list(filters: ListAuditLogFilters): Promise<AuditLogRecord[]> {
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
}

type SqliteAuditLogRow = {
  id: number;
  event_type: string;
  timestamp: string;
  request_id: string | null;
  payload_json: string;
};

function fromSqliteRow(row: SqliteAuditLogRow): AuditLogRecord {
  return {
    id: String(row.id),
    eventType: row.event_type,
    timestamp: new Date(row.timestamp),
    requestId: row.request_id,
    payload: parsePayload(row.payload_json),
  };
}

export class SqliteAuditLogStorageDriver implements AuditLogStorageDriver {
  constructor(private readonly sqlite: SqliteStore) {}

  async list(filters: ListAuditLogFilters): Promise<AuditLogRecord[]> {
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
}

/**
 * In-memory mode never retained audit log entries even before this
 * refactor (list() just returned [] unconditionally) — ApiAuditLogger
 * writes audit events through its own separate path (audit/index.ts, not
 * this repository), so an in-memory read-back here was never wired up.
 * Preserved exactly as-is, not a new limitation introduced by this change.
 */
export class InMemoryAuditLogStorageDriver implements AuditLogStorageDriver {
  async list(_filters: ListAuditLogFilters): Promise<AuditLogRecord[]> {
    return [];
  }
}

export function createAuditLogStorageDriver(
  kind: StorageDriverKind,
  deps: StorageDriverDeps,
): AuditLogStorageDriver {
  switch (kind) {
    case 'postgres':
      if (!deps.prisma) throw new Error("createAuditLogStorageDriver('postgres') requires deps.prisma");
      return new PrismaAuditLogStorageDriver(deps.prisma as PrismaClient);
    case 'sqlite':
      if (!deps.sqlite) throw new Error("createAuditLogStorageDriver('sqlite') requires deps.sqlite");
      return new SqliteAuditLogStorageDriver(deps.sqlite as SqliteStore);
    case 'memory':
      return new InMemoryAuditLogStorageDriver();
    default: {
      const _exhaustive: never = kind;
      throw new UnsupportedStorageDriverError('AuditLogRepository', _exhaustive);
    }
  }
}
