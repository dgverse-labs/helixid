// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Storage-driver implementations for VPRepository — see
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
import type { VpIdRecord } from '../vp.repository.js';

type UpdateManyResult = {
  count: number;
};

export interface VpStorageDriver {
  create(data: Omit<VpIdRecord, 'consumedAt'>): Promise<VpIdRecord>;
  findByVpId(vpId: string): Promise<VpIdRecord | null>;
  consumeAtomically(vpId: string): Promise<boolean>;
}

export class PrismaVpStorageDriver implements VpStorageDriver {
  constructor(private readonly db: PrismaClient) {}

  async create(data: Omit<VpIdRecord, 'consumedAt'>): Promise<VpIdRecord> {
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

  async findByVpId(vpId: string): Promise<VpIdRecord | null> {
    return this.db.vpId.findUnique({ where: { vpId } });
  }

  async consumeAtomically(vpId: string): Promise<boolean> {
    try {
      const result = await this.db.vpId.updateMany({
        where: { vpId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return (result as UpdateManyResult).count > 0;
    } catch {
      return false;
    }
  }
}

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

export class SqliteVpStorageDriver implements VpStorageDriver {
  constructor(private readonly sqlite: SqliteStore) {}

  async create(data: Omit<VpIdRecord, 'consumedAt'>): Promise<VpIdRecord> {
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
    return { ...data, consumedAt: null };
  }

  async findByVpId(vpId: string): Promise<VpIdRecord | null> {
    const rows = this.sqlite.query<SqliteVpRow>(`
      SELECT * FROM vp_ids WHERE vp_id = ${sqliteLiteral(vpId)} LIMIT 1
    `);
    return fromSqliteRow(rows[0]);
  }

  async consumeAtomically(vpId: string): Promise<boolean> {
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
}

export class InMemoryVpStorageDriver implements VpStorageDriver {
  private readonly records = new Map<string, VpIdRecord>();

  async create(data: Omit<VpIdRecord, 'consumedAt'>): Promise<VpIdRecord> {
    const record: VpIdRecord = { ...data, consumedAt: null };
    this.records.set(record.vpId, record);
    return record;
  }

  async findByVpId(vpId: string): Promise<VpIdRecord | null> {
    return this.records.get(vpId) ?? null;
  }

  async consumeAtomically(vpId: string): Promise<boolean> {
    const record = this.records.get(vpId);
    if (!record || record.consumedAt) return false;
    this.records.set(vpId, { ...record, consumedAt: new Date() });
    return true;
  }
}

export function createVpStorageDriver(
  kind: StorageDriverKind,
  deps: StorageDriverDeps,
): VpStorageDriver {
  switch (kind) {
    case 'postgres':
      if (!deps.prisma) throw new Error("createVpStorageDriver('postgres') requires deps.prisma");
      return new PrismaVpStorageDriver(deps.prisma as PrismaClient);
    case 'sqlite':
      if (!deps.sqlite) throw new Error("createVpStorageDriver('sqlite') requires deps.sqlite");
      return new SqliteVpStorageDriver(deps.sqlite as SqliteStore);
    case 'memory':
      return new InMemoryVpStorageDriver();
    default: {
      const _exhaustive: never = kind;
      throw new UnsupportedStorageDriverError('VPRepository', _exhaustive);
    }
  }
}
