// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development'),
  },
  server: {
    // Local dev only: with VITE_API_BASE_URL unset the SDK issues relative
    // /v1 requests, proxied here to a local helix-api (which has no CORS
    // handling). Containers use the runtime-injected API_BASE_URL instead.
    proxy: {
      '/v1': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      // Same thresholds helix-api enforces (dev spec §7: match the
      // existing repos, don't invent a new number).
      thresholds: {
        lines: 90,
        statements: 90,
        branches: 85,
        functions: 90,
      },
      exclude: [
        // Pure wiring/layout with no logic (dev spec §7: untested).
        'src/main.tsx',
        'src/api/types.ts',
      ],
    },
  },
}));
