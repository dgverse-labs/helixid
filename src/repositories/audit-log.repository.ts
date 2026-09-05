import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import type { StorageDriverKind } from '../storage/driver-registry.js';
import {
  createAuditLogStorageDriver,
  type AuditLogStorageDriver,
} from './drivers/audit-log.drivers.js';

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

/**
 * AuditLogRepository is a thin delegator over an AuditLogStorageDriver —
 * see storage/driver-registry.ts for the pattern and
 * repositories/drivers/did.drivers.ts for the reference implementation.
 * The (prisma?, sqlite?) constructor signature is unchanged on purpose —
 * see did.repository.ts's class doc comment for the full rationale.
 */
export class AuditLogRepository {
  private readonly driver: AuditLogStorageDriver;

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {
    this.driver = createAuditLogStorageDriver(this.resolveDriverKind(), { prisma, sqlite });
  }

  private resolveDriverKind(): StorageDriverKind {
    if (this.prisma) return 'postgres';
    if (this.sqlite) return 'sqlite';
    return 'memory';
  }

  async list(filters: ListAuditLogFilters): Promise<AuditLogRecord[]> {
    return this.driver.list(filters);
  }
}
