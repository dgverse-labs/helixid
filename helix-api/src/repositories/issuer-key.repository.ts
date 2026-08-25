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
// Stores AES-256-GCM-encrypted private keys for hosted-account issuer DIDs.
// See docs/proposal-hosted-instance.md ("Private key storage (interim,
// pre-KMS)"). Rows are only ever written/read through KeyCustody
// (services/auth/key-custody.ts) — never decrypted here.

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

type PrismaRaw = PrismaClient & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type PrismaWithIssuerKeyRecord = PrismaClient & {
  issuerKeyRecord: {
    create(args: { data: Record<string, unknown> }): Promise<IssuerKeyRecordRow>;
    findUnique(args: { where: Record<string, unknown> }): Promise<IssuerKeyRecordRow | null>;
  };
};

export interface IssuerKeyRecordRow {
  id: string;
  accountId: string;
  did: string;
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
  algorithm: string;
  createdAt: Date;
}

type SqliteIssuerKeyRow = {
  id: string;
  account_id: string;
  did: string;
  encrypted_private_key: string;
  iv: string;
  auth_tag: string;
  algorithm: string;
  created_at: string;
};

function fromSqliteRow(row: SqliteIssuerKeyRow | undefined): IssuerKeyRecordRow | null {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    did: row.did,
    encryptedPrivateKey: row.encrypted_private_key,
    iv: row.iv,
    authTag: row.auth_tag,
    algorithm: row.algorithm,
    createdAt: new Date(row.created_at),
  };
}

function makeId(): string {
  return `ikr:${Math.random().toString(16).slice(2, 14)}`;
}

function hasRealRaw(prisma: PrismaClient): boolean {
  return (
    typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function' &&
    typeof (prisma as { $connect?: unknown }).$connect === 'function'
  );
}

export class IssuerKeyRepository {
  private readonly rowsByAccount = new Map<string, IssuerKeyRecordRow>();

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  async create(
    data: Omit<IssuerKeyRecordRow, 'id' | 'createdAt'>,
  ): Promise<IssuerKeyRecordRow> {
    const id = makeId();
    const createdAt = new Date();

    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<IssuerKeyRecordRow[]>(
        `INSERT INTO "issuer_key_records" (
          "id", "accountId", "did", "encryptedPrivateKey", "iv", "authTag", "algorithm", "createdAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        id,
        data.accountId,
        data.did,
        data.encryptedPrivateKey,
        data.iv,
        data.authTag,
        data.algorithm,
        createdAt,
      );
      const row = rows[0];
      if (!row) throw new Error('IssuerKeyRecord insert returned no rows');
      return row;
    }

    if (this.prisma) {
      return (await (this.prisma as PrismaWithIssuerKeyRecord).issuerKeyRecord.create({
        data: { id, ...data },
      })) as IssuerKeyRecordRow;
    }

    if (this.sqlite) {
      this.sqlite.execute(`
        INSERT INTO issuer_key_records (
          id, account_id, did, encrypted_private_key, iv, auth_tag, algorithm, created_at
        ) VALUES (
          ${sqliteLiteral(id)},
          ${sqliteLiteral(data.accountId)},
          ${sqliteLiteral(data.did)},
          ${sqliteLiteral(data.encryptedPrivateKey)},
          ${sqliteLiteral(data.iv)},
          ${sqliteLiteral(data.authTag)},
          ${sqliteLiteral(data.algorithm)},
          ${sqliteLiteral(createdAt)}
        )
      `);
      return { id, ...data, createdAt };
    }

    const record: IssuerKeyRecordRow = { id, ...data, createdAt };
    this.rowsByAccount.set(data.accountId, record);
    return record;
  }

  async findByAccountId(accountId: string): Promise<IssuerKeyRecordRow | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<IssuerKeyRecordRow[]>(
        `SELECT * FROM "issuer_key_records" WHERE "accountId" = $1 LIMIT 1`,
        accountId,
      );
      return rows[0] ?? null;
    }
    if (this.prisma) {
      return (this.prisma as PrismaWithIssuerKeyRecord).issuerKeyRecord.findUnique({
        where: { accountId },
      });
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteIssuerKeyRow>(
        `SELECT * FROM issuer_key_records WHERE account_id = ${sqliteLiteral(accountId)} LIMIT 1`,
      );
      return fromSqliteRow(rows[0]);
    }
    return this.rowsByAccount.get(accountId) ?? null;
  }
}
