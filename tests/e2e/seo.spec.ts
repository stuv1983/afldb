import { expect, test, type Page } from '@playwright/test';

/**
 * SEO assertions against the production build.
 *
 * These check what a crawler is actually served, which is the only place a
 * whole class of defects is visible: metadata that Next resolved differently
 * from how the page wrote it, structured data that does not parse, a
 * canonical that resolves to the wrong origin, or a "not found" page
 * answering 200.
 *
 * DELIBERATELY AGNOSTIC ABOUT WHETHER THIS DEPLOYMENT IS INDEXED. The suite
 * normally runs against the dev server, where `AFLDB_INDEXING` is off and
 * every page correctly carries `noindex`. So nothing here asserts that a
 * page IS indexable — it asserts the things that must hold either way, plus
 * the consistency between robots.txt and the page metadata, which is the
 * pair that once disagreed.
 */

const content = (page: Page, selector: string) =>
  page.locator(selector).first().getAttribute('content');

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  // Parsing IS the assertion: an unescaped `</script>` in a club nickname
  // or a venue's legacy name would truncate the block and throw here.
  return blocks.map((block) => JSON.parse(block));
}

/** Pages that must each carry a full, self-describing metadata set. */
const PAGES: { path: string; canonical: string }[] = [
  { path: '/', canonical: '/' },
  { path: '/players', canonical: '/players' },
  { path: '/clubs/carlton', canonical: '/clubs/carlton' },
  { path: '/seasons/1989', canonical: '/seasons/1989' },
  { path: '/records/most-games', canonical: '/records/most-games' },
  { path: '/brownlow/2024', canonical: '/brownlow/2024' },
  { path: '/aflw', canonical: '/aflw' },
];

for (const { path, canonical } of PAGES) {
  test(`metadata is complete and self-consistent on ${path}`, async ({ page }) => {
    await page.goto(path);

    const title = await page.title();
    expect(title.length).toBeGreaterThan(10);
    // The root layout's default. A page still wearing it has no title of
    // its own, which is the failure this catches.
    expect(title).not.toBe('AFLDB — Australian Football Statistics Database');
    expect(title.endsWith('| AFLDB')).toBe(true);

    const description = await content(page, 'meta[name="description"]');
    expect(description?.length ?? 0).toBeGreaterThan(50);

    const href = await page.locator('link[rel="canonical"]').first().getAttribute('href');
    expect(href).toBeTruthy();
    const url = new URL(href!);
    expect(url.protocol === 'https:' || url.hostname === '127.0.0.1'
      || url.hostname === 'localhost' || /^10\./.test(url.hostname)).toBe(true);
    expect(url.pathname).toBe(canonical === '/' ? '/' : canonical);
    expect(url.search).toBe('');

    // og:url was missing site-wide until `pageMetadata`: Next only emits it
    // when openGraph.url is set explicitly.
    const ogUrl = await content(page, 'meta[property="og:url"]');
    expect(ogUrl).toBe(href);
    expect(await content(page, 'meta[property="og:site_name"]')).toBe('AFLDB');
    expect((await content(page, 'meta[property="og:title"]'))?.length ?? 0)
      .toBeGreaterThan(10);
    expect((await content(page, 'meta[property="og:description"]'))?.length ?? 0)
      .toBeGreaterThan(50);

    // One h1, and it says something.
    const headings = page.locator('h1');
    await expect(headings).toHaveCount(1);
    expect(((await headings.first().textContent()) ?? '').trim().length)
      .toBeGreaterThan(2);
  });
}

test('a player page carries valid Person and BreadcrumbList data', async ({ page }) => {
  await page.goto('/players/scott-pendlebury-4182');

  const blocks = await jsonLd(page);
  const types = blocks.map((b) => b['@type']);
  expect(types).toContain('Person');
  expect(types).toContain('BreadcrumbList');

  const person = blocks.find((b) => b['@type'] === 'Person') as Record<string, string>;
  expect(person.name).toBe('Scott Pendlebury');
  expect(person.url).toContain('/players/scott-pendlebury-4182');

  const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList') as {
    itemListElement: Record<string, unknown>[];
  };
  expect(crumbs.itemListElement[0].name).toBe('AFLDB');
  // The last crumb is the current page and must carry no `item`.
  expect(crumbs.itemListElement.at(-1)).not.toHaveProperty('item');
});

