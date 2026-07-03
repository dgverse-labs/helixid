// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const require = createRequire(import.meta.url);

export default defineConfig({
  // @helixid/sdk-js (via @helixid/core) imports node:crypto/zlib/fs; the
  // Console only exercises the HTTP client paths, but the imports must
  // still resolve in a browser bundle.
  // 'module' is excluded so the node:module alias below wins over the
  // plugin's empty mock (which lacks createRequire).
  plugins: [react(), nodePolyfills({ exclude: ['module'] })],
  resolve: {
    // The plugin injects shim imports into the linked workspace packages
    // (helix-sdk-js/dist), where pnpm's isolated node_modules can't resolve
    // them — alias them to absolute paths.
    alias: {
      // The plugin's fs mock cannot resolve the node:fs/promises subpath
      // import in the SDK's AgentWallet (unused by the Console).
      'node:fs/promises': new URL('./shims/fs-promises.ts', import.meta.url).pathname,
      // The plugin's node:module mock lacks createRequire; @helixid/core
      // guards the call with try/catch, so a throwing shim is safe.
      'node:module': new URL('./shims/module.ts', import.meta.url).pathname,
      'vite-plugin-node-polyfills/shims/buffer': require.resolve(
        'vite-plugin-node-polyfills/shims/buffer',
      ),
      'vite-plugin-node-polyfills/shims/global': require.resolve(
        'vite-plugin-node-polyfills/shims/global',
      ),
      'vite-plugin-node-polyfills/shims/process': require.resolve(
        'vite-plugin-node-polyfills/shims/process',
      ),
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
});
