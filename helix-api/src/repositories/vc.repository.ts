import type { PrismaClient } from '@prisma/client';
import { prisma as sharedPrisma } from '../prisma.js';

type PrismaRaw = PrismaClient & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

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

type PrismaLike = PrismaClient & {
  vc: {
    create(args: unknown): Promise<VCRecord>;
    findUnique(args: unknown): Promise<VCRecord | null>;
    findFirst(args: unknown): Promise<VCRecord | null>;
    findMany(args: unknown): Promise<VCRecord[]>;
    update(args: unknown): Promise<VCRecord>;
  };
  statusListEntry: {
    create(args: unknown): Promise<StatusListEntryRecord>;
    findUnique(args: unknown): Promise<StatusListEntryRecord | null>;
    update(args: unknown): Promise<StatusListEntryRecord>;
  };
};

interface LegacyCreateVCParams {
  vcId: string;
  subjectDid: string;
  subjectType?: string;
  vcJson: unknown;
  privilegeScopes?: string[] | undefined;
  statusListIndex?: number;
  expiresAt: Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function makeId(prefix: string): string {
  return `${prefix}:${Math.random().toString(16).slice(2, 14)}`;
}

function requireVcRow(row: VCRecord | undefined): VCRecord {
  if (!row) {
    throw new Error('VC query returned no rows');
  }
  return row;
}

function hasRealRaw(prisma: PrismaClient): prisma is PrismaRaw {
  return typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function'
    && typeof (prisma as { $connect?: unknown }).$connect === 'function';
}

export class VcRepository {
  constructor(private readonly prisma: PrismaClient = sharedPrisma) {}

  private get db(): PrismaLike {
    return this.prisma as PrismaLike;
  }

  async createVc(params: CreateVcParams): Promise<VCRecord> {
    if (!hasRealRaw(this.prisma)) {
      return this.db.vc.create({
        data: {
          vcId: params.vcId,
          subjectDid: params.subjectDid,
          subjectType: params.subjectType,
          vcJson: params.vcJson,
          privilegeScopes: params.privilegeScopes ?? null,
          statusListIndex: params.statusListIndex,
          expiresAt: params.expiresAt,
        },
      });
    }
    const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<VCRecord[]>(
      `INSERT INTO "vcs" (
        "id",
        "vcId",
        "subjectDid",
        "subjectType",
        "vcJson",
        "privilegeScopes",
        "statusListIndex",
        "expiresAt",
        "delegatedFrom",
        "delegationDepth",
        "maxDelegationDepth",
        "parentVcId"
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      makeId('vcdb'),
      params.vcId,
      params.subjectDid,
      params.subjectType,
      JSON.stringify(params.vcJson),
      params.privilegeScopes ? JSON.stringify(params.privilegeScopes) : null,
      params.statusListIndex,
      params.expiresAt,
      params.delegatedFrom ?? null,
      params.delegationDepth ?? null,
      params.maxDelegationDepth ?? null,
      params.parentVcId ?? null,
    );
    return requireVcRow(rows[0]);
  }

  async findByVcId(vcId: string): Promise<VCRecord | null> {
    if (!hasRealRaw(this.prisma)) {
      return this.db.vc.findUnique({ where: { vcId } });
    }
    const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<VCRecord[]>(
      `SELECT * FROM "vcs" WHERE "vcId" = $1 LIMIT 1`,
      vcId,
    );
    return rows[0] ?? null;
  }

  async findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<VCRecord[]> {
    if (!hasRealRaw(this.prisma)) {
      const records = await this.db.vc.findMany({
        where: {
          subjectDid,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!vcType) return records;
      return records.filter((record) => {
        const vc = typeof record.vcJson === 'string' ? JSON.parse(record.vcJson) : record.vcJson;
        const vcRecord = asRecord(vc);
        return Array.isArray(vcRecord['type']) && vcRecord['type'].includes(vcType);
      });
    }
    const records = await (this.prisma as PrismaRaw).$queryRawUnsafe<VCRecord[]>(
      `SELECT * FROM "vcs"
       WHERE "subjectDid" = $1 AND "revokedAt" IS NULL AND "expiresAt" > $2
       ORDER BY "createdAt" ASC`,
      subjectDid,
      new Date(),
    );
    if (!vcType) return records;
    return records.filter((record) => {
      const vc = typeof record.vcJson === 'string' ? JSON.parse(record.vcJson) : record.vcJson;
      const vcRecord = asRecord(vc);
      return Array.isArray(vcRecord['type']) && vcRecord['type'].includes(vcType);
    });
  }

  async findStatusListById(listId: string): Promise<StatusListEntryRecord | null> {
    return this.db.statusListEntry.findUnique({ where: { listId } });
  }

  async createStatusList(listId: string, encodedList: string): Promise<StatusListEntryRecord> {
    return this.db.statusListEntry.create({
      data: { listId, encodedList, nextIndex: 0 },
    });
  }

  async claimNextIndex(listId: string): Promise<{ list: StatusListEntryRecord; claimedIndex: number }> {
    const list = await this.db.statusListEntry.update({
      where: { listId },
      data: { nextIndex: { increment: 1 } },
    });
    return { list, claimedIndex: list.nextIndex - 1 };
  }

  async revokeVc(vcId: string, listId: string, newEncodedList: string): Promise<VCRecord> {
    return this.prisma.$transaction(async (tx) => {
      const db = tx as unknown as PrismaLike;
      await db.statusListEntry.update({
        where: { listId },
        data: { encodedList: newEncodedList },
      });
      return db.vc.update({
        where: { vcId },
        data: { revokedAt: new Date() },
      });
    });
  }

  async markAsRenewed(oldVcId: string, newVcId: string): Promise<VCRecord> {
    return this.db.vc.update({
      where: { vcId: oldVcId },
      data: { renewedByVcId: newVcId },
    });
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
