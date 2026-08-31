import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.AFLDB_E2E_BASE_URL ?? 'http://127.0.0.1:3100';

/**
 * E2E runs against the production build on the dev server, not `next dev`.
 * A feature that only works in development is not deployment-ready.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalTimeout: 30 * 60_000,

  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  /**
   * Start the server rather than testing whatever happens to be on 3100.
   *
   * Without this the suite silently ran against a stale process still
   * bound to the port, reporting failures for code that had already been
   * fixed. `reuseExistingServer: false` makes a leftover server an
   * immediate, loud EADDRINUSE instead of a misleading test result —
   * clear it with `fuser -k 3100/tcp`.
   *
   * Skipped when pointing at an external deployment.
   */
  webServer: process.env.AFLDB_E2E_BASE_URL ? undefined : {
    command: 'node .next/standalone/server.js',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
