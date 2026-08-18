import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { expect, test as setup } from '@playwright/test';

const STATE_PATH = 'tests/nl-ui/.auth/state.json';

/**
 * Gets one browser past the beta gate, once, and freezes the result.
 *
 * The gate (src/middleware.ts) 307s every path except /beta to /beta
 * when AFLDB_BETA_GATE=on, which dev has on. Redeeming per test is not
 * an option even if it were tidy: /beta's redeem action is IP rate
 * limited (REDEEM_LIMIT in src/app/beta/actions.ts), so 12,000
 * redemptions from one workstation would lock the runner out within
 * seconds. One redemption, saved to storageState, is also the honest
 * shape of the thing being tested -- a reader is admitted once and then
 * browses.
 *
 * The beta cookie carries a 90-day TTL (BETA_TTL_SECONDS), so the saved
 * state outlives any run comfortably; it is invalidated by revoking the
 * code or bumping the beta epoch, both of which should re-run setup.
 */
setup('admitted past the beta gate, analytics declined', async ({ page, context, baseURL }) => {
  const code = process.env.AFLDB_E2E_BETA_CODE;
  expect(
    code,
    'AFLDB_E2E_BETA_CODE is not set. The dev deployment runs with '
    + 'AFLDB_BETA_GATE=on, so the sweep needs an unrevoked access code — '
    + 'ideally an unlimited one (the "Unlimited" checkbox on /admin/access), '
    + 'since single-use codes burn on the first run and every later run then '
    + 'fails with the same generic "not accepted" a wrong code gets.',
  ).toBeTruthy();

  /**
   * Declined, explicitly, before the first page load.
   *
   * Consent gates `nl_sid` (src/lib/consent.ts), the anonymous
   * correlation cookie that ties several searches into one "visit". A
   * sweep that accepted would stamp 12,000 unrelated questions with a
   * handful of session ids and quietly poison the reformulation
   * telemetry the log exists to produce. Declining is also fail-closed
   * here: middleware deletes an existing nl_sid on every request without
   * consent, so the sweep cannot leak one from a previous run.
   *
   * It has the useful side effect of settling the consent banner, which
   * would otherwise be an overlay on the first load of every worker.
   */
  const origin = new URL(baseURL ?? 'http://10.0.40.100:8090');
  await context.addCookies([{
    name: 'afldb_consent',
    value: 'declined',
    domain: origin.hostname,
    path: '/',
    httpOnly: false,
    secure: origin.protocol === 'https:',
    sameSite: 'Lax',
  }]);

  await page.goto('/beta');
  // Scoped to the form that owns the code field: /beta carries three
  // forms (code, magic link, join request) and two of them are email.
  const codeForm = page.locator('form', { has: page.locator('input[name="code"]') });
  await codeForm.locator('input[name="code"]').fill(code!);
  await codeForm.getByRole('button', { name: 'Enter' }).click();

  /**
   * Wait for the gate to actually let go before navigating anywhere.
   *
   * redeemAccessCode is a server action that sets the cookie and then
   * redirects (src/app/beta/actions.ts). Going straight to /search after
   * the click races that round trip: the navigation cancels the in-flight
   * action, no cookie is ever stored, and the run then fails at the gate
   * with a message that reads exactly like a rejected code. Leaving /beta
   * is the observable signal that the cookie landed.
   */
  await page.waitForURL((url) => !url.pathname.startsWith('/beta'), { timeout: 15_000 })
    .catch(async () => {
      const alerts = (await page.locator('[role="alert"]').allTextContents()).join(' ').trim();
      throw new Error(
        'The beta code was not accepted by this deployment'
        + (alerts ? `: ${alerts}` : '.')
        + ' Codes are per-host — dev and production keep separate beta_access_codes'
        + ' tables, and a production code is refused here with the same generic'
        + ' message a wrong code gets. Check the code was cut on this host, is'
        + ' unrevoked, unexpired, and has uses left.',
      );
    });

  /**
   * Asserting on /search rather than on the redirect: the redirect only
   * proves the form posted, while a rendered search page proves the
   * cookie the sweep will actually reuse is accepted by middleware. A
   * wrong or spent code lands back on /beta, and this is where that is
   * caught -- before 12,000 questions each quietly redirect to the gate
   * and get scored as `absent`.
   */
  await page.goto('/search?q=Dustin+Martin+most+goals+against+Carlton');
  await expect(page).toHaveURL(/\/search/);
  await expect(
    page.getByText('Did AFLDB understand this question?'),
    'Admitted, but /search rendered no NL answer panel for a question known to '
    + 'have one. Check the deployment is current and its database is populated.',
  ).toBeVisible();

  mkdirSync(dirname(STATE_PATH), { recursive: true });
  await context.storageState({ path: STATE_PATH });
});
