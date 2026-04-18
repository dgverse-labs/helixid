import { defineConfig } from 'prisma/config';

// Prisma v7 configuration — datasource and generator settings live here.
// Schema models live in prisma/schema.prisma.
// See: https://www.prisma.io/docs/orm/prisma-schema/overview/prisma-config
export default defineConfig({
  earlyAccess: true,
  schema: './prisma/schema.prisma',
});
