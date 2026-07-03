import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

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

type SqliteVcRow = {
  vc_id: string;
  subject_did: string;
  subject_type: string;
  vc_json: string;
  privilege_scopes: string | null;
  status_list_index: number;
  expires_at: string;
  revoked_at: string | null;
  renewed_by_vc_id: string | null;
  delegated_from: string | null;
  delegation_depth: number | null;
  max_delegation_depth: number | null;
  parent_vc_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type SqliteStatusListRow = {
  list_id: string;
  encoded_list: string;
  next_index: number;
  updated_at: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
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
  return (
    typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function' &&
    typeof (prisma as { $connect?: unknown }).$connect === 'function'
  );
}

function fromSqliteVcRow(row: SqliteVcRow | undefined): VCRecord | null {
  if (!row) return null;
  const base: VCRecord = {
    vcId: row.vc_id,
    subjectDid: row.subject_did,
    subjectType: row.subject_type,
    vcJson: JSON.parse(row.vc_json),
    privilegeScopes: row.privilege_scopes ? JSON.parse(row.privilege_scopes) : null,
    statusListIndex: row.status_list_index,
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    renewedByVcId: row.renewed_by_vc_id,
    delegatedFrom: row.delegated_from,
    delegationDepth: row.delegation_depth,
    maxDelegationDepth: row.max_delegation_depth,
    parentVcId: row.parent_vc_id,
  };
  if (row.created_at) base.createdAt = new Date(row.created_at);
  if (row.updated_at) base.updatedAt = new Date(row.updated_at);
  return base;
}

function fromSqliteStatusListRow(
  row: SqliteStatusListRow | undefined,
): StatusListEntryRecord | null {
  if (!row) return null;
  const base: StatusListEntryRecord = {
    listId: row.list_id,
    encodedList: row.encoded_list,
    nextIndex: row.next_index,
  };
  if (row.updated_at) base.updatedAt = new Date(row.updated_at);
  return base;
}

export class VcRepository {
  private readonly vcs = new Map<string, VCRecord>();
  private readonly statusLists = new Map<string, StatusListEntryRecord>();

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  private get db(): PrismaLike {
    return this.prisma as PrismaLike;
  }

  async createVc(params: CreateVcParams): Promise<VCRecord> {
    if (this.prisma) {
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

    if (this.sqlite) {
      const now = new Date();
      this.sqlite.execute(`
        INSERT INTO vcs (
          vc_id, subject_did, subject_type, vc_json, privilege_scopes,
          status_list_index, expires_at, revoked_at, renewed_by_vc_id,
          delegated_from, delegation_depth, max_delegation_depth, parent_vc_id,
          created_at, updated_at
        ) VALUES (
          ${sqliteLiteral(params.vcId)},
          ${sqliteLiteral(params.subjectDid)},
          ${sqliteLiteral(params.subjectType)},
          ${sqliteLiteral(JSON.stringify(params.vcJson))},
          ${sqliteLiteral(params.privilegeScopes ? JSON.stringify(params.privilegeScopes) : null)},
          ${sqliteLiteral(params.statusListIndex)},
          ${sqliteLiteral(params.expiresAt)},
          NULL,
          NULL,
          ${sqliteLiteral(params.delegatedFrom ?? null)},
          ${sqliteLiteral(params.delegationDepth ?? null)},
          ${sqliteLiteral(params.maxDelegationDepth ?? null)},
          ${sqliteLiteral(params.parentVcId ?? null)},
          ${sqliteLiteral(now)},
          ${sqliteLiteral(now)}
        )
      `);
      const created = await this.findByVcId(params.vcId);
      if (!created) throw new Error('VC create failed');
      return created;
    }

    const now = new Date();
    const record: VCRecord = {
      vcId: params.vcId,
      subjectDid: params.subjectDid,
      subjectType: params.subjectType,
      vcJson: params.vcJson,
      privilegeScopes: params.privilegeScopes ?? null,
      statusListIndex: params.statusListIndex,
      expiresAt: params.expiresAt,
      revokedAt: null,
      renewedByVcId: null,
      delegatedFrom: params.delegatedFrom ?? null,
      delegationDepth: params.delegationDepth ?? null,
      maxDelegationDepth: params.maxDelegationDepth ?? null,
      parentVcId: params.parentVcId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.vcs.set(record.vcId, record);
    return record;
  }

  async findByVcId(vcId: string): Promise<VCRecord | null> {
    if (this.prisma) {
      if (!hasRealRaw(this.prisma)) {
        return this.db.vc.findUnique({ where: { vcId } });
      }
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<VCRecord[]>(
        `SELECT * FROM "vcs" WHERE "vcId" = $1 LIMIT 1`,
        vcId,
      );
      return rows[0] ?? null;
    }

    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteVcRow>(`
        SELECT * FROM vcs WHERE vc_id = ${sqliteLiteral(vcId)} LIMIT 1
      `);
      return fromSqliteVcRow(rows[0]);
    }

    return this.vcs.get(vcId) ?? null;
  }

  async findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<VCRecord[]> {
    if (this.prisma) {
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

    if (this.sqlite) {
      const nowIso = new Date().toISOString();
      const rows = this.sqlite.query<SqliteVcRow>(`
        SELECT * FROM vcs
        WHERE subject_did = ${sqliteLiteral(subjectDid)}
          AND revoked_at IS NULL
          AND expires_at > ${sqliteLiteral(nowIso)}
        ORDER BY created_at ASC
      `);
      const records = rows
        .map((row) => fromSqliteVcRow(row))
        .filter((v): v is VCRecord => Boolean(v));
      if (!vcType) return records;
      return records.filter((record) => {
        const vc = typeof record.vcJson === 'string' ? JSON.parse(record.vcJson) : record.vcJson;
        const vcRecord = asRecord(vc);
        return Array.isArray(vcRecord['type']) && vcRecord['type'].includes(vcType);
      });
    }

    const now = Date.now();
    const records = [...this.vcs.values()]
      .filter((r) => r.subjectDid === subjectDid && !r.revokedAt && r.expiresAt.getTime() > now)
      .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    if (!vcType) return records;
    return records.filter((record) => {
      const vc = typeof record.vcJson === 'string' ? JSON.parse(record.vcJson) : record.vcJson;
      const vcRecord = asRecord(vc);
      return Array.isArray(vcRecord['type']) && vcRecord['type'].includes(vcType);
    });
  }

  async findMany(filters: { subjectDid?: string | undefined } = {}): Promise<VCRecord[]> {
    if (this.prisma) {
      if (!hasRealRaw(this.prisma)) {
        return this.db.vc.findMany({
          where: filters.subjectDid ? { subjectDid: filters.subjectDid } : {},
          orderBy: { createdAt: 'desc' },
        });
      }

      if (filters.subjectDid) {
        return (this.prisma as PrismaRaw).$queryRawUnsafe<VCRecord[]>(
          `SELECT * FROM "vcs" WHERE "subjectDid" = $1 ORDER BY "createdAt" DESC`,
          filters.subjectDid,
        );
      }
      return (this.prisma as PrismaRaw).$queryRawUnsafe<VCRecord[]>(
        `SELECT * FROM "vcs" ORDER BY "createdAt" DESC`,
      );
    }

    if (this.sqlite) {
      const where = filters.subjectDid
        ? `WHERE subject_did = ${sqliteLiteral(filters.subjectDid)}`
        : '';
      const rows = this.sqlite.query<SqliteVcRow>(`
        SELECT * FROM vcs ${where} ORDER BY created_at DESC
      `);
      return rows.map((row) => fromSqliteVcRow(row)).filter((v): v is VCRecord => Boolean(v));
    }

    return [...this.vcs.values()]
      .filter((r) => !filters.subjectDid || r.subjectDid === filters.subjectDid)
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }

  async findStatusListById(listId: string): Promise<StatusListEntryRecord | null> {
    if (this.prisma) {
      return this.db.statusListEntry.findUnique({ where: { listId } });
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteStatusListRow>(`
        SELECT * FROM status_list_entries WHERE list_id = ${sqliteLiteral(listId)} LIMIT 1
      `);
      return fromSqliteStatusListRow(rows[0]);
    }
    return this.statusLists.get(listId) ?? null;
  }

  async createStatusList(listId: string, encodedList: string): Promise<StatusListEntryRecord> {
    if (this.prisma) {
      return this.db.statusListEntry.create({
        data: { listId, encodedList, nextIndex: 0 },
      });
    }
    if (this.sqlite) {
      const now = new Date();
      this.sqlite.execute(`
        INSERT INTO status_list_entries (list_id, encoded_list, next_index, updated_at)
        VALUES (
          ${sqliteLiteral(listId)},
          ${sqliteLiteral(encodedList)},
          0,
          ${sqliteLiteral(now)}
        )
      `);
      return { listId, encodedList, nextIndex: 0, updatedAt: now };
    }

    const record: StatusListEntryRecord = {
      listId,
      encodedList,
      nextIndex: 0,
      updatedAt: new Date(),
    };
    this.statusLists.set(listId, record);
    return record;
  }

  async claimNextIndex(
    listId: string,
  ): Promise<{ list: StatusListEntryRecord; claimedIndex: number }> {
    if (this.prisma) {
      const list = await this.db.statusListEntry.update({
        where: { listId },
        data: { nextIndex: { increment: 1 } },
      });
      return { list, claimedIndex: list.nextIndex - 1 };
    }

    if (this.sqlite) {
      this.sqlite.execute(`
        UPDATE status_list_entries
        SET next_index = next_index + 1,
            updated_at = ${sqliteLiteral(new Date())}
        WHERE list_id = ${sqliteLiteral(listId)}
      `);
      const rows = this.sqlite.query<SqliteStatusListRow>(`
        SELECT * FROM status_list_entries WHERE list_id = ${sqliteLiteral(listId)} LIMIT 1
      `);
      const list = fromSqliteStatusListRow(rows[0]);
      if (!list) throw new Error(`Status list not found: ${listId}`);
      return { list, claimedIndex: list.nextIndex - 1 };
    }

    const existing = this.statusLists.get(listId);
    if (!existing) {
      throw new Error(`Status list not found: ${listId}`);
    }
    const claimedIndex = existing.nextIndex;
    const updated: StatusListEntryRecord = {
      ...existing,
      nextIndex: existing.nextIndex + 1,
      updatedAt: new Date(),
    };
    this.statusLists.set(listId, updated);
    return { list: updated, claimedIndex };
  }

  async revokeVc(vcId: string, listId: string, newEncodedList: string): Promise<VCRecord> {
    if (this.prisma) {
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

    if (this.sqlite) {
      const now = new Date();
      this.sqlite.execute(`
        UPDATE status_list_entries
        SET encoded_list = ${sqliteLiteral(newEncodedList)},
            updated_at = ${sqliteLiteral(now)}
        WHERE list_id = ${sqliteLiteral(listId)}
      `);
      this.sqlite.execute(`
        UPDATE vcs
        SET revoked_at = ${sqliteLiteral(now)},
            updated_at = ${sqliteLiteral(now)}
        WHERE vc_id = ${sqliteLiteral(vcId)}
      `);
      const updated = await this.findByVcId(vcId);
      if (!updated) throw new Error(`VC not found: ${vcId}`);
      return updated;
    }

    const list = this.statusLists.get(listId);
    if (!list) throw new Error(`Status list not found: ${listId}`);
    this.statusLists.set(listId, {
      ...list,
      encodedList: newEncodedList,
      updatedAt: new Date(),
    });

    const vc = this.vcs.get(vcId);
    if (!vc) throw new Error(`VC not found: ${vcId}`);
    const updatedVc: VCRecord = { ...vc, revokedAt: new Date(), updatedAt: new Date() };
    this.vcs.set(vcId, updatedVc);
    return updatedVc;
  }

  async markAsRenewed(oldVcId: string, newVcId: string): Promise<VCRecord> {
    if (this.prisma) {
      return this.db.vc.update({
        where: { vcId: oldVcId },
        data: { renewedByVcId: newVcId },
      });
    }

    if (this.sqlite) {
      this.sqlite.execute(`
        UPDATE vcs
        SET renewed_by_vc_id = ${sqliteLiteral(newVcId)},
            updated_at = ${sqliteLiteral(new Date())}
        WHERE vc_id = ${sqliteLiteral(oldVcId)}
      `);
      const updated = await this.findByVcId(oldVcId);
      if (!updated) throw new Error(`VC not found: ${oldVcId}`);
      return updated;
    }

    const vc = this.vcs.get(oldVcId);
    if (!vc) throw new Error(`VC not found: ${oldVcId}`);
    const updated: VCRecord = {
      ...vc,
      renewedByVcId: newVcId,
      updatedAt: new Date(),
    };
    this.vcs.set(oldVcId, updated);
    return updated;
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
