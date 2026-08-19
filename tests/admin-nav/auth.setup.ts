import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { expect, test as setup } from '@playwright/test';

import { totpCode } from './totp';

/**
 * Signs in to /admin/login as the diagnostic super-admin account and
 * saves the authenticated storage state for the navigation spec.
 *
 * Uses the real login form with a real, freshly computed TOTP code —
 * nothing in the application's auth path is bypassed or weakened. The
 * account is a dev-only test account (see the investigation notes);
 * credentials arrive via environment variables, never hard-coded.
 *
 * TOTP replay defence: the server advances totp_last_step on every
 * successful login, so two logins inside one 30s step would reject the
 * second. One setup per run stays under that naturally.
 */
const STATE_PATH = resolve('tests/admin-nav/.auth/state.json');

setup('admin login', async ({ page }) => {
  const email = process.env.AFLDB_E2E_ADMIN_EMAIL;
  const password = process.env.AFLDB_E2E_ADMIN_PASSWORD;
  const secret = process.env.AFLDB_E2E_ADMIN_TOTP_SECRET;
  expect(email, 'AFLDB_E2E_ADMIN_EMAIL is not set').toBeTruthy();
  expect(password, 'AFLDB_E2E_ADMIN_PASSWORD is not set').toBeTruthy();
  expect(secret, 'AFLDB_E2E_ADMIN_TOTP_SECRET is not set').toBeTruthy();

  await page.goto('/admin/login');
  // The consent banner renders its own submit buttons; decline it first so
  // it can neither overlay the form nor collide with button selectors.
  const decline = page.getByRole('button', { name: 'Decline' });
  if (await decline.count() > 0) await decline.click();
  await page.locator('input[name="email"]').fill(email!);
  await page.locator('input[name="password"]').fill(password!);
  await page.locator('input[name="totp"]').fill(totpCode(secret!));
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Landed inside the admin area, not bounced back to the login form.
  await page.waitForURL(/\/admin(?!\/login)/, { timeout: 15_000 });

  mkdirSync(dirname(STATE_PATH), { recursive: true });
  await page.context().storageState({ path: STATE_PATH });
});
