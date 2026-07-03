// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const require = createRequire(import.meta.url);

// node-stdlib-browser is vite-plugin-node-polyfills' own dependency; its
// esbuild shim provides module-scope global/process/Buffer to pre-bundled
// deps in dev (see below).
const esbuildShim = require.resolve('node-stdlib-browser/helpers/esbuild/shim', {
  paths: [dirname(require.resolve('vite-plugin-node-polyfills/shims/buffer'))],
});

// @helixid/sdk-js (via @helixid/core) imports node:crypto/zlib/fs; the
// Console only exercises the HTTP client paths, but the imports must still
// resolve in a browser bundle, and crypto-browserify's modules read
// global/process at module scope.
//
// The polyfill plugin handles all of that for `vite build`. In dev its
// globals banners are broken: each banner imports its own shim into every
// pre-bundled dep chunk — including the chunk defining that shim — which
// throws "Cannot access ... before initialization". So in dev the banners
// are disabled and the same globals come from esbuild's inject mechanism
// during dependency pre-bundling instead.
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    nodePolyfills({
      // Excluded so the node:module alias below wins over the plugin's
      // empty mock (which lacks createRequire).
      exclude: ['module'],
      ...(command === 'build'
        ? {}
        : { globals: { Buffer: false, global: false, process: false } }),
    }),
  ],
  optimizeDeps: {
    esbuildOptions: {
      inject: [esbuildShim],
      define: {
        global: 'global',
        process: 'process',
        Buffer: 'Buffer',
      },
    },
  },
  server: {
    // Local dev only: with VITE_API_BASE_URL unset the SDK issues relative
    // /v1 requests, proxied here to a local helix-api (which has no CORS
    // handling). Containers use the runtime-injected API_BASE_URL instead.
    proxy: {
      '/v1': 'http://localhost:3400',
    },
  },
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
}));
