import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import type { StorageDriverKind } from '../storage/driver-registry.js';
import { createVcStorageDriver, type VcStorageDriver } from './drivers/vc.drivers.js';

export interface VCRecord {
  vcId: string;
  subjectDid: string;
  subjectType: string;
  vcJson: unknown;
  privilegeScopes: unknown;
  statusListIndex: number;
  expiresAt: Date;
  revokedAt: Date | null;
  renewedByVcId: string | null;
  delegatedFrom?: string | null;
  delegationDepth?: number | null;
  maxDelegationDepth?: number | null;
  parentVcId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ListVcFilters {
  subjectDid?: string | undefined;
  status?: 'active' | 'revoked' | 'expired' | undefined;
  limit: number;
}

export interface StatusListEntryRecord {
  listId: string;
  encodedList: string;
  nextIndex: number;
  updatedAt?: Date;
}

export interface CreateVcParams {
  vcId: string;
  subjectDid: string;
  subjectType: string;
  vcJson: unknown;
  privilegeScopes?: string[] | undefined;
  statusListIndex: number;
  expiresAt: Date;
  delegatedFrom?: string | undefined;
  delegationDepth?: number | undefined;
  maxDelegationDepth?: number | undefined;
  parentVcId?: string | undefined;
}

interface LegacyCreateVCParams {
  vcId: string;
  subjectDid: string;
  subjectType?: string;
  vcJson: unknown;
  privilegeScopes?: string[] | undefined;
  statusListIndex?: number;
  expiresAt: Date;
}

/**
 * VcRepository is a thin delegator over a VcStorageDriver — see
 * storage/driver-registry.ts for the pattern and
 * repositories/drivers/did.drivers.ts for the original reference
 * implementation. No per-backend branching lives in this class; it all
 * lives in createVcStorageDriver() and the driver classes in
 * repositories/drivers/vc.drivers.ts.
 *
 * The (prisma?, sqlite?) constructor signature is unchanged on purpose —
 * see did.repository.ts's class doc comment for the full rationale (test
 * suite call-site compatibility).
 */
export class VcRepository {
  private readonly driver: VcStorageDriver;

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {
    this.driver = createVcStorageDriver(this.resolveDriverKind(), { prisma, sqlite });
  }

  private resolveDriverKind(): StorageDriverKind {
    if (this.prisma) return 'postgres';
    if (this.sqlite) return 'sqlite';
    return 'memory';
  }

  async createVc(params: CreateVcParams): Promise<VCRecord> {
    return this.driver.createVc(params);
  }

  async findByVcId(vcId: string): Promise<VCRecord | null> {
    return this.driver.findByVcId(vcId);
  }

  async listVcs(filters: ListVcFilters): Promise<VCRecord[]> {
    return this.driver.listVcs(filters);
  }

  async findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<VCRecord[]> {
    return this.driver.findActiveBySubjectDid(subjectDid, vcType);
  }

  async findMany(
    filters: { subjectDid?: string | undefined } = {},
  ): Promise<VCRecord[]> {
    return this.driver.findMany(filters);
  }

  async findStatusListById(listId: string): Promise<StatusListEntryRecord | null> {
    return this.driver.findStatusListById(listId);
  }

  async createStatusList(listId: string, encodedList: string): Promise<StatusListEntryRecord> {
    return this.driver.createStatusList(listId, encodedList);
  }

  async claimNextIndex(
    listId: string,
  ): Promise<{ list: StatusListEntryRecord; claimedIndex: number }> {
    return this.driver.claimNextIndex(listId);
  }

  async revokeVc(vcId: string, listId: string, newEncodedList: string): Promise<VCRecord> {
    return this.driver.revokeVc(vcId, listId, newEncodedList);
  }

  async markAsRenewed(oldVcId: string, newVcId: string): Promise<VCRecord> {
    return this.driver.markAsRenewed(oldVcId, newVcId);
  }

  // Back-compat aliases for older B3/B4 scaffolding.
  async createVC(data: LegacyCreateVCParams): Promise<VCRecord> {
    return this.createVc({
      vcId: data.vcId,
      subjectDid: data.subjectDid,
      subjectType: data.subjectType ?? 'agent',
      vcJson: typeof data.vcJson === 'string' ? JSON.parse(data.vcJson) : data.vcJson,
      privilegeScopes: data.privilegeScopes,
      statusListIndex: data.statusListIndex ?? 0,
      expiresAt: data.expiresAt,
    });
  }
}

export { VcRepository as VCRepository };
