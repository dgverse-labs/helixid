import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL || 'postgresql://helixid_test:helixid_test@localhost:5432/helixid_test';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

export interface VpIdRecord {
  vpId: string;
  agentDid: string;
  userDid: string;
  targetService: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

type UpdateManyResult = {
  count: number;
};

export class VPRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

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
    return this.db.vpId.findUnique({
      where: { vpId },
    });
  }

  async consumeAtomically(vpId: string): Promise<boolean> {
    try {
      const result = await this.db.vpId.updateMany({
        where: {
          vpId,
          consumedAt: null,
        },
        data: {
          consumedAt: new Date(),
        },
      });
      return (result as UpdateManyResult).count > 0;
    } catch {
      return false;
    }
  }
}