test('a match page carries valid SportsEvent data', async ({ page }) => {
  await page.goto('/seasons/1989');
  await page.locator('a[href^="/matches/"]').first().click();
  await expect(page).toHaveURL(/\/matches\/\d+/);

  const event = (await jsonLd(page)).find((b) => b['@type'] === 'SportsEvent') as
    Record<string, unknown>;
  expect(event).toBeTruthy();
  expect(Array.isArray(event.competitor)).toBe(true);
  expect((event.competitor as unknown[]).length).toBe(2);
});

test('a club page carries valid SportsTeam data', async ({ page }) => {
  await page.goto('/clubs/carlton');
  const team = (await jsonLd(page)).find((b) => b['@type'] === 'SportsTeam') as
    Record<string, unknown>;
  expect(team).toBeTruthy();
  expect(team.name).toBe('Carlton');
});

/**
 * The filtered-view policy. A filter state is a view of the list, not a page
 * of its own: it stays crawlable so its links are followed, and stays out of
 * the index so it does not compete with the list it came from.
 */
test('a filtered list is noindex, follow while the bare list is not', async ({ page }) => {
  await page.goto('/players?games_min=300&sort=goals');
  const filtered = await content(page, 'meta[name="robots"]');
  expect(filtered).toContain('noindex');
  expect(filtered).toContain('follow');
  expect(filtered).not.toContain('nofollow');

  // The canonical still points at the unfiltered list, and drops the query.
  const href = await page.locator('link[rel="canonical"]').first().getAttribute('href');
  expect(new URL(href!).pathname).toBe('/players');
  expect(new URL(href!).search).toBe('');
});

test('search results are never indexable', async ({ page }) => {
  await page.goto('/search?q=ablett');
  expect(await content(page, 'meta[name="robots"]')).toContain('noindex');
});

/**
 * A soft 404 — a 200 response whose body says "not found" — is the single
 * worst thing a database-backed site can serve a crawler, because every
 * mistyped URL becomes an indexable near-duplicate.
 */
test('invalid entities answer 404, not 200', async ({ page }) => {
  for (const path of [
    '/players/not-a-player-99999999',
    '/players/no-trailing-id',
    '/clubs/not-a-club',
    '/seasons/1066',
    '/matches/99999999',
    '/venues/not-a-venue',
    '/records/not-a-record',
    '/brownlow/1900',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test('robots.txt and the page metadata agree about indexing', async ({ page, request }) => {
  const robotsResponse = await request.get('/robots.txt');
  expect(robotsResponse.status()).toBe(200);
  const robots = await robotsResponse.text();

  await page.goto('/');
  const meta = (await content(page, 'meta[name="robots"]')) ?? '';
  const blockedEverywhere = /^\s*Disallow:\s*\/\s*$/m.test(robots)
    && !/^\s*Allow:/m.test(robots);

  // These two used to be able to disagree — robots.txt said Disallow: / on a
  // host whose pages said index — because they read different flags. They
  // now read one predicate, and this is what pins that.
  expect(blockedEverywhere).toBe(meta.includes('noindex'));

  if (blockedEverywhere) {
    // A deployment that must not be indexed publishes no map of itself.
    expect((await request.get('/sitemap.xml')).status()).toBe(404);
    return;
  }

  expect(robots).toMatch(/^\s*Disallow:\s*\/admin/m);
  expect(robots).toMatch(/^\s*Disallow:\s*\/api\//m);
  expect(robots).toMatch(/^\s*Disallow:\s*\/search/m);

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain('<sitemapindex');
  // The segment carrying the curated landing pages — the record boards,
  // Brownlow counts and award histories that were absent from the map
  // altogether before it existed.
  expect(xml).toContain('/sitemap/1.xml');
  // An invented lastmod is worse than none, so there must be none.
  expect(xml).not.toContain('<lastmod>');
});

/**
 * A stale slug must resolve to the current URL in ONE permanent hop. Two
 * hops, or a temporary redirect, both waste the signal the redirect exists
 * to pass on.
 */
test('a stale player slug redirects once, permanently', async ({ request }) => {
  const response = await request.get('/players/wrong-name-4182', {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toContain('/players/scott-pendlebury-4182');
});
