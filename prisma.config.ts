// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0
import 'dotenv/config';
import { defineConfig } from '@prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://helixid_test:helixid_test@localhost:5432/helixid_test',
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
