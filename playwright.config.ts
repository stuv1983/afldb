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

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
