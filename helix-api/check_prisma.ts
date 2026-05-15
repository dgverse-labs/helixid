import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
console.log(Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$')));
await prisma.$disconnect();
