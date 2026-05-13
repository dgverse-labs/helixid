import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Shared Prisma 7 client using PrismaPg adapter
const connectionString = process.env.DATABASE_URL || 'postgresql://helixid_test:helixid_test@localhost:5432/helixid_test';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
