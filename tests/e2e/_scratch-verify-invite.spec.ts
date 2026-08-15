import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

// Throwaway E2E verification for the admin-invite + QR MFA flow. Not part
// of the committed suite -- uses hardcoded test-only credentials against
// throwaway accounts created and torn down around this run.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0, value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}
function totpCode(secret: string, stepOffset = 0): string {
  const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

const SUPER_EMAIL = 'e2e-test-super@example.invalid';
const SUPER_PASSWORD = 'Verify-Test-Passw0rd-1234';
const SUPER_SECRET = '76RE37LVCCYBWEH7LBCYXGLORXIARL7I';
const INVITEE_EMAIL = 'e2e-test-invitee@example.invalid';
const INVITEE_PASSWORD = 'Verify-Invitee-Passw0rd-5678';

test('admin invite -> QR MFA enrolment -> login', async ({ page }) => {
  // 1. Sign in as the throwaway super admin.
  await page.goto('/admin/login');
  await page.getByRole('button', { name: 'Sign in' }).waitFor({ state: 'visible' });
  await page.getByLabel('Email').fill(SUPER_EMAIL);
  await page.getByLabel('Password').fill(SUPER_PASSWORD);
  const code = totpCode(SUPER_SECRET);
  await page.getByLabel('Authenticator code').fill(code);
  console.log('DIAG email field:', await page.getByLabel('Email').inputValue());
  console.log('DIAG password field:', await page.getByLabel('Password').inputValue());
  console.log('DIAG totp field:', await page.getByLabel('Authenticator code').inputValue());
  console.log('DIAG computed code:', code, 'at', Date.now());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(1500);
  console.log('DIAG url after click:', page.url());
  console.log('DIAG body text after click:', (await page.locator('body').innerText()).slice(0, 400));
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(`Signed in as ${SUPER_EMAIL}`)).toBeVisible();

  // 2. Create an invite for a new admin.
  await page.goto('/admin/admins');
  await expect(page.getByRole('heading', { name: 'Invite an admin' })).toBeVisible();
  await page.getByLabel('Email').fill(INVITEE_EMAIL);
  await page.getByRole('button', { name: 'Create invite' }).click();

  const linkCode = page.locator('code.mono').first();
  await expect(linkCode).toBeVisible();
  const inviteLink = (await linkCode.textContent())?.trim();
  expect(inviteLink).toMatch(/\/admin\/invite\//);
  console.log(`invite link: ${inviteLink}`);

  // 3. Sign out of the super-admin session, then accept the invite as a fresh visitor.
  await page.context().clearCookies();
  await page.goto(inviteLink!);
  await expect(page.getByRole('heading', { name: 'Set up your admin account' })).toBeVisible();
  await expect(page.getByText(INVITEE_EMAIL)).toBeVisible();

  await page.getByLabel('Choose a password').fill(INVITEE_PASSWORD);
  await page.getByLabel('Confirm password').fill(INVITEE_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  // 4. QR step: read the manual-entry fallback secret so we can compute a real code.
  await page.getByText("Can’t scan it? Enter this key manually").click();
  const secretCode = page.locator('code.mono');
  await expect(secretCode).toBeVisible();
  const invitedSecret = (await secretCode.textContent())?.trim().replace(/\s+/g, '');
  expect(invitedSecret).toMatch(/^[A-Z2-7]{32}$/);

  await page.getByLabel('Enter the current code to confirm').fill(totpCode(invitedSecret!));
  await page.getByRole('button', { name: 'Confirm and finish' }).click();
  await expect(page).toHaveURL(/\/admin\/login/);

  // 5. Log in as the newly enrolled admin.
  await page.getByLabel('Email').fill(INVITEE_EMAIL);
  await page.getByLabel('Password').fill(INVITEE_PASSWORD);
  await page.getByLabel('Authenticator code').fill(totpCode(invitedSecret!));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(`Signed in as ${INVITEE_EMAIL}`)).toBeVisible();
});
