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

test('player search → results → player', async ({ page }) => {
  // Advanced Player Search merged into the index; the filter panel there is
  // the search, so it has to be opened before it can be filled.
  await page.goto('/players');
  await page.locator('summary', { hasText: 'Advanced search' }).click();
  await page.getByLabel('Games minimum').fill('300');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(page).toHaveURL(/games_min=300/);

  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/players\/[a-z0-9-]+-\d+/);
});

test('player search state is shareable via URL', async ({ page }) => {
  await page.goto('/players?games_min=200&games_max=249&finals_min=16');
  // The known regression case must hold through the UI, and must survive the
  // merge: this is the same 117 the standalone search page returned.
  await expect(page.locator('.subtitle')).toContainText('117 players');
});

test('the old advanced-search URL still resolves, filters intact', async ({ page }) => {
  await page.goto('/advanced-search?games_min=200&games_max=249&finals_min=16');
  await expect(page).toHaveURL('/players?games_min=200&games_max=249&finals_min=16');
  await expect(page.locator('.subtitle')).toContainText('117 players');
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

test('robots.txt matches the deployment it is serving', async ({ request }) => {
  // AFLDB_ENV gates indexing, so the correct answer differs by
  // environment. Asserting "Disallow: /" unconditionally meant a
  // correctly indexable production site would fail its own smoke test.
  const body = await (await request.get('/robots.txt')).text();

  if (process.env.AFLDB_ENV === 'production') {
    expect(body).not.toMatch(/^Disallow: \/$/m);
    expect(body).toContain('Allow: /');
    // Whatever it advertises as the sitemap has to exist.
    const advertised = body.match(/^Sitemap:\s*(\S+)$/m)?.[1];
    expect(advertised).toBeTruthy();
    const sitemap = await request.get(advertised!);
    expect(sitemap.status()).toBe(200);
  } else {
    expect(body).toContain('Disallow: /');
  }
});

test('the sitemap index resolves to segments that have URLs in them', async ({ request }) => {
  // /sitemap.xml returned 404 while the segments existed, so nothing
  // published pointed at any of them.
  const index = await request.get('/sitemap.xml');
  expect(index.status()).toBe(200);

  const body = await index.text();
  const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locations.length).toBeGreaterThan(1);

  // Segment 0 carries the static routes and the reference collections; it
  // came back as an empty urlset because the id arrived as a string.
  const segment0 = await request.get(new URL(locations[0]).pathname);
  expect(segment0.status()).toBe(200);
  const segment0Body = await segment0.text();
  expect(segment0Body).toContain('/clubs/');
  expect(segment0Body).toContain('/match-search');

  const last = await request.get(new URL(locations[locations.length - 1]).pathname);
  expect((await last.text()).match(/<url>/g)?.length).toBeGreaterThan(0);
});

test('match search → results → match', async ({ page }) => {
  await page.goto('/match-search');
  await page.getByLabel('Margin (points) maximum').fill('3');
  await page.getByLabel('Match type').selectOption('finals');
  await page.getByRole('button', { name: 'Search matches' }).click();

  await expect(page).toHaveURL(/margin_max=3/);
  await expect(page.locator('.section-note')).toContainText('matches');

  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/matches\/\d+/);
});

test('match search describes the search it actually ran', async ({ page }) => {
  // The form echoed the raw 999 while the query was capped at 400.
  await page.goto('/match-search?search=1&margin_min=999');
  await expect(page.getByLabel('Margin (points) minimum')).toHaveValue('400');
  await expect(page.locator('.notice')).toContainText('400');
});

test('match search shows every active club filter', async ({ page }) => {
  await page.goto('/match-search?search=1&club=collingwood,carlton');
  const note = page.locator('.section-note');
  await expect(note).toContainText('Collingwood');
  // The second club was applied but invisible, and was lost on resubmit.
  await expect(note).toContainText('Carlton');
});

test('match search is reachable from the primary navigation', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the masthead nav is hidden on a phone');

  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Match Search' }).click();
  await expect(page).toHaveURL(/\/match-search/);
});

test('the AFLW placeholder is reachable from site navigation', async ({ page, isMobile }) => {
  // Start on a static route so this UI-only check does not depend on the database.
  await page.goto('/not-a-real-page');

  const navigation = page.getByRole('navigation', {
    name: isMobile ? 'Sections' : 'Primary',
  });
  await navigation.getByRole('link', { name: 'AFLW' }).click();

  await expect(page).toHaveURL(/\/aflw$/);
  await expect(page.getByRole('heading', { name: 'AFLW is coming to AFLDB' })).toBeVisible();
  await expect(page.getByText('Coming soon')).toHaveCount(5);
});

test('a drawn match reads as a draw, not as a defeat', async ({ page }) => {
  // The description was a fixed "defeated by", which was backwards for
  // every home win and wrong for every draw.
  await page.goto('/match-search?search=1&outcome=draw&match_type=finals&sort=date_asc');
  await page.getByRole('row').nth(1).getByRole('link').first().click();

  const description = page.locator('meta[name="description"]');
  await expect(description).toHaveAttribute('content', /drew with/);
});

test('a home win is not described as a defeat', async ({ page }) => {
  // Match 16887: Adelaide 103, St Kilda 102. The home side won by a
  // point, and the description read "Adelaide 103 defeated by St Kilda".
  await page.goto('/matches/16887');
  const description = page.locator('meta[name="description"]');
  await expect(description).toHaveAttribute('content', /Adelaide 103 defeated St Kilda 102/);
});

test('a shared Brownlow names every winner', async ({ page }) => {
  // 2003 was shared by Buckley, Goodes and Ricciuto; the summary named
  // only whichever one sorted first.
  await page.goto('/brownlow/2003');
  const subtitle = page.locator('.subtitle').first();
  await expect(subtitle).toContainText('Shared by');
  await expect(subtitle).toContainText('Nathan Buckley');
  await expect(subtitle).toContainText('Adam Goodes');
  await expect(subtitle).toContainText('Mark Ricciuto');
});

test('a merged club names its successor in the clubs index', async ({ page }) => {
  await page.goto('/clubs');
  const fitzroy = page.getByRole('row').filter({ hasText: 'Fitzroy' }).first();
  // "Continues as —" told the reader nothing about where Fitzroy went.
  await expect(fitzroy).toContainText('Brisbane Lions');

  const university = page.getByRole('row').filter({ hasText: 'University' }).first();
  await expect(university).toContainText('no successor');
});

test('a page past the last one lands on a page that exists', async ({ page }) => {
  await page.goto('/players?page=999');
  // Previously reported "0 players" while claiming 13,361 in the same view.
  await expect(page).toHaveURL(/page=\d+/);
  await expect(page.locator('.subtitle')).toContainText('13,361 players');
  await expect(page.getByRole('row').nth(1)).toBeVisible();
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
