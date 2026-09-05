// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Storage-driver implementations for DidRepository — the reference
// implementation of the pluggable driver pattern described in
// storage/driver-registry.ts. Every method here is a straight extraction
// of what used to be an `if (this.prisma) { ... }` / `if (this.sqlite)
// { ... }` / else-in-memory branch inside DidRepository itself; behavior
// is unchanged; only where the branching lives has moved.

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../../storage/sqlite.js';
import { sqliteLiteral } from '../../storage/sqlite.js';
import {
  UnsupportedStorageDriverError,
  type StorageDriverDeps,
  type StorageDriverKind,
} from '../../storage/driver-registry.js';
import type { CreateDIDRecordParams, DIDRecord } from '../did.repository.js';

interface DIDUpdateParams {
  updateType: string;
  hederaTransactionId: string;
  payload: unknown;
}

/**
 * Everything DidRepository needs from a storage backend. Adding a new
 * backend means implementing this interface and wiring it into
 * createDidStorageDriver() below — DidRepository itself never changes.
 */
export interface DidStorageDriver {
  createDid(data: CreateDIDRecordParams): Promise<DIDRecord>;
  findDidById(id: string): Promise<DIDRecord | null>;
  findDidByPublicKey(publicKey: string): Promise<DIDRecord | null>;
  findByPublicKeyMultibase(publicKeyMultibase: string): Promise<DIDRecord | null>;
  updateDidDocument(id: string, didDocument: unknown, update: DIDUpdateParams): Promise<unknown>;
  deactivateDid(id: string, deactivatedAt: Date): Promise<DIDRecord>;
}

type PrismaLike = PrismaClient & {
  did: {
    create(args: unknown): Promise<DIDRecord>;
    findUnique(args: unknown): Promise<DIDRecord | null>;
    findFirst(args: unknown): Promise<DIDRecord | null>;
    update(args: unknown): Promise<DIDRecord>;
  };
  didUpdate: {
    create(args: unknown): Promise<unknown>;
  };
  $transaction(args: unknown): Promise<unknown>;
};

export class PrismaDidStorageDriver implements DidStorageDriver {
  private readonly db: PrismaLike;

  constructor(prisma: PrismaClient) {
    this.db = prisma as PrismaLike;
  }

  async createDid(data: CreateDIDRecordParams): Promise<DIDRecord> {
    return this.db.did.create({
      data: {
        ...data,
        publicKeyMultibase: data.publicKeyMultibase ?? null,
      },
    });
  }

  async findDidById(id: string): Promise<DIDRecord | null> {
    return this.db.did.findUnique({
      where: { id },
      include: { updates: true },
    });
  }

  async findDidByPublicKey(publicKey: string): Promise<DIDRecord | null> {
    return this.db.did.findFirst({ where: { publicKey } });
  }

  async findByPublicKeyMultibase(publicKeyMultibase: string): Promise<DIDRecord | null> {
    return this.db.did.findFirst({ where: { publicKeyMultibase } });
  }

  async updateDidDocument(
    id: string,
    didDocument: unknown,
    update: DIDUpdateParams,
  ): Promise<unknown> {
    return this.db.$transaction([
      this.db.did.update({
        where: { id },
        data: { didDocument },
      }),
      this.db.didUpdate.create({
        data: {
          ...update,
          did: { connect: { id } },
        },
      }),
    ]);
  }

  async deactivateDid(id: string, deactivatedAt: Date): Promise<DIDRecord> {
    return this.db.did.update({
      where: { id },
      data: { deactivatedAt },
    });
  }
}

