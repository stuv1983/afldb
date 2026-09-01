import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { expect, test as setup, type Page } from '@playwright/test';

import { totpCode } from '../admin-nav/totp';
import { assertDisposableTestTarget } from './target-guard';

/**
 * AFLDB-ISSUE-119 — real authenticated sessions for the telemetry-clear
 * acceptance harness.
 *
 * Two accounts, two saved storage states:
 *
 *   super.json  a real super_admin — drives the clear, sees the control.
 *   plain.json  a real NON-super admin — used only to prove it is bounced
 *               from /admin/nl-search and never sees the control.
 *
 * Both sign in through the real /admin/login form with a freshly computed
 * TOTP code (../admin-nav/totp.ts — the helper the admin-nav diagnostic
 * uses). Nothing in the auth path is bypassed or weakened; credentials
 * arrive only via environment variables.
 *
 * The unauthenticated case in the spec needs no setup: it runs in a clean
 * browser context with no storage state.
 *
 * Operator prerequisites before this can pass:
 *   - a disposable loopback _test deployment (AFLDB_E2E_BASE_URL), with
 *     AFLDB_BETA_GATE=off so /admin/* is reachable;
 *   - AFLDB_E2E_ADMIN_{EMAIL,PASSWORD,TOTP_SECRET}        (super_admin);
 *   - AFLDB_E2E_PLAIN_ADMIN_{EMAIL,PASSWORD,TOTP_SECRET}  (plain admin).
 */

// Defence in depth: the Playwright config already threw at load if the
// target is not a disposable loopback _test deployment. Re-assert here so
// running this file directly with a different --config cannot skip it.
assertDisposableTestTarget();

const SUPER_STATE = resolve('tests/admin-nl-search-clear/.auth/super.json');
const PLAIN_STATE = resolve('tests/admin-nl-search-clear/.auth/plain.json');

type Creds = { email: string; password: string; secret: string };

function credsOrThrow(prefix: string): Creds {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  const secret = process.env[`${prefix}_TOTP_SECRET`];
  expect(email, `${prefix}_EMAIL is not set`).toBeTruthy();
  expect(password, `${prefix}_PASSWORD is not set`).toBeTruthy();
  expect(secret, `${prefix}_TOTP_SECRET is not set`).toBeTruthy();
  return { email: email!, password: password!, secret: secret! };
}

async function signIn(page: Page, creds: Creds): Promise<void> {
  await page.goto('/admin/login');
  // The consent banner renders its own submit buttons; decline it first
  // so it cannot overlay the form or collide with button selectors.
  const decline = page.getByRole('button', { name: 'Decline' });
  if (await decline.count() > 0) await decline.click();
  await page.locator('input[name="email"]').fill(creds.email);
  await page.locator('input[name="password"]').fill(creds.password);
  await page.locator('input[name="totp"]').fill(totpCode(creds.secret));
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Landed inside the admin area, not bounced back to the login form.
  await page.waitForURL(/\/admin(?!\/login)/, { timeout: 15_000 });
}

setup('super admin session', async ({ page }) => {
  await signIn(page, credsOrThrow('AFLDB_E2E_ADMIN'));

  // Sanity: this account really is a super admin, so the clear tests
  // exercise the real thing rather than silently redirecting.
  await page.goto('/admin/nl-search');
  await expect(
    page.getByRole('heading', { name: 'Natural-language search' }),
    'AFLDB_E2E_ADMIN_* did not reach /admin/nl-search — it must be a super_admin.',
  ).toBeVisible();

  mkdirSync(dirname(SUPER_STATE), { recursive: true });
  await page.context().storageState({ path: SUPER_STATE });
});

setup('plain admin session', async ({ page }) => {
  await signIn(page, credsOrThrow('AFLDB_E2E_PLAIN_ADMIN'));

  // Sanity: this account must NOT be a super admin. requireSuperAdmin()
  // redirects a plain admin from /admin/nl-search to /admin; if it stays,
  // the account is misconfigured and the negative test would be hollow.
  await page.goto('/admin/nl-search');
  expect(
    new URL(page.url()).pathname,
    'AFLDB_E2E_PLAIN_ADMIN_* reached /admin/nl-search — it must be a NON-super admin.',
  ).toBe('/admin');

  mkdirSync(dirname(PLAIN_STATE), { recursive: true });
  await page.context().storageState({ path: PLAIN_STATE });
});
