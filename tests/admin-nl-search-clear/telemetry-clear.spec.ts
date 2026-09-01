import { expect, test, type Locator, type Page } from '@playwright/test';

import * as seed from './seed';
import { assertDisposableTestTarget } from './target-guard';

/**
 * AFLDB-ISSUE-119 â€” Stage 2 acceptance: the Super Admin telemetry-clear
 * control on /admin/nl-search, driven end to end in a real browser
 * against a disposable loopback _test deployment.
 *
 * Covers the runbook Â§13 "UI" flows and Â§16 criterion 10's UI half:
 *   1. the target really is the disposable _test deployment;
 *   2. reveal â†’ cancel collapses, sends nothing, mutates nothing;
 *   3. submit is gated on the exact phrase, client-side;
 *   4. a real clear deletes only disposable rows and reports five counts;
 *   5. reviews and feedback are retained, and the panel says so;
 *   6. a plain admin is redirected and never sees the control;
 *   7. an unauthenticated visitor is bounced to /admin/login.
 *
 * SAFETY. This is the only test in the repo that runs the clear for real.
 * target-guard.ts (imported by the config, this file, auth.setup.ts and
 * seed.ts) refuses to proceed unless AFLDB_E2E_BASE_URL is loopback,
 * AFLDB_TEST_DATABASE_URL ends in _test and is not afldb_dev/production,
 * and AFLDB_E2E_TELEMETRY_CLEAR_CONFIRM equals that exact database name.
 * seed.reseed() wipes and rebuilds the NL telemetry tables, so a
 * successful destructive run is only repeatable after another reseed â€”
 * which every destructive test below performs itself.
 */

const { baseURL } = assertDisposableTestTarget();

const SUPER_STATE = 'tests/admin-nl-search-clear/.auth/super.json';
const PLAIN_STATE = 'tests/admin-nl-search-clear/.auth/plain.json';

const PHRASE = 'CLEAR SEARCH TELEMETRY';
// days=7 is a valid NL_LOG_PERIODS value; a marker row stamped now() is
// comfortably inside it.
const EXPORT_PATH = '/admin/nl-search/export?dataset=searches&days=7';

/**
 * The collapsed reveal button. Anchored so it can never also match the
 * "Yes, clear search telemetry" submit button or the "Clearingâ€¦" pending
 * label â€” a plain substring match would.
 */
function revealButton(page: Page): Locator {
  return page.getByRole('button', { name: /clear search telemetry/i });
}

function submitButton(page: Page): Locator {
  return page.getByRole('button', { name: /^yes, clear search telemetry$/i });
}

function confirmInput(page: Page): Locator {
  return page.locator('input[name="confirmation"]');
}

test.afterAll(async () => {
  await seed.close();
});

test.describe('the target is the disposable _test deployment', () => {
  test.use({ storageState: SUPER_STATE });

  test('the deployment under test reads the same _test database the seed writes', async ({ page }) => {
    // The config and target-guard already enforced loopback + the _test
    // acknowledgement; restate the host check here so this file documents
    // its own safety boundary rather than relying on an import side effect.
    expect(new URL(baseURL).hostname).toMatch(/^(127\.0\.0\.1|localhost|::1|\[::1\])$/);

    const marker = await seed.plantTargetMarker();
    try {
      const res = await page.request.get(EXPORT_PATH);
      expect(res.ok(), `super-admin export request failed with ${res.status()}`).toBeTruthy();
      const body = await res.text();
      expect(
        body.includes(marker),
        'the seeded marker row is not visible through the deployment\'s own '
        + 'super-admin export â€” the deployment is NOT reading the seeded _test '
        + 'database, so the destructive tests must not run against it',
      ).toBeTruthy();
    } finally {
      await seed.removeTargetMarker();
    }
  });
});

