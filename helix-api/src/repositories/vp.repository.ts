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

export class VPRepository {
  async create(data: Omit<VpIdRecord, 'consumedAt'>): Promise<VpIdRecord> {
    return prisma.vpId.create({
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
    return prisma.vpId.findUnique({
      where: { vpId },
    });
  }

  async consumeAtomically(vpId: string): Promise<boolean> {
    try {
      const result = await prisma.vpId.updateMany({
        where: {
          vpId,
          consumedAt: null,
        },
        data: {
          consumedAt: new Date(),
        },
      });
      return result.count > 0;
    } catch {
      return false;
    }
  }
}
