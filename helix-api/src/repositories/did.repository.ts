import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

export interface DIDRecord {
  id: string;
  subjectType: string;
  controller: string;
  publicKey: string;
  publicKeyMultibase: string | null;
  hederaTopicId: string | null;
  hederaSequenceNumber: number | null;
  hederaTransactionId: string;
  didDocument: unknown;
  deactivatedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateDIDRecordParams {
  id: string;
  subjectType: string;
  controller: string;
  publicKey: string;
  publicKeyMultibase?: string | undefined;
  hederaTransactionId: string;
  hederaTopicId?: string | undefined;
  hederaSequenceNumber?: number | undefined;
  didDocument: unknown;
}

interface DIDUpdateParams {
  updateType: string;
  hederaTransactionId: string;
  payload: unknown;
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

export class DidRepository {
  private readonly dids = new Map<string, DIDRecord>();

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  private get db(): PrismaLike {
    return this.prisma as PrismaLike;
  }

  async createDid(data: CreateDIDRecordParams): Promise<DIDRecord> {
    if (this.prisma) {
      return this.db.did.create({
        data: {
          ...data,
          publicKeyMultibase: data.publicKeyMultibase ?? null,
        },
      });
    }

    if (this.sqlite) {
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
    if (this.prisma) {
      return this.db.did.findUnique({
        where: { id },
        include: { updates: true },
      });
    }

    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteDidRow>(`
        SELECT * FROM dids WHERE id = ${sqliteLiteral(id)} LIMIT 1
      `);
      return fromSqliteRow(rows[0]);
    }

    return this.dids.get(id) ?? null;
  }

  async findDidByPublicKey(publicKey: string): Promise<DIDRecord | null> {
    if (this.prisma) {
      return this.db.did.findFirst({
        where: { publicKey },
      });
    }

    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteDidRow>(`
        SELECT * FROM dids WHERE public_key = ${sqliteLiteral(publicKey)} LIMIT 1
      `);
      return fromSqliteRow(rows[0]);
    }

    for (const did of this.dids.values()) {
      if (did.publicKey === publicKey) return did;
    }
    return null;
  }

  async updateDidDocument(
    id: string,
    didDocument: unknown,
    update: DIDUpdateParams,
  ): Promise<unknown> {
    if (this.prisma) {
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

    if (this.sqlite) {
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

    const existing = this.dids.get(id);
    if (!existing) throw new Error('DID not found');
    const next: DIDRecord = {
      ...existing,
      didDocument,
      updatedAt: new Date(),
    };
    this.dids.set(id, next);
    return [next, { ...update, didId: id }];
  }

  async deactivateDid(id: string, deactivatedAt: Date): Promise<DIDRecord> {
    if (this.prisma) {
      return this.db.did.update({
        where: { id },
        data: { deactivatedAt },
      });
    }

    if (this.sqlite) {
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

    const existing = this.dids.get(id);
    if (!existing) throw new Error('DID not found');
    const next: DIDRecord = {
      ...existing,
      deactivatedAt,
      updatedAt: new Date(),
    };
    this.dids.set(id, next);
    return next;
  }

  // Back-compat aliases for older B3/B4 scaffolding.
  async create(data: CreateDIDRecordParams): Promise<DIDRecord> {
    return this.createDid(data);
  }

  async findByDid(did: string): Promise<DIDRecord | null> {
    return this.findDidById(did);
  }

  async findByPublicKeyMultibase(publicKeyMultibase: string): Promise<DIDRecord | null> {
    if (this.prisma) {
      return this.db.did.findFirst({ where: { publicKeyMultibase } });
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteDidRow>(`
        SELECT * FROM dids WHERE public_key_multibase = ${sqliteLiteral(publicKeyMultibase)} LIMIT 1
      `);
      return fromSqliteRow(rows[0]);
    }
    for (const did of this.dids.values()) {
      if (did.publicKeyMultibase === publicKeyMultibase) return did;
    }
    return null;
  }
}

export { DidRepository as DIDRepository };
