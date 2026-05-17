import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const modelNames = Object.keys(prisma).filter((key) => !key.startsWith('_') && !key.startsWith('$'));
process.stdout.write(`${JSON.stringify(modelNames, null, 2)}\n`);

await prisma.$disconnect();
