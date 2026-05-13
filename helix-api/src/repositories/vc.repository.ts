import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL || 'postgresql://helixid_test:helixid_test@localhost:5432/helixid_test';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export interface VCRecord {
  id: string;
  vcId: string;
  subjectDid: string;
  issuerDid: string;
  type: string;
  status: string;
  vcJson: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class VCRepository {
  async createVC(data: Omit<VCRecord, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<VCRecord> {
    return prisma.verifiableCredential.create({
      data: {
        ...data,
        status: 'active'
      }
    });
  }

  async findByVcId(vcId: string): Promise<VCRecord | null> {
    return prisma.verifiableCredential.findUnique({
      where: { vcId }
    });
  }

  async findActiveBySubjectDid(subjectDid: string, vcType?: string): Promise<VCRecord[]> {
    const vcs = await prisma.verifiableCredential.findMany({
      where: {
        subjectDid,
        status: 'active',
        expiresAt: { gt: new Date() }
      }
    });

    if (!vcType) return vcs;

    return vcs.filter(vc => {
      try {
        const types = vc.type.split(',');
        return types.includes(vcType);
      } catch {
        return false;
      }
    });
  }

  async updateStatus(vcId: string, status: string): Promise<VCRecord> {
    return prisma.verifiableCredential.update({
      where: { vcId },
      data: { status }
    });
  }
}
