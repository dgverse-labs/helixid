// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Storage-driver implementations for PreparedPayloadRepository — see
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
import type { PreparedPayloadRecord } from '../prepared-payload.repository.js';

type PrismaRaw = PrismaClient & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

// The PreparedPayload Prisma model type isn't available until `prisma
// generate` re-runs against the updated schema. This mirrors PrismaRaw's
// pattern: a minimal structural type so this file typechecks today and
// works unchanged once the client is regenerated.
type PrismaWithPreparedPayload = PrismaClient & {
  preparedPayload: {
    create(args: { data: Record<string, unknown> }): Promise<PreparedPayloadRecord>;
    findUnique(args: { where: { token: string } }): Promise<PreparedPayloadRecord | null>;
    updateMany(args: {
      where: { token: string; consumedAt: null };
      data: { consumedAt: Date };
    }): Promise<{ count: number }>;
  };
};

export interface PreparedPayloadStorageDriver {
  create(
    data: Omit<PreparedPayloadRecord, 'id' | 'token' | 'consumedAt' | 'createdAt'>,
  ): Promise<PreparedPayloadRecord>;
  findByToken(token: string): Promise<PreparedPayloadRecord | null>;
  markConsumedAtomically(token: string): Promise<boolean>;
}

function makeId(): string {
  return `pp:${Math.random().toString(16).slice(2, 14)}`;
}

