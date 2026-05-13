import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL || 'postgresql://helixid_test:helixid_test@localhost:5432/helixid_test';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export interface DidRecord {
  id: string;
  did: string;
  publicKeyHex: string;
  subjectType: string;
  hederaTransactionId: string | null;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class DIDRepository {
  async createDID(data: Omit<DidRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<DidRecord> {
    return prisma.did.create({
      data
    });
  }

  async findByDid(did: string): Promise<DidRecord | null> {
    return prisma.did.findUnique({
      where: { did }
    });
  }

  async updateMetadata(did: string, metadata: string): Promise<DidRecord> {
    return prisma.did.update({
      where: { did },
      data: { metadata }
    });
  }
}
