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
// See docs/proposal-hosted-instance.md ("Decided: accounts, login, and
// DID/key custody"). Plain email/Google account table — deliberately not
// DID-specific, since there's no W3C standard for accounts/sessions.

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

type PrismaRaw = PrismaClient & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

// The Account Prisma model type isn't available until `prisma generate`
// re-runs against the updated schema (sandbox has no network access to
// binaries.prisma.sh — see repo constraint notes). Mirrors
// PreparedPayloadRepository's pattern: a minimal structural type so this
// file typechecks today and works unchanged once the client regenerates.
type PrismaWithAccount = PrismaClient & {
  account: {
    create(args: { data: Record<string, unknown> }): Promise<AccountRecord>;
    findUnique(args: { where: Record<string, unknown> }): Promise<AccountRecord | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<AccountRecord>;
  };
};

export interface AccountRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  googleId: string | null;
  issuerDid: string | null;
  emailVerifiedAt: Date | null;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type SqliteAccountRow = {
  id: string;
  email: string;
  password_hash: string | null;
  google_id: string | null;
  issuer_did: string | null;
  email_verified_at: string | null;
  email_verification_token_hash: string | null;
  email_verification_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function fromSqliteRow(row: SqliteAccountRow | undefined): AccountRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    googleId: row.google_id,
    issuerDid: row.issuer_did,
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at) : null,
    emailVerificationTokenHash: row.email_verification_token_hash,
    emailVerificationExpiresAt: row.email_verification_expires_at
      ? new Date(row.email_verification_expires_at)
      : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function makeId(): string {
  return `acct:${Math.random().toString(16).slice(2, 14)}`;
}

function hasRealRaw(prisma: PrismaClient): boolean {
  return (
    typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function' &&
    typeof (prisma as { $connect?: unknown }).$connect === 'function'
  );
}

export class AccountRepository {
  private readonly rows = new Map<string, AccountRecord>();

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  async create(data: {
    email: string;
    passwordHash: string | null;
    googleId: string | null;
  }): Promise<AccountRecord> {
    const id = makeId();
    const now = new Date();

    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<AccountRecord[]>(
        `INSERT INTO "accounts" (
          "id", "email", "passwordHash", "googleId", "issuerDid", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, NULL, $5, $5)
        RETURNING *`,
        id,
        data.email,
        data.passwordHash,
        data.googleId,
        now,
      );
      const row = rows[0];
      if (!row) throw new Error('Account insert returned no rows');
      return row;
    }

    if (this.prisma) {
      return (await (this.prisma as PrismaWithAccount).account.create({
        data: {
          id,
          email: data.email,
          passwordHash: data.passwordHash,
          googleId: data.googleId,
        },
      })) as AccountRecord;
    }

