// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 95,
        statements: 95,
        branches: 85,
        functions: 95,
      },
      exclude: [
        'src/index.ts',
        'src/**/index.ts',
        'src/audit/index.ts',
        'src/resolver/IDidResolver.ts',
        'src/resolver/types.ts',
        'vitest.config.ts',
        'tests/**', // Explicitly exclude tests folder
      ],
    },
  },
});
