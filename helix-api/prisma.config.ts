import { defineConfig } from '@prisma/config';

// Prisma v7 configuration — datasource and generator settings live here.
// Schema models live in prisma/schema.prisma.
// See: https://www.prisma.io/docs/orm/prisma-schema/overview/prisma-config
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://helixid_test:helixid_test@localhost:5432/helixid_test',
  },
});

