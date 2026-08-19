import { defineConfig, devices } from '@playwright/test';

/**
 * Admin/Super Admin navigation diagnostic — a SEPARATE harness from the
 * 12k NL sweep (playwright.nl-stress.config.ts), deliberately: this is a
 * timing instrument, not a load generator. One worker, sequential
 * clicks, because the symptom under investigation is interactive
 * ("I clicked a nav link and nothing seemed to happen"), and parallel
 * load would confound the per-click timings it exists to capture.
 *
 *   AFLDB_E2E_BASE_URL            deployment under test (default: dev)
 *   AFLDB_E2E_ADMIN_EMAIL         admin account email
 *   AFLDB_E2E_ADMIN_PASSWORD      admin account password
 *   AFLDB_E2E_ADMIN_TOTP_SECRET   base32 TOTP secret for that account
 */
const baseURL = process.env.AFLDB_E2E_BASE_URL ?? 'http://10.0.40.100:8090';

export default defineConfig({
  testDir: './tests/admin-nav',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  reporter: [['list']],
  use: {
    baseURL,
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
      name: 'admin-nav',
      testMatch: /admin-nav\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/admin-nav/.auth/state.json',
      },
    },
  ],
});
