import { defineConfig, devices } from '@playwright/test';

/**
 * The 12,000-question NL UI sweep. A SEPARATE config from
 * playwright.config.ts, deliberately.
 *
 * Keeping it out of `npm run test:e2e` is the whole point: this run is
 * ~12,000 page loads against a live deployment, takes the better part of
 * an hour, and writes a row to nl_search_log for every one of them. That
 * is not something the ordinary e2e suite should do on every invocation.
 * Its tests live in tests/nl-ui/ rather than tests/e2e/ so the default
 * config cannot pick them up by accident.
 *
 * One project, not two. playwright.config.ts runs desktop + mobile
 * because layout is the thing under test there. Here the thing under
 * test is the server-rendered answer panel, which is byte-identical
 * across viewports -- a mobile project would double a 12,000-load run to
 * buy nothing.
 *
 * There is no webServer block. This always runs against a deployment
 * (dev, by default), never against a build started by the test runner:
 * the corpus needs a populated database, which a local standalone server
 * has no way to bring with it.
 */
const baseURL = process.env.AFLDB_E2E_BASE_URL ?? 'http://10.0.40.100:8090';

export default defineConfig({
  testDir: './tests/nl-ui',
  /**
   * Required, not cosmetic. The sweep is one spec file, and without this
   * Playwright keeps a file on a single worker -- so `workers` below is
   * silently ignored and 12,000 questions run one at a time. Batches
   * share no state (each appends to its own worker's file), so there is
   * nothing to serialise for.
   */
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  globalSetup: './tests/nl-ui/global-setup.ts',

  /**
   * No retries. A retry here would re-run a 100-question batch to
   * re-observe a flake, and the report is built from observations rather
   * than from pass/fail -- a silently re-run batch would write its
   * results twice. Timeouts are recorded as `page_error` and reported,
   * which is the honest outcome for a question that did not render.
   */
  retries: 0,

  /**
   * Per-BATCH, not per-question. The spec shards the corpus into batches
   * and drives each question inside one; NL_UI_TIMEOUT_MS bounds the
   * individual navigation.
   */
  timeout: 30 * 60_000,

  reporter: [['list'], ['json', { outputFile: 'nl-ui-out/playwright.json' }]],

  /**
   * Modest by default. Every worker is a browser AND a concurrent
   * server-rendered search against dev's PostgreSQL, so this is really a
   * database concurrency setting wearing a browser costume. Raise it
   * with NL_UI_WORKERS once you have watched the dev box handle the
   * lower number.
   */
  workers: Number(process.env.NL_UI_WORKERS ?? 4),

  use: {
    baseURL,
    /**
     * Traces and screenshots are off. At 12,000 navigations
     * `retain-on-failure` can still write thousands of traces if the
     * deployment is badly broken, which fills the disk during exactly
     * the run you most want to finish. The JSONL report names every
     * failing question; re-run one by hand to get a trace.
     */
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
      name: 'nl-stress',
      testMatch: /nl-stress\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        /**
         * Set on this project alone, never in the top-level `use`.
         * Playwright merges config into every project and treats an
         * explicit `storageState: undefined` as "unspecified" rather
         * than as an override, so a top-level value would also apply to
         * `setup` -- which runs before the file exists and dies on ENOENT.
         */
        storageState: 'tests/nl-ui/.auth/state.json',
        /**
         * The answer panel is entirely server-rendered, so NL_UI_FAST=1
         * turns JavaScript off and drops a large constant from every one
         * of 12,000 loads. It costs the console-error and hydration
         * signal, which is a real part of what a UI sweep buys over the
         * plan-level harness -- so it is opt-in, not the default.
         */
        javaScriptEnabled: process.env.NL_UI_FAST !== '1',
      },
    },
  ],
});
