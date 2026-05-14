/**
 * helix-api/src/repositories/did.repository.ts
 *
 * Repository layer for DID records.
 * Prisma queries only — no business logic (DB-4).
 */

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Did, type DidUpdate } from '@prisma/client';

export type { Did, DidUpdate };

const connectionString =
  process.env.DATABASE_URL || 'postgresql://helixid_test:helixid_test@localhost:5432/helixid_test';

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

export interface CreateDidData {
  did: string;
  subjectType: string;
  publicKeyHex: string;
  publicKeyMultibase: string;
  hederaTopicId: string;
  hederaSequenceNumber: number;
  hederaTransactionId: string;
  didDocumentJson: string;
}

export interface CreateDidUpdateData {
  didId: string;
  updateType: string;
  updatePayloadJson: string;
  hederaTransactionId: string;
}

export class DIDRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(data: CreateDidData): Promise<Did> {
    return this.db.did.create({ data });
  }

  async findByDid(did: string): Promise<Did | null> {
    return this.db.did.findUnique({ where: { did } });
  }

  async findByPublicKeyMultibase(multibase: string): Promise<Did | null> {
    return this.db.did.findFirst({ where: { publicKeyMultibase: multibase } });
  }

  async updateDIDDocument(
    did: string,
    didDocumentJson: string,
    hederaTransactionId: string,
  ): Promise<Did> {
    return this.db.did.update({
      where: { did },
      data: { didDocumentJson, hederaTransactionId, updatedAt: new Date() },
    });
  }

  async deactivate(did: string): Promise<Did> {
    return this.db.did.update({
      where: { did },
      data: { deactivated: true, deactivatedAt: new Date() },
    });
  }

  async createDidUpdate(data: CreateDidUpdateData): Promise<DidUpdate> {
    return this.db.didUpdate.create({ data });
  }

  async getDidUpdates(did: string): Promise<DidUpdate[]> {
    const record = await this.db.did.findUnique({
      where: { did },
      include: { didUpdates: { orderBy: { createdAt: 'asc' } } },
    });
    return record?.didUpdates ?? [];
  }
}
