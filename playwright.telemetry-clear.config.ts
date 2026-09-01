import { defineConfig, devices } from '@playwright/test';

import { assertDisposableTestTarget } from './tests/admin-nl-search-clear/target-guard';

/**
 * AFLDB-ISSUE-119 telemetry-clear acceptance harness. A SEPARATE config,
 * like playwright.admin-nav.config.ts and playwright.nl-stress.config.ts:
 * this one drives a real, irreversible clear against a disposable
 * loopback _test deployment and must never be folded into
 * `npm run test:e2e`. Run it explicitly:
 *
 *   npx playwright test --config playwright.telemetry-clear.config.ts
 *
 * Required environment — every one is a hard failure if absent; there is
 * no default target and no implicit fallback anywhere:
 *
 *   AFLDB_E2E_BASE_URL                 loopback origin only, e.g. http://127.0.0.1:3400
 *                                     (127.0.0.1 / localhost / ::1; 10.0.40.100 and any
 *                                      remote host are refused)
 *   AFLDB_E2E_TELEMETRY_CLEAR_CONFIRM  the exact _test database name — the destructive
 *                                     acknowledgement, pinned to that name by seed.ts
 *   AFLDB_TEST_DATABASE_URL            owner DSN for that same _test database (seed.ts);
 *                                     must end in _test, never afldb_dev/production
 *   AFLDB_E2E_ADMIN_{EMAIL,PASSWORD,TOTP_SECRET}        a real super_admin
 *   AFLDB_E2E_PLAIN_ADMIN_{EMAIL,PASSWORD,TOTP_SECRET}  a real NON-super admin
 *
 * There is deliberately no webServer block: the deployment under test is
 * provisioned by the operator (a standalone build of this branch bound to
 * loopback, its DATABASE_URL/AFLDB_AUTH_DATABASE_URL pointed at the _test
 * database, AFLDB_BETA_GATE=off), never started by the runner.
 */

// Load-bearing: throws here, at config load, unless the target is a
// disposable loopback _test deployment with the destructive run
// acknowledged. Nothing downstream gets a chance to run otherwise.
const { baseURL } = assertDisposableTestTarget();

export default defineConfig({
  testDir: './tests/admin-nl-search-clear',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  expect: { timeout: 10_000 },
  globalTimeout: 30 * 60_000,
  reporter: [['list']],
  use: {
    baseURL,
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'clear',
      testMatch: /telemetry-clear\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
