import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

export function createTestPrisma(): PrismaClient {
  const adapter = new PrismaPg(new Pool({ connectionString: process.env['DATABASE_URL'] }));
  return new PrismaClient({ adapter });
}
