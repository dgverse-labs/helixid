import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import type { StorageDriverKind } from '../storage/driver-registry.js';
import { createVpStorageDriver, type VpStorageDriver } from './drivers/vp.drivers.js';

export interface VpIdRecord {
  vpId: string;
  agentDid: string;
  userDid: string;
  targetService: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

/**
 * VPRepository is a thin delegator over a VpStorageDriver — see
 * storage/driver-registry.ts for the pattern and
 * repositories/drivers/did.drivers.ts for the reference implementation.
 *
 * The constructor's first parameter is named `db`, not `prisma` (unlike
 * every other repository in this directory) — that's how it was before
 * this refactor too; not something this change tried to normalize, since
 * doing so silently would be an unrelated, unrequested rename. The
 * (db?, sqlite?) signature itself is otherwise unchanged for the same
 * test-compatibility reason described in did.repository.ts's class doc
 * comment.
 */
export class VPRepository {
  private readonly driver: VpStorageDriver;

  constructor(
    private readonly db?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {
    this.driver = createVpStorageDriver(this.resolveDriverKind(), { prisma: db, sqlite });
  }

  private resolveDriverKind(): StorageDriverKind {
    if (this.db) return 'postgres';
    if (this.sqlite) return 'sqlite';
    return 'memory';
  }

  async create(data: Omit<VpIdRecord, 'consumedAt'>): Promise<VpIdRecord> {
    return this.driver.create(data);
  }

  async findByVpId(vpId: string): Promise<VpIdRecord | null> {
    return this.driver.findByVpId(vpId);
  }

  async consumeAtomically(vpId: string): Promise<boolean> {
    return this.driver.consumeAtomically(vpId);
  }
}