function makeToken(): string {
  return `ppt_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function hasRealRaw(prisma: PrismaClient): boolean {
  return (
    typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function' &&
    typeof (prisma as { $connect?: unknown }).$connect === 'function'
  );
}

export class PrismaPreparedPayloadStorageDriver implements PreparedPayloadStorageDriver {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<PreparedPayloadRecord, 'id' | 'token' | 'consumedAt' | 'createdAt'>,
  ): Promise<PreparedPayloadRecord> {
    const id = makeId();
    const token = makeToken();
    const createdAt = new Date();

    if (hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<PreparedPayloadRecord[]>(
        `INSERT INTO "prepared_payloads" (
          "id", "token", "purpose", "unsignedPayload", "canonicalHash",
          "expectedSignerDid", "expiresAt", "consumedAt", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)
        RETURNING *`,
        id,
        token,
        data.purpose,
        data.unsignedPayload,
        data.canonicalHash,
        data.expectedSignerDid,
        data.expiresAt,
        createdAt,
      );
      const row = rows[0];
      if (!row) throw new Error('PreparedPayload insert returned no rows');
      return row;
    }

    return (await (this.prisma as PrismaWithPreparedPayload).preparedPayload.create({
      data: {
        id,
        token,
        purpose: data.purpose,
        unsignedPayload: data.unsignedPayload,
        canonicalHash: data.canonicalHash,
        expectedSignerDid: data.expectedSignerDid,
        expiresAt: data.expiresAt,
      },
    })) as PreparedPayloadRecord;
  }

  async findByToken(token: string): Promise<PreparedPayloadRecord | null> {
    if (hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<PreparedPayloadRecord[]>(
        `SELECT * FROM "prepared_payloads" WHERE "token" = $1 LIMIT 1`,
        token,
      );
      return rows[0] ?? null;
    }

    return (await (this.prisma as PrismaWithPreparedPayload).preparedPayload.findUnique({
      where: { token },
    })) as PreparedPayloadRecord | null;
  }

  async markConsumedAtomically(token: string): Promise<boolean> {
    const now = new Date();

    if (hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<PreparedPayloadRecord[]>(
        `UPDATE "prepared_payloads" SET "consumedAt" = $1
         WHERE "token" = $2 AND "consumedAt" IS NULL
         RETURNING *`,
        now,
        token,
      );
      return rows.length === 1;
    }

    const result = await (this.prisma as PrismaWithPreparedPayload).preparedPayload.updateMany({
      where: { token, consumedAt: null },
      data: { consumedAt: now },
    });
    return result.count === 1;
  }
}

type SqlitePreparedPayloadRow = {
  id: string;
  token: string;
  purpose: PreparedPayloadRecord['purpose'];
  unsigned_payload: string;
  canonical_hash: string;
  expected_signer_did: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

function fromSqliteRow(row: SqlitePreparedPayloadRow | undefined): PreparedPayloadRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    purpose: row.purpose,
    unsignedPayload: row.unsigned_payload,
    canonicalHash: row.canonical_hash,
    expectedSignerDid: row.expected_signer_did,
    expiresAt: new Date(row.expires_at),
    consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    createdAt: new Date(row.created_at),
  };
}

export class SqlitePreparedPayloadStorageDriver implements PreparedPayloadStorageDriver {
  constructor(private readonly sqlite: SqliteStore) {}

  async create(
    data: Omit<PreparedPayloadRecord, 'id' | 'token' | 'consumedAt' | 'createdAt'>,
  ): Promise<PreparedPayloadRecord> {
    const id = makeId();
    const token = makeToken();
    const createdAt = new Date();
    this.sqlite.execute(`
      INSERT INTO prepared_payloads (
        id, token, purpose, unsigned_payload, canonical_hash,
        expected_signer_did, expires_at, consumed_at, created_at
      ) VALUES (
        ${sqliteLiteral(id)},
        ${sqliteLiteral(token)},
        ${sqliteLiteral(data.purpose)},
        ${sqliteLiteral(data.unsignedPayload)},
        ${sqliteLiteral(data.canonicalHash)},
        ${sqliteLiteral(data.expectedSignerDid)},
        ${sqliteLiteral(data.expiresAt)},
        NULL,
        ${sqliteLiteral(createdAt)}
      )
    `);
    return { id, token, ...data, consumedAt: null, createdAt };
  }

  async findByToken(token: string): Promise<PreparedPayloadRecord | null> {
    const rows = this.sqlite.query<SqlitePreparedPayloadRow>(`
      SELECT * FROM prepared_payloads WHERE token = ${sqliteLiteral(token)} LIMIT 1
    `);
    return fromSqliteRow(rows[0]);
  }

  async markConsumedAtomically(token: string): Promise<boolean> {
    const now = new Date();
    const { changes } = this.sqlite.run(`
      UPDATE prepared_payloads
      SET consumed_at = ${sqliteLiteral(now)}
      WHERE token = ${sqliteLiteral(token)}
        AND consumed_at IS NULL
    `);
    return changes === 1;
  }
}

export class InMemoryPreparedPayloadStorageDriver implements PreparedPayloadStorageDriver {
  private readonly rows = new Map<string, PreparedPayloadRecord>();

  async create(
    data: Omit<PreparedPayloadRecord, 'id' | 'token' | 'consumedAt' | 'createdAt'>,
  ): Promise<PreparedPayloadRecord> {
    const id = makeId();
    const token = makeToken();
    const createdAt = new Date();
    const record: PreparedPayloadRecord = { id, token, ...data, consumedAt: null, createdAt };
    this.rows.set(token, record);
    return record;
  }

  async findByToken(token: string): Promise<PreparedPayloadRecord | null> {
    return this.rows.get(token) ?? null;
  }

  async markConsumedAtomically(token: string): Promise<boolean> {
    const record = this.rows.get(token);
    if (!record || record.consumedAt) {
      return false;
    }
    record.consumedAt = new Date();
    this.rows.set(token, record);
    return true;
  }
}

export function createPreparedPayloadStorageDriver(
  kind: StorageDriverKind,
  deps: StorageDriverDeps,
): PreparedPayloadStorageDriver {
  switch (kind) {
    case 'postgres':
      if (!deps.prisma)
        throw new Error("createPreparedPayloadStorageDriver('postgres') requires deps.prisma");
      return new PrismaPreparedPayloadStorageDriver(deps.prisma as PrismaClient);
    case 'sqlite':
      if (!deps.sqlite)
        throw new Error("createPreparedPayloadStorageDriver('sqlite') requires deps.sqlite");
      return new SqlitePreparedPayloadStorageDriver(deps.sqlite as SqliteStore);
    case 'memory':
      return new InMemoryPreparedPayloadStorageDriver();
    default: {
      const _exhaustive: never = kind;
      throw new UnsupportedStorageDriverError('PreparedPayloadRepository', _exhaustive);
    }
  }
}
