import type { PrismaClient } from '@prisma/client';
import { prisma as sharedPrisma } from '../prisma.js';

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

export class VcRepository {
  constructor(private readonly prisma: PrismaClient = sharedPrisma) {}

  private get db(): PrismaLike {
    return this.prisma as PrismaLike;
  }

  async createVc(params: CreateVcParams): Promise<VCRecord> {
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

  async findByVcId(vcId: string): Promise<VCRecord | null> {
    return this.db.vc.findUnique({ where: { vcId } });
  }

  async findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<VCRecord[]> {
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
