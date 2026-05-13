import { PrismaClient } from '@prisma/client';
console.log('PrismaClient constructor:', PrismaClient.toString());
const prisma = new PrismaClient();
console.log('Instance created');
