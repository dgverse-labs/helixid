// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 95,
        statements: 95,
        branches: 90,
        functions: 100,
      },
      exclude: [
        'src/index.ts',
        'src/server.ts',
        'src/prisma.ts',
        'src/loadEnv.ts',
        'src/**/index.ts',
        'src/hedera/mock/**',
        'src/hedera/IHederaClient.ts',
        'src/repositories/index.ts',
        'src/services/agent/index.ts',
        'src/services/did/index.ts',
        'src/services/vc/index.ts',
        'src/services/vp/index.ts',
        'src/audit/index.ts',
        'src/middleware/index.ts',
        'src/services/vc/IVCService.ts',
        'src/services/vp/IVPService.ts',
        'src/services/agent/IAgentService.ts',
        'src/services/did/IDIDService.ts',
        'vitest.config.ts',
        'tests/**', // Explicitly exclude tests folder
      ],
    },
  },
});
