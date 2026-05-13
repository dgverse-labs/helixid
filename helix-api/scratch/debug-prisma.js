import { PrismaClient } from '@prisma/client';
console.log('PrismaClient:', typeof PrismaClient);
try {
  const p = new PrismaClient();
  console.log('Successfully instantiated PrismaClient');
} catch (err) {
  console.error('Failed to instantiate PrismaClient:', err);
}