type SqliteDidRow = {
  id: string;
  subject_type: string;
  controller: string;
  public_key: string;
  public_key_multibase: string | null;
  hedera_topic_id: string | null;
  hedera_sequence_number: number | null;
  hedera_transaction_id: string;
  did_document: string;
  deactivated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function fromSqliteRow(row: SqliteDidRow | undefined): DIDRecord | null {
  if (!row) return null;
  const base: DIDRecord = {
    id: row.id,
    subjectType: row.subject_type,
    controller: row.controller,
    publicKey: row.public_key,
    publicKeyMultibase: row.public_key_multibase,
    hederaTopicId: row.hedera_topic_id,
    hederaSequenceNumber: row.hedera_sequence_number,
    hederaTransactionId: row.hedera_transaction_id,
    didDocument: JSON.parse(row.did_document),
    deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at) : null,
  };
  if (row.created_at) base.createdAt = new Date(row.created_at);
  if (row.updated_at) base.updatedAt = new Date(row.updated_at);
  return base;
}

export class SqliteDidStorageDriver implements DidStorageDriver {
  constructor(private readonly sqlite: SqliteStore) {}

  async createDid(data: CreateDIDRecordParams): Promise<DIDRecord> {
    const now = new Date();
    this.sqlite.execute(`
      INSERT INTO dids (
        id, subject_type, controller, public_key, public_key_multibase,
        hedera_topic_id, hedera_sequence_number, hedera_transaction_id,
        did_document, deactivated_at, created_at, updated_at
      ) VALUES (
        ${sqliteLiteral(data.id)},
        ${sqliteLiteral(data.subjectType)},
        ${sqliteLiteral(data.controller)},
        ${sqliteLiteral(data.publicKey)},
        ${sqliteLiteral(data.publicKeyMultibase ?? null)},
        ${sqliteLiteral(data.hederaTopicId ?? null)},
        ${sqliteLiteral(data.hederaSequenceNumber ?? null)},
        ${sqliteLiteral(data.hederaTransactionId)},
        ${sqliteLiteral(JSON.stringify(data.didDocument))},
        NULL,
        ${sqliteLiteral(now)},
        ${sqliteLiteral(now)}
      )
    `);
    return {
      id: data.id,
      subjectType: data.subjectType,
      controller: data.controller,
      publicKey: data.publicKey,
      publicKeyMultibase: data.publicKeyMultibase ?? null,
      hederaTopicId: data.hederaTopicId ?? null,
      hederaSequenceNumber: data.hederaSequenceNumber ?? null,
      hederaTransactionId: data.hederaTransactionId,
      didDocument: data.didDocument,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async findDidById(id: string): Promise<DIDRecord | null> {
    const rows = this.sqlite.query<SqliteDidRow>(`
      SELECT * FROM dids WHERE id = ${sqliteLiteral(id)} LIMIT 1
    `);
    return fromSqliteRow(rows[0]);
  }

  async findDidByPublicKey(publicKey: string): Promise<DIDRecord | null> {
    const rows = this.sqlite.query<SqliteDidRow>(`
      SELECT * FROM dids WHERE public_key = ${sqliteLiteral(publicKey)} LIMIT 1
    `);
    return fromSqliteRow(rows[0]);
  }

  async findByPublicKeyMultibase(publicKeyMultibase: string): Promise<DIDRecord | null> {
    const rows = this.sqlite.query<SqliteDidRow>(`
      SELECT * FROM dids WHERE public_key_multibase = ${sqliteLiteral(publicKeyMultibase)} LIMIT 1
    `);
    return fromSqliteRow(rows[0]);
  }

  async updateDidDocument(
    id: string,
    didDocument: unknown,
    update: DIDUpdateParams,
  ): Promise<unknown> {
    const now = new Date();
    this.sqlite.execute(`
      UPDATE dids
      SET did_document = ${sqliteLiteral(JSON.stringify(didDocument))},
          updated_at = ${sqliteLiteral(now)}
      WHERE id = ${sqliteLiteral(id)}
    `);
    this.sqlite.execute(`
      INSERT INTO did_updates (did_id, update_type, hedera_transaction_id, payload_json, created_at)
      VALUES (
        ${sqliteLiteral(id)},
        ${sqliteLiteral(update.updateType)},
        ${sqliteLiteral(update.hederaTransactionId)},
        ${sqliteLiteral(JSON.stringify(update.payload))},
        ${sqliteLiteral(now)}
      )
    `);
    const record = await this.findDidById(id);
    return [record, { ...update, didId: id }];
  }

  async deactivateDid(id: string, deactivatedAt: Date): Promise<DIDRecord> {
    this.sqlite.execute(`
      UPDATE dids
      SET deactivated_at = ${sqliteLiteral(deactivatedAt)},
          updated_at = ${sqliteLiteral(new Date())}
      WHERE id = ${sqliteLiteral(id)}
    `);
    const updated = await this.findDidById(id);
    if (!updated) throw new Error('DID not found');
    return updated;
  }
}

export class InMemoryDidStorageDriver implements DidStorageDriver {
  private readonly dids = new Map<string, DIDRecord>();

  async createDid(data: CreateDIDRecordParams): Promise<DIDRecord> {
    const now = new Date();
    const record: DIDRecord = {
      id: data.id,
      subjectType: data.subjectType,
      controller: data.controller,
      publicKey: data.publicKey,
      publicKeyMultibase: data.publicKeyMultibase ?? null,
      hederaTopicId: data.hederaTopicId ?? null,
      hederaSequenceNumber: data.hederaSequenceNumber ?? null,
      hederaTransactionId: data.hederaTransactionId,
      didDocument: data.didDocument,
      deactivatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.dids.set(record.id, record);
    return record;
  }

  async findDidById(id: string): Promise<DIDRecord | null> {
    return this.dids.get(id) ?? null;
  }

  async findDidByPublicKey(publicKey: string): Promise<DIDRecord | null> {
    for (const did of this.dids.values()) {
      if (did.publicKey === publicKey) return did;
    }
    return null;
  }

  async findByPublicKeyMultibase(publicKeyMultibase: string): Promise<DIDRecord | null> {
    for (const did of this.dids.values()) {
      if (did.publicKeyMultibase === publicKeyMultibase) return did;
    }
    return null;
  }

  async updateDidDocument(
    id: string,
    didDocument: unknown,
    update: DIDUpdateParams,
  ): Promise<unknown> {
    const existing = this.dids.get(id);
    if (!existing) throw new Error('DID not found');
    const next: DIDRecord = { ...existing, didDocument, updatedAt: new Date() };
    this.dids.set(id, next);
    return [next, { ...update, didId: id }];
  }

  async deactivateDid(id: string, deactivatedAt: Date): Promise<DIDRecord> {
    const existing = this.dids.get(id);
    if (!existing) throw new Error('DID not found');
    const next: DIDRecord = { ...existing, deactivatedAt, updatedAt: new Date() };
    this.dids.set(id, next);
    return next;
  }
}

/**
 * Selects a DidStorageDriver by kind. This is the one place that needs a
 * new `case` when a new backend is added for DIDs — DidRepository and
 * every other repository's driver factory are unaffected.
 */
export function createDidStorageDriver(
  kind: StorageDriverKind,
  deps: StorageDriverDeps,
): DidStorageDriver {
  switch (kind) {
    case 'postgres':
      if (!deps.prisma) throw new Error("createDidStorageDriver('postgres') requires deps.prisma");
      return new PrismaDidStorageDriver(deps.prisma as PrismaClient);
    case 'sqlite':
      if (!deps.sqlite) throw new Error("createDidStorageDriver('sqlite') requires deps.sqlite");
      return new SqliteDidStorageDriver(deps.sqlite as SqliteStore);
    case 'memory':
      return new InMemoryDidStorageDriver();
    default: {
      // Exhaustiveness check: if StorageDriverKind gains a member without a
      // corresponding case above, this line fails to compile.
      const _exhaustive: never = kind;
      throw new UnsupportedStorageDriverError('DidRepository', _exhaustive);
    }
  }
}
