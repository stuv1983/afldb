import { expect, test } from '@playwright/test';

/**
 * Core user journeys, run against the production build.
 */

test('home → search → player', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /Every player\. Every game\./, level: 1 }),
  ).toBeVisible();

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

test('an unfinished season is visibly provisional', async ({ page }) => {
  // 2026 is loaded to 9 August with no finals played.
  await page.goto('/seasons/2026');
  const notice = page.locator('.notice').filter({ hasText: 'Season in progress' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('provisional');
  // No premier may be claimed while the season is still being played.
  await expect(page.locator('.subtitle')).not.toContainText('Premiers:');
});

test('a pending Brownlow reads as not yet awarded, never as zero', async ({ page }) => {
  // Max Gawn is still playing; the 2026 medal has not been awarded.
  await page.goto('/players/max-gawn-11966');
  const seasonTable = page.getByRole('table', { name: /not recorded in that era/ });
  const row2026 = seasonTable.locator('tr').filter({ hasText: '2026' }).first();
  await expect(row2026).toContainText('Not yet awarded');
  await expect(row2026).toContainText('In progress');
});

test('a club page names each era by the identity of the time', async ({ page }) => {
  // Footscray's ladder history was empty until rows were resolved to the
  // identity trading that season, so its 1954 premiership had nowhere to
  // sit. Scope to the season history table: the leaders tables also have
  // a "Seasons" column and would otherwise match first.
  await page.goto('/clubs/footscray');
  const history = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Season history' }) })
    .locator('table');
  await expect(history).toContainText('1954');
  await expect(history).toContainText('1925');
  // The Western Bulldogs era belongs to the other identity's page.
  await expect(history).not.toContainText('2026');
});

test('a merger is presented as a link, not a merged record', async ({ page }) => {
  await page.goto('/clubs/fitzroy');
  // "counted towards" is unique to the merger notice; filtering on the
  // club name alone also matches the club's own historical note.
  const notice = page.locator('.notice').filter({ hasText: 'counted towards' });
  await expect(notice).toContainText('Brisbane Lions');
  await expect(notice).toContainText('kept separate');
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

test('the reader can choose light or dark, and the choice survives navigation', async ({ page }) => {
  await page.goto('/');
  const root = page.locator('html');

  // Nothing stored: the palette follows the operating system and no
  // choice is stamped on the document.
  await expect(root).not.toHaveAttribute('data-theme', /.*/);

  // The control offers exactly one action, named for what it will do.
  await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click();
  const chosen = await root.getAttribute('data-theme');
  expect(chosen === 'dark' || chosen === 'light').toBe(true);

  // Persisted, and applied before paint on the next page rather than
  // flashing the other palette first.
  await page.goto('/players');
  await expect(root).toHaveAttribute('data-theme', chosen!);

  // Toggling back returns the other palette.
  await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click();
  await expect(root).toHaveAttribute('data-theme', chosen === 'dark' ? 'light' : 'dark');
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
