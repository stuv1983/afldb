import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests hit the real afldb_test database on the dev
    // server; the first connection can be slower than the default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // src modules guard themselves with `server-only`, which throws
      // outside a React Server Component. Tests exercise the query SQL
      // directly, so the guard is stubbed here.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
