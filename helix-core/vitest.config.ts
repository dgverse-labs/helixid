// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
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
        'src/audit/IAuditLogger.ts',
        'src/audit/index.ts',
        'src/crypto/index.ts',
        'src/errors/index.ts',
        'src/schemas/index.ts',
        'src/status-list/index.ts',
      ],
    },
  },
});
