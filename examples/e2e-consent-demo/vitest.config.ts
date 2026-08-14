import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The 5-step flow drives two real HTTP servers end to end.
    testTimeout: 30_000,
  },
});
