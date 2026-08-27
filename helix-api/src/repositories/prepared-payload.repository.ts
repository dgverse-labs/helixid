// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// See docs/proposal-sdk-api-only.md ("prepare-endpoint auth and idempotency").
// A PreparedPayload row is a short-lived, single-use binding between an
// unsigned VC payload the API constructed and the DID that must sign it.
// finalize() consumes it exactly once.

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

type PrismaRaw = PrismaClient & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

// The PreparedPayload Prisma model type isn't available until `prisma generate`
// re-runs against the updated schema (see prisma/schema.prisma). This mirrors
// PrismaRaw's pattern: a minimal structural type so this file typechecks
// today and works unchanged once the client is regenerated.
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

export type PreparedPayloadPurpose = 'delegation' | 'grant' | 'agent-renewal';

export interface PreparedPayloadRecord {
  id: string;
  token: string;
  purpose: PreparedPayloadPurpose;
  unsignedPayload: string;
  canonicalHash: string;
  expectedSignerDid: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

type SqlitePreparedPayloadRow = {
  id: string;
  token: string;
  purpose: PreparedPayloadPurpose;
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

function makeId(): string {
  return `pp:${Math.random().toString(16).slice(2, 14)}`;
}

function makeToken(): string {
  // Opaque bearer-style token, distinct from the row id so the id can stay
  // an internal implementation detail if this ever needs to be exposed.
  return `ppt_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function hasRealRaw(prisma: PrismaClient): boolean {
  return (
    typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function' &&
    typeof (prisma as { $connect?: unknown }).$connect === 'function'
  );
}

export class PreparedPayloadRepository {
  private readonly rows = new Map<string, PreparedPayloadRecord>();

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  async create(
    data: Omit<PreparedPayloadRecord, 'id' | 'token' | 'consumedAt' | 'createdAt'>,
  ): Promise<PreparedPayloadRecord> {
    const id = makeId();
    const token = makeToken();
    const createdAt = new Date();

    if (this.prisma && hasRealRaw(this.prisma)) {
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

    if (this.prisma) {
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

    if (this.sqlite) {
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

    const record: PreparedPayloadRecord = { id, token, ...data, consumedAt: null, createdAt };
    this.rows.set(token, record);
    return record;
  }

  async findByToken(token: string): Promise<PreparedPayloadRecord | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<PreparedPayloadRecord[]>(
        `SELECT * FROM "prepared_payloads" WHERE "token" = $1 LIMIT 1`,
        token,
      );
      return rows[0] ?? null;
    }

    if (this.prisma) {
      return (await (this.prisma as PrismaWithPreparedPayload).preparedPayload.findUnique({
        where: { token },
      })) as PreparedPayloadRecord | null;
    }

    if (this.sqlite) {
      const rows = this.sqlite.query<SqlitePreparedPayloadRow>(`
        SELECT * FROM prepared_payloads WHERE token = ${sqliteLiteral(token)} LIMIT 1
      `);
      return fromSqliteRow(rows[0]);
    }

    return this.rows.get(token) ?? null;
  }

  /**
   * Marks a row consumed exactly once — atomic where the backend supports it
   * (single UPDATE ... WHERE consumedAt IS NULL). Returns true only for the
   * caller that actually performed the transition, so concurrent finalize
   * attempts against the same token can't both succeed.
   */
  async markConsumedAtomically(token: string): Promise<boolean> {
    const now = new Date();

    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<PreparedPayloadRecord[]>(
        `UPDATE "prepared_payloads" SET "consumedAt" = $1
         WHERE "token" = $2 AND "consumedAt" IS NULL
         RETURNING *`,
        now,
        token,
      );
      return rows.length === 1;
    }

    if (this.prisma) {
      const result = await (this.prisma as PrismaWithPreparedPayload).preparedPayload.updateMany({
        where: { token, consumedAt: null },
        data: { consumedAt: now },
      });
      return result.count === 1;
    }

    if (this.sqlite) {
      const { changes } = this.sqlite.run(`
        UPDATE prepared_payloads
        SET consumed_at = ${sqliteLiteral(now)}
        WHERE token = ${sqliteLiteral(token)}
          AND consumed_at IS NULL
      `);
      return changes === 1;
    }

    const record = this.rows.get(token);
    if (!record || record.consumedAt) {
      return false;
    }
    record.consumedAt = now;
    this.rows.set(token, record);
    return true;
  }
}
