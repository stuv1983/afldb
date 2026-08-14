import { expect, test } from '@playwright/test';

/**
 * Core user journeys, run against the production build.
 */

test('home → search → player', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AFLDB', level: 1 })).toBeVisible();

  const search = page.getByRole('combobox');
  await search.fill('pendlebury');

  // Autocomplete is debounced; wait for the listbox rather than a fixed delay.
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  await expect(page).toHaveURL(/\/players\/scott-pendlebury-4182/);
  await expect(page.getByRole('heading', { name: 'Scott Pendlebury' })).toBeVisible();
});

test('players → sort → player profile', async ({ page }) => {
  await page.goto('/players');
  await expect(page.getByRole('heading', { name: 'Players', level: 1 })).toBeVisible();

  await page.getByRole('link', { name: 'Goals', exact: true }).click();
  await expect(page).toHaveURL(/sort=goals/);

  // The all-time leading goalkicker should head a goals-sorted list.
  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/players\/[a-z0-9-]+-\d+/);
});

test('season → match', async ({ page }) => {
  await page.goto('/seasons/1989');
  await expect(page.getByRole('heading', { name: /1989 VFL Season/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ladder' })).toBeVisible();

  // The 1989 Grand Final is the most famous match in the database.
  await page.getByRole('heading', { name: 'Grand Final' }).scrollIntoViewIfNeeded();
  const gfTable = page.locator('h3', { hasText: 'Grand Final' }).locator('..');
  await gfTable.getByRole('link').first().click();

  await expect(page).toHaveURL(/\/matches\/\d+/);
  await expect(page.getByRole('heading', { name: 'Quarter by quarter' })).toBeVisible();
});

test('advanced search → results → player', async ({ page }) => {
  await page.goto('/advanced-search');
  await page.getByLabel('Career games minimum').fill('300');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page).toHaveURL(/games_min=300/);
  await expect(page.getByText(/players match/)).toBeVisible();

  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/players\/[a-z0-9-]+-\d+/);
});

test('advanced search state is shareable via URL', async ({ page }) => {
  await page.goto('/advanced-search?games_min=200&games_max=249&finals_min=16');
  // The known regression case must hold through the UI.
  await expect(page.locator('.section-note')).toContainText('117 players match');
});

test('records → category', async ({ page }) => {
  await page.goto('/records');
  await page.getByRole('link', { name: 'Most Games' }).click();

  await expect(page).toHaveURL(/\/records\/most-games/);
  await expect(page.getByRole('heading', { name: 'Most Games', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Michael Tuck' })).toBeVisible();
});

test('unknown player returns HTTP 404', async ({ page }) => {
  const response = await page.goto('/players/nobody-99999999');
  expect(response?.status()).toBe(404);
});

test('stale slug redirects to the canonical URL', async ({ page }) => {
  await page.goto('/players/some-old-name-4182');
  await expect(page).toHaveURL(/\/players\/scott-pendlebury-4182$/);
});

test('unrecorded statistics render as an em dash, not zero', async ({ page }) => {
  // Haydn Bunton played 1931-1942, before disposals were recorded.
  await page.goto('/players/haydn-bunton-1466');
  const seasonTable = page.locator('table').filter({ hasText: 'Season' }).first();
  await expect(seasonTable).toContainText('—');
});

test('a mid-century career shows authoritative Brownlow votes', async ({ page }) => {
  // Bob Skilton: 180 votes and three medals, which the legacy per-game
  // derivation reported as NULL.
  await page.goto('/players/bob-skilton-3702');
  const brownlowStat = page.locator('.stat').filter({ hasText: 'Brownlow votes' });
  await expect(brownlowStat.locator('.value')).toHaveText('180');
  await expect(brownlowStat.locator('.note')).toHaveText('3× medallist');
});

test('health endpoint reports database reachability', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: 'ok', database: 'ok' });
  // Must not leak version or connection detail.
  expect(JSON.stringify(body)).not.toMatch(/postgres|password|@|5432/i);
});

test('development deployment is not indexable', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(await response.text()).toContain('Disallow: /');
});

test('statistical tables stay usable on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile-only check');

  await page.goto('/players/scott-pendlebury-4182');
  // Wide tables scroll inside their own container; the page must not.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(overflow).toBe(true);
});
