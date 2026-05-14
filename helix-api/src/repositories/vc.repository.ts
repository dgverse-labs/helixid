import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createStatusList } from '@helix-id/core';
import { prisma } from './did.repository.js';

export interface Vc {
  id: string;
  vcId: string;
  subjectDid: string;
  subjectType: string;
  vcJson: string;
  privilegeScopes: string;
  statusListIndex: number;
  expiresAt: Date;
  revokedAt: Date | null;
  renewedByVcId: string | null;
  createdAt: Date;
}

export interface StatusListEntry {
  id: string;
  listId: string;
  encodedList: string;
  nextIndex: number;
  updatedAt: Date;
}

export interface CreateVCData {
  vcId: string;
  subjectDid: string;
  subjectType: string;
  vcJson: string;
  privilegeScopes: string;
  statusListIndex: number;
  expiresAt: Date;
}

export class VCRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  private get client() {
    return this.db as PrismaClient & {
      vc: {
        create(args: unknown): Promise<Vc>;
        findUnique(args: unknown): Promise<Vc | null>;
        findFirst(args: unknown): Promise<Vc | null>;
        update(args: unknown): Promise<Vc>;
      };
      statusListEntry: {
        create(args: unknown): Promise<StatusListEntry>;
        findUnique(args: unknown): Promise<StatusListEntry | null>;
        update(args: unknown): Promise<StatusListEntry>;
        upsert(args: unknown): Promise<StatusListEntry>;
      };
    };
  }

  async create(data: CreateVCData): Promise<Vc> {
    console.log('Available Prisma properties:', Object.keys(this.db));
    return this.client.vc.create({ data });
  }

  async findByVcId(vcId: string): Promise<Vc | null> {
    return this.client.vc.findUnique({ where: { vcId } });
  }

  async findActiveBySubjectDid(subjectDid: string): Promise<Vc | null> {
    return this.client.vc.findFirst({
      where: {
        subjectDid,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRevoked(vcId: string): Promise<Vc> {
    return this.client.vc.update({
      where: { vcId },
      data: { revokedAt: new Date() },
    });
  }

  async markRenewed(oldVcId: string, newVcId: string): Promise<Vc> {
    return this.client.vc.update({
      where: { vcId: oldVcId },
      data: { renewedByVcId: newVcId },
    });
  }

  async getStatusListEntry(listId: string): Promise<StatusListEntry | null> {
    return this.client.statusListEntry.findUnique({ where: { listId } });
  }

  async upsertStatusListEntry(
    listId: string,
    encodedList: string,
    nextIndex: number,
  ): Promise<StatusListEntry> {
    return this.client.statusListEntry.upsert({
      where: { listId },
      create: { listId, encodedList, nextIndex },
      update: { encodedList, nextIndex },
    });
  }

  async claimStatusListIndex(listId: string): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO "status_list_entries" ("id", "listId", "encodedList", "nextIndex", "updatedAt")
        VALUES (${id}, ${listId}, ${createStatusList()}, 0, NOW())
        ON CONFLICT ("listId") DO NOTHING
      `;
      const rows = await tx.$queryRaw<Array<{ nextIndex: number }>>`
        SELECT "nextIndex"
        FROM "status_list_entries"
        WHERE "listId" = ${listId}
        FOR UPDATE
      `;
      const claimedIndex = rows[0]?.nextIndex ?? 0;
      await tx.$executeRaw`
        UPDATE "status_list_entries"
        SET "nextIndex" = ${claimedIndex + 1}, "updatedAt" = NOW()
        WHERE "listId" = ${listId}
      `;
      return claimedIndex;
    });
  }

  async revokeWithStatusList(vcId: string, listId: string, encodedList: string): Promise<Vc> {
    return this.db.$transaction(async (tx) => {
      const client = tx as typeof this.client;
      await client.statusListEntry.update({
        where: { listId },
        data: { encodedList },
      });
      return client.vc.update({
        where: { vcId },
        data: { revokedAt: new Date() },
      });
    });
  }
}
