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
// See docs/proposal-hosted-instance.md ("Sessions: access + refresh
// tokens"). Refresh tokens are opaque, stored hashed, and rotated on every
// use; `replacedByTokenId` forms a chain that AuthService.refresh() walks
// to detect reuse of an already-revoked token (compromise signal).

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

type PrismaRaw = PrismaClient & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type PrismaWithRefreshToken = PrismaClient & {
  refreshToken: {
    create(args: { data: Record<string, unknown> }): Promise<RefreshTokenRecord>;
    findUnique(args: { where: Record<string, unknown> }): Promise<RefreshTokenRecord | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<RefreshTokenRecord>;
    updateMany(args: {
      where: { accountId: string; revokedAt: null };
      data: { revokedAt: Date };
    }): Promise<{ count: number }>;
  };
};

export interface RefreshTokenRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
  createdAt: Date;
}

type SqliteRefreshTokenRow = {
  id: string;
  account_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by_token_id: string | null;
  created_at: string;
};

function fromSqliteRow(row: SqliteRefreshTokenRow | undefined): RefreshTokenRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    replacedByTokenId: row.replaced_by_token_id,
    createdAt: new Date(row.created_at),
  };
}

function makeId(): string {
  return `rtk:${Math.random().toString(16).slice(2, 14)}`;
}

function hasRealRaw(prisma: PrismaClient): boolean {
  return (
    typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function' &&
    typeof (prisma as { $connect?: unknown }).$connect === 'function'
  );
}

export class RefreshTokenRepository {
  private readonly rowsByHash = new Map<string, RefreshTokenRecord>();

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  async create(data: { accountId: string; tokenHash: string; expiresAt: Date }): Promise<RefreshTokenRecord> {
    const id = makeId();
    const createdAt = new Date();

    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<RefreshTokenRecord[]>(
        `INSERT INTO "refresh_tokens" (
          "id", "accountId", "tokenHash", "expiresAt", "revokedAt", "replacedByTokenId", "createdAt"
        ) VALUES ($1, $2, $3, $4, NULL, NULL, $5)
        RETURNING *`,
        id,
        data.accountId,
        data.tokenHash,
        data.expiresAt,
        createdAt,
      );
      const row = rows[0];
      if (!row) throw new Error('RefreshToken insert returned no rows');
      return row;
    }

    if (this.prisma) {
      return (await (this.prisma as PrismaWithRefreshToken).refreshToken.create({
        data: { id, accountId: data.accountId, tokenHash: data.tokenHash, expiresAt: data.expiresAt },
      })) as RefreshTokenRecord;
    }

    if (this.sqlite) {
      this.sqlite.execute(`
        INSERT INTO refresh_tokens (id, account_id, token_hash, expires_at, revoked_at, replaced_by_token_id, created_at)
        VALUES (
          ${sqliteLiteral(id)},
          ${sqliteLiteral(data.accountId)},
          ${sqliteLiteral(data.tokenHash)},
          ${sqliteLiteral(data.expiresAt)},
          NULL,
          NULL,
          ${sqliteLiteral(createdAt)}
        )
      `);
      return {
        id,
        accountId: data.accountId,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
        revokedAt: null,
        replacedByTokenId: null,
        createdAt,
      };
    }

    const record: RefreshTokenRecord = {
      id,
      accountId: data.accountId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      revokedAt: null,
      replacedByTokenId: null,
      createdAt,
    };
    this.rowsByHash.set(data.tokenHash, record);
    return record;
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<RefreshTokenRecord[]>(
        `SELECT * FROM "refresh_tokens" WHERE "tokenHash" = $1 LIMIT 1`,
        tokenHash,
      );
      return rows[0] ?? null;
    }
    if (this.prisma) {
      return (this.prisma as PrismaWithRefreshToken).refreshToken.findUnique({
        where: { tokenHash },
      });
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteRefreshTokenRow>(
        `SELECT * FROM refresh_tokens WHERE token_hash = ${sqliteLiteral(tokenHash)} LIMIT 1`,
      );
      return fromSqliteRow(rows[0]);
    }
    return this.rowsByHash.get(tokenHash) ?? null;
  }

  /** Marks a token revoked and, if rotated rather than just logged out, links it to its successor. */
  async revoke(id: string, replacedByTokenId?: string): Promise<void> {
    const now = new Date();

    if (this.prisma && hasRealRaw(this.prisma)) {
      await (this.prisma as PrismaRaw).$queryRawUnsafe(
        `UPDATE "refresh_tokens" SET "revokedAt" = $1, "replacedByTokenId" = $2 WHERE "id" = $3`,
        now,
        replacedByTokenId ?? null,
        id,
      );
      return;
    }
    if (this.prisma) {
      await (this.prisma as PrismaWithRefreshToken).refreshToken.update({
        where: { id },
        data: { revokedAt: now, replacedByTokenId: replacedByTokenId ?? null },
      });
      return;
    }
    if (this.sqlite) {
      this.sqlite.execute(`
        UPDATE refresh_tokens
        SET revoked_at = ${sqliteLiteral(now)}, replaced_by_token_id = ${sqliteLiteral(replacedByTokenId ?? null)}
        WHERE id = ${sqliteLiteral(id)}
      `);
      return;
    }
    for (const record of this.rowsByHash.values()) {
      if (record.id === id) {
        record.revokedAt = now;
        record.replacedByTokenId = replacedByTokenId ?? null;
      }
    }
  }

  /** Reuse-detection response: revoke every outstanding refresh token for an account. */
  async revokeAllForAccount(accountId: string): Promise<void> {
    const now = new Date();

    if (this.prisma && hasRealRaw(this.prisma)) {
      await (this.prisma as PrismaRaw).$queryRawUnsafe(
        `UPDATE "refresh_tokens" SET "revokedAt" = $1 WHERE "accountId" = $2 AND "revokedAt" IS NULL`,
        now,
        accountId,
      );
      return;
    }
    if (this.prisma) {
      await (this.prisma as PrismaWithRefreshToken).refreshToken.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: now },
      });
      return;
    }
    if (this.sqlite) {
      this.sqlite.execute(`
        UPDATE refresh_tokens SET revoked_at = ${sqliteLiteral(now)}
        WHERE account_id = ${sqliteLiteral(accountId)} AND revoked_at IS NULL
      `);
      return;
    }
    for (const record of this.rowsByHash.values()) {
      if (record.accountId === accountId && !record.revokedAt) {
        record.revokedAt = now;
      }
    }
  }
}
