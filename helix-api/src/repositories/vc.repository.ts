import type { PrismaClient } from '@prisma/client';
import { prisma as sharedPrisma } from '../prisma.js';

export interface CreateVcParams {
  vcId: string;
  subjectDid: string;
  subjectType: string;
  vcJson: any;
  privilegeScopes?: string[] | undefined;
  statusListIndex: number;
  expiresAt: Date;
}

type PrismaLike = PrismaClient & {
  vc: {
    create(args: any): Promise<any>;
    findUnique(args: any): Promise<any | null>;
    findFirst(args: any): Promise<any | null>;
    findMany(args: any): Promise<any[]>;
    update(args: any): Promise<any>;
  };
  statusListEntry: {
    create(args: any): Promise<any>;
    findUnique(args: any): Promise<any | null>;
    update(args: any): Promise<any>;
  };
};

export class VcRepository {
  constructor(private readonly prisma: PrismaClient = sharedPrisma) {}

  private get db(): PrismaLike {
    return this.prisma as PrismaLike;
  }

  async createVc(params: CreateVcParams) {
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

  async findByVcId(vcId: string) {
    return this.db.vc.findUnique({ where: { vcId } });
  }

  async findActiveBySubjectDid(subjectDid: string, vcType?: string) {
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
      return Array.isArray(vc.type) && vc.type.includes(vcType);
    });
  }

  async findStatusListById(listId: string) {
    return this.db.statusListEntry.findUnique({ where: { listId } });
  }

  async createStatusList(listId: string, encodedList: string) {
    return this.db.statusListEntry.create({
      data: { listId, encodedList, nextIndex: 0 },
    });
  }

  async claimNextIndex(listId: string): Promise<{ list: any; claimedIndex: number }> {
    const list = await this.db.statusListEntry.update({
      where: { listId },
      data: { nextIndex: { increment: 1 } },
    });
    return { list, claimedIndex: list.nextIndex - 1 };
  }

  async revokeVc(vcId: string, listId: string, newEncodedList: string) {
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

  async markAsRenewed(oldVcId: string, newVcId: string) {
    return this.db.vc.update({
      where: { vcId: oldVcId },
      data: { renewedByVcId: newVcId },
    });
  }

  // Back-compat aliases for older B3/B4 scaffolding.
  async createVC(data: any) {
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
