import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

export interface VpIdRecord {
  vpId: string;
  agentDid: string;
  userDid: string;
  targetService: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

type UpdateManyResult = {
  count: number;
};

type SqliteVpRow = {
  vp_id: string;
  agent_did: string;
  user_did: string;
  target_service: string;
  expires_at: string;
  consumed_at: string | null;
};

function fromSqliteRow(row: SqliteVpRow | undefined): VpIdRecord | null {
  if (!row) return null;
  return {
    vpId: row.vp_id,
    agentDid: row.agent_did,
    userDid: row.user_did,
    targetService: row.target_service,
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
  };
}

export class VPRepository {
  private readonly records = new Map<string, VpIdRecord>();

  constructor(
    private readonly db?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  async create(data: Omit<VpIdRecord, 'consumedAt'>): Promise<VpIdRecord> {
    if (this.db) {
      return this.db.vpId.create({
        data: {
          vpId: data.vpId,
          agentDid: data.agentDid,
          userDid: data.userDid,
          targetService: data.targetService,
          expiresAt: data.expiresAt,
        },
      });
    }

    if (this.sqlite) {
      this.sqlite.execute(`
        INSERT INTO vp_ids (vp_id, agent_did, user_did, target_service, expires_at, consumed_at)
        VALUES (
          ${sqliteLiteral(data.vpId)},
          ${sqliteLiteral(data.agentDid)},
          ${sqliteLiteral(data.userDid)},
          ${sqliteLiteral(data.targetService)},
          ${sqliteLiteral(data.expiresAt)},
          NULL
        )
      `);
      return {
        ...data,
        consumedAt: null,
      };
    }

    const record: VpIdRecord = {
      ...data,
      consumedAt: null,
    };
    this.records.set(record.vpId, record);
    return record;
  }

  async findByVpId(vpId: string): Promise<VpIdRecord | null> {
    if (this.db) {
      return this.db.vpId.findUnique({
        where: { vpId },
      });
    }

    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteVpRow>(`
        SELECT * FROM vp_ids WHERE vp_id = ${sqliteLiteral(vpId)} LIMIT 1
      `);
      return fromSqliteRow(rows[0]);
    }

    return this.records.get(vpId) ?? null;
  }

  async consumeAtomically(vpId: string): Promise<boolean> {
    if (this.db) {
      try {
        const result = await this.db.vpId.updateMany({
          where: {
            vpId,
            consumedAt: null,
          },
          data: {
            consumedAt: new Date(),
          },
        });
        return (result as UpdateManyResult).count > 0;
      } catch {
        return false;
      }
    }

    if (this.sqlite) {
      const now = new Date();
      this.sqlite.execute(`
        UPDATE vp_ids
        SET consumed_at = ${sqliteLiteral(now)}
        WHERE vp_id = ${sqliteLiteral(vpId)}
          AND consumed_at IS NULL
      `);
      const row = await this.findByVpId(vpId);
      return Boolean(row?.consumedAt && row.consumedAt.getTime() === now.getTime());
    }

    const record = this.records.get(vpId);
    if (!record || record.consumedAt) return false;
    this.records.set(vpId, { ...record, consumedAt: new Date() });
    return true;
  }
}