    if (this.sqlite) {
      this.sqlite.execute(`
        INSERT INTO accounts (
          id, email, password_hash, google_id, issuer_did,
          email_verified_at, email_verification_token_hash, email_verification_expires_at,
          created_at, updated_at
        )
        VALUES (
          ${sqliteLiteral(id)},
          ${sqliteLiteral(data.email)},
          ${sqliteLiteral(data.passwordHash)},
          ${sqliteLiteral(data.googleId)},
          NULL, NULL, NULL, NULL,
          ${sqliteLiteral(now)},
          ${sqliteLiteral(now)}
        )
      `);
      return {
        id,
        email: data.email,
        passwordHash: data.passwordHash,
        googleId: data.googleId,
        issuerDid: null,
        emailVerifiedAt: null,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    const record: AccountRecord = {
      id,
      email: data.email,
      passwordHash: data.passwordHash,
      googleId: data.googleId,
      issuerDid: null,
      emailVerifiedAt: null,
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(id, record);
    return record;
  }

  async findById(id: string): Promise<AccountRecord | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<AccountRecord[]>(
        `SELECT * FROM "accounts" WHERE "id" = $1 LIMIT 1`,
        id,
      );
      return rows[0] ?? null;
    }
    if (this.prisma) {
      return (this.prisma as PrismaWithAccount).account.findUnique({ where: { id } });
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteAccountRow>(
        `SELECT * FROM accounts WHERE id = ${sqliteLiteral(id)} LIMIT 1`,
      );
      return fromSqliteRow(rows[0]);
    }
    return this.rows.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<AccountRecord | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<AccountRecord[]>(
        `SELECT * FROM "accounts" WHERE "email" = $1 LIMIT 1`,
        email,
      );
      return rows[0] ?? null;
    }
    if (this.prisma) {
      return (this.prisma as PrismaWithAccount).account.findUnique({ where: { email } });
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteAccountRow>(
        `SELECT * FROM accounts WHERE email = ${sqliteLiteral(email)} LIMIT 1`,
      );
      return fromSqliteRow(rows[0]);
    }
    for (const record of this.rows.values()) {
      if (record.email === email) return record;
    }
    return null;
  }

  async findByGoogleId(googleId: string): Promise<AccountRecord | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<AccountRecord[]>(
        `SELECT * FROM "accounts" WHERE "googleId" = $1 LIMIT 1`,
        googleId,
      );
      return rows[0] ?? null;
    }
    if (this.prisma) {
      return (this.prisma as PrismaWithAccount).account.findUnique({ where: { googleId } });
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteAccountRow>(
        `SELECT * FROM accounts WHERE google_id = ${sqliteLiteral(googleId)} LIMIT 1`,
      );
      return fromSqliteRow(rows[0]);
    }
    for (const record of this.rows.values()) {
      if (record.googleId === googleId) return record;
    }
    return null;
  }

  /** Sets googleId on an account that registered with a password (account linking). */
  async linkGoogleId(id: string, googleId: string): Promise<AccountRecord> {
    return this.update(id, { googleId });
  }

  /** Records the auto-provisioned issuer DID for this account (set once, at creation time). */
  async setIssuerDid(id: string, issuerDid: string): Promise<AccountRecord> {
    return this.update(id, { issuerDid });
  }

  /** Stores a hashed, expiring email-verification token — see services/auth/email-verification.ts. */
  async setEmailVerificationToken(
    id: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<AccountRecord> {
    return this.update(id, {
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
    });
  }

  /** Marks the email verified and clears the (now-consumed) token. */
  async markEmailVerified(id: string): Promise<AccountRecord> {
    return this.update(id, {
      emailVerifiedAt: new Date(),
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    });
  }

  async findByEmailVerificationTokenHash(tokenHash: string): Promise<AccountRecord | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<AccountRecord[]>(
        `SELECT * FROM "accounts" WHERE "emailVerificationTokenHash" = $1 LIMIT 1`,
        tokenHash,
      );
      return rows[0] ?? null;
    }
    if (this.prisma) {
      return (this.prisma as PrismaWithAccount).account.findUnique({
        where: { emailVerificationTokenHash: tokenHash } as unknown as Record<string, unknown>,
      });
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteAccountRow>(
        `SELECT * FROM accounts WHERE email_verification_token_hash = ${sqliteLiteral(tokenHash)} LIMIT 1`,
      );
      return fromSqliteRow(rows[0]);
    }
    for (const record of this.rows.values()) {
      if (record.emailVerificationTokenHash === tokenHash) return record;
    }
    return null;
  }

  private async update(id: string, patch: Partial<AccountRecord>): Promise<AccountRecord> {
    const now = new Date();

    if (this.prisma && hasRealRaw(this.prisma)) {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, value] of Object.entries(patch)) {
        const column = key === 'googleId' ? 'googleId' : key === 'issuerDid' ? 'issuerDid' : key;
        setClauses.push(`"${column}" = $${i}`);
        values.push(value);
        i += 1;
      }
      setClauses.push(`"updatedAt" = $${i}`);
      values.push(now);
      values.push(id);
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<AccountRecord[]>(
        `UPDATE "accounts" SET ${setClauses.join(', ')} WHERE "id" = $${i + 1} RETURNING *`,
        ...values,
      );
      const row = rows[0];
      if (!row) throw new Error('Account update affected no rows');
      return row;
    }

    if (this.prisma) {
      return (await (this.prisma as PrismaWithAccount).account.update({
        where: { id },
        data: patch,
      })) as AccountRecord;
    }

    if (this.sqlite) {
      const setClauses: string[] = [];
      if (patch.googleId !== undefined) setClauses.push(`google_id = ${sqliteLiteral(patch.googleId)}`);
      if (patch.issuerDid !== undefined) setClauses.push(`issuer_did = ${sqliteLiteral(patch.issuerDid)}`);
      if (patch.passwordHash !== undefined)
        setClauses.push(`password_hash = ${sqliteLiteral(patch.passwordHash)}`);
      if (patch.emailVerifiedAt !== undefined)
        setClauses.push(`email_verified_at = ${sqliteLiteral(patch.emailVerifiedAt)}`);
      if (patch.emailVerificationTokenHash !== undefined)
        setClauses.push(
          `email_verification_token_hash = ${sqliteLiteral(patch.emailVerificationTokenHash)}`,
        );
      if (patch.emailVerificationExpiresAt !== undefined)
        setClauses.push(
          `email_verification_expires_at = ${sqliteLiteral(patch.emailVerificationExpiresAt)}`,
        );
      setClauses.push(`updated_at = ${sqliteLiteral(now)}`);
      this.sqlite.execute(
        `UPDATE accounts SET ${setClauses.join(', ')} WHERE id = ${sqliteLiteral(id)}`,
      );
      const updated = await this.findById(id);
      if (!updated) throw new Error('Account update affected no rows');
      return updated;
    }

    const record = this.rows.get(id);
    if (!record) throw new Error('Account update affected no rows');
    const updated: AccountRecord = { ...record, ...patch, updatedAt: now };
    this.rows.set(id, updated);
    return updated;
  }
}
