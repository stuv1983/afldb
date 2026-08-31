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
    // AFLDB-ISSUE-108: every integration suite shares the one mutable afldb_test.
    // Under file parallelism one suite's fixture mutations (a transient season,
    // in-flight draft links, moving canonical counts) are observed by another
    // suite's assertions — the 3 failures that appear only in parallel and vanish
    // under --no-file-parallelism. The guarded database gate must be serial, so it
    // is the default here rather than a flag to remember. DB-free suites pay a
    // small wall-clock cost for a deterministic gate.
    fileParallelism: false,
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