test.describe('reveal, cancel and phrase gating (no mutation)', () => {
  test.use({ storageState: SUPER_STATE });

  test('reveal then cancel collapses the panel, sends no action, changes nothing', async ({ page }) => {
    const { counts: seeded } = await seed.reseed();

    // Only Server Action POSTs to the page route matter here; the
    // client's health-event beacon is a different concern.
    const actionPosts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname.startsWith('/admin/nl-search')) {
        actionPosts.push(r.url());
      }
    });

    await page.goto('/admin/nl-search');
    await expect(revealButton(page)).toBeVisible();

    await revealButton(page).click();
    await expect(confirmInput(page)).toBeVisible();
    await expect(page.getByText('Permanently deletes disposable')).toBeVisible();
    await expect(submitButton(page)).toBeDisabled();

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmInput(page)).toHaveCount(0);
    await expect(revealButton(page)).toBeVisible();

    // Give any stray request a beat to surface, then prove none did and
    // the database is byte-for-byte the seeded state.
    await page.waitForTimeout(500);
    expect(actionPosts, `unexpected action POST(s): ${actionPosts.join(', ')}`).toEqual([]);
    expect(await seed.readCounts()).toEqual(seeded);
  });

  test('the submit button stays disabled until the exact phrase is typed', async ({ page }) => {
    await seed.reseed();
    await page.goto('/admin/nl-search');
    await revealButton(page).click();

    const submit = submitButton(page);
    const input = confirmInput(page);

    await expect(submit).toBeDisabled();
    await input.fill('CLEAR SEARCH');
    await expect(submit).toBeDisabled();
    await input.fill('clear search telemetry'); // wrong case
    await expect(submit).toBeDisabled();
    await input.fill(`${PHRASE} `); // trailing space
    await expect(submit).toBeDisabled();
    await input.fill(PHRASE); // exact
    await expect(submit).toBeEnabled();
    await input.fill(PHRASE.slice(0, -1)); // one character short
    await expect(submit).toBeDisabled();
  });
});

test.describe('successful clear (DESTRUCTIVE â€” reseeds every run)', () => {
  test.use({ storageState: SUPER_STATE });

  test('clears only disposable rows, retains reviews and feedback, reports five counts', async ({ page }) => {
    const { ids } = await seed.reseed();

    await page.goto('/admin/nl-search');
    await revealButton(page).click();
    await confirmInput(page).fill(PHRASE);
    await expect(submitButton(page)).toBeEnabled();
    await submitButton(page).click();

    // The action opens a real transaction (locks, recursive closure,
    // delete, audit); allow a wide margin for the committed result.
    await expect(
      page.getByText('Cleared 5 disposable search log rows.'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('6 log rows retained, alongside every review and feedback row.'),
    ).toBeVisible();
    await expect(page.getByText('Retained: 1 review, 2 feedback rows.')).toBeVisible();
    await expect(page.getByText('1 app-health link detached from cleared rows.')).toBeVisible();

    // On committed success the panel collapses back to the reveal button.
    await expect(revealButton(page)).toBeVisible();
    await expect(confirmInput(page)).toHaveCount(0);

    // DB-side proof via the owner connection: exactly the disposable rows
    // are gone, every retained id survives, and the durable tables are
    // untouched. Numbers cross-reference seed.EXPECTED.
    expect(await seed.survivingLogIds(ids.disposable)).toEqual([]);
    expect(await seed.survivingLogIds(ids.retained)).toEqual(ids.retained);
    expect(await seed.readCounts()).toEqual({
      logs: 6,
      reviews: 1,
      feedback: 2,
      healthRows: 3,
      attachedLinks: 1,
    });
  });
});

test.describe('Super Admin only', () => {
  test.describe('a plain admin', () => {
    test.use({ storageState: PLAIN_STATE });

    test('is redirected from /admin/nl-search and never sees the control', async ({ page }) => {
      await page.goto('/admin/nl-search');

      await expect(
        page.getByRole('heading', { name: 'Administration' }),
      ).toBeVisible();

      await expect(
        page.getByRole('heading', { name: 'Natural-language search' }),
      ).not.toBeVisible();

      await expect(revealButton(page)).toHaveCount(0);
    });

    test('cannot drive the nl-search export route either', async ({ page }) => {
      const res = await page.request.get(EXPORT_PATH, { maxRedirects: 0 });
      expect(res.status(), `expected a redirect, got ${res.status()}`).toBeGreaterThanOrEqual(300);
      expect(res.status()).toBeLessThan(400);
    });
  });

  test.describe('an unauthenticated visitor', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('is bounced to /admin/login and never sees the control', async ({ page }) => {
      await page.goto('/admin/nl-search');
      await expect(page).toHaveURL(/\/admin\/login/);
      await expect(revealButton(page)).toHaveCount(0);
    });
  });
});

