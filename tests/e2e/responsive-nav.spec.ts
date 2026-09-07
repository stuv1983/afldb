import { expect, test, type Page } from '@playwright/test';

/**
 * AFLDB-ISSUE-147 — the public responsive navigation contract.
 *
 * The defect this guards against: the phone nav and the desktop nav were
 * two hand-kept lists, and the phone one had dropped Clubs, Venues,
 * Coaches, Brownlow, Awards, Draft and Match Search. These tests assert
 * the two presentations expose the SAME set of primary destinations, that
 * the phone "More" sheet behaves as a dialog, and that a few
 * representative pages stay within the viewport with their data and
 * controls reachable at 320–390px.
 *
 * Expectations are derived from what the wide layout actually renders, not
 * from a copied list, so a destination added to the masthead in future
 * fails here until it is reachable on a phone too.
 */

const PHONE = { width: 375, height: 667 };
const SMALL_PHONE = { width: 320, height: 568 };

// Labels are compared case-insensitively: the masthead upper-cases its
// links in CSS (so innerText comes back "PLAYERS") while the sheet does
// not. The accessible name — what a reader and a screen reader get — is
// the same either way.
function norm(labels: string[]): string[] {
  return labels.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

async function mastheadLabels(page: Page): Promise<string[]> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link').first()).toBeVisible();
  return norm(await nav.getByRole('link').allInnerTexts());
}

async function openMoreSheet(page: Page) {
  const more = page.getByRole('button', { name: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  return page.getByRole('dialog', { name: 'All sections' });
}

test.describe('primary navigation is the same set on phone and desktop', () => {
  test('every masthead destination is reachable from the phone "More" sheet', async ({ page }) => {
    const wide = await mastheadLabels(page);
    expect(wide).toContain('clubs');
    expect(wide.length).toBeGreaterThanOrEqual(10);

    await page.setViewportSize(PHONE);
    await page.goto('/');

    // The masthead nav must not be reachable on a phone...
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();

    // ...its destinations are, via the sheet.
    const sheet = await openMoreSheet(page);
    const sheetLabels = norm(await sheet.getByRole('link').allInnerTexts());

    for (const label of wide) {
      expect(sheetLabels, `"${label}" missing from the phone More sheet`).toContain(label);
    }
  });

  test('the quick bar plus the sheet cover every destination, Clubs included', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');

    const quickBar = page.getByRole('navigation', { name: 'Sections' });
    expect(norm(await quickBar.getByRole('link').allInnerTexts()))
      .toEqual(['home', 'players', 'clubs', 'seasons']);

    // Clubs has a one-tap slot now; following it lands on the index.
    await quickBar.getByRole('link', { name: 'Clubs' }).click();
    await expect(page).toHaveURL(/\/clubs$/);
  });

  test('the desktop masthead still carries the full set on one screen', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/players');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const label of ['Players', 'Clubs', 'Seasons', 'Venues', 'Records', 'Match Search', 'AFLW']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // No bottom bar on the desktop layout.
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
  });

  test('under /aflw the sheet carries the AFLW set, not the AFL one', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/aflw');
    const sheet = await openMoreSheet(page);
    const labels = norm(await sheet.getByRole('link').allInnerTexts());
    expect(labels).toContain('venues');
    expect(labels).toContain('match search');
    expect(labels).toContain('afl');
    expect(labels).not.toContain('brownlow');
  });
});

test.describe('the "More" sheet behaves as a dialog', () => {
  test('opens, traps nothing, closes on Escape, backdrop and link', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/');
    const more = page.getByRole('button', { name: 'More' });

    await more.click();
    const sheet = page.getByRole('dialog', { name: 'All sections' });
    await expect(sheet).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');

    // Escape closes and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();

    // Backdrop click closes.
    await more.click();
    await expect(sheet).toBeVisible();
    await page.mouse.click(5, 5); // top-left: backdrop, well clear of the panel
    await expect(sheet).toBeHidden();

    // A link inside navigates and the sheet is gone on the next page.
    await more.click();
    await sheet.getByRole('link', { name: 'Brownlow', exact: true }).click();
    await expect(page).toHaveURL(/\/brownlow$/);
    await expect(page.getByRole('dialog', { name: 'All sections' })).toBeHidden();
  });

  test('the sheet scrolls when it is taller than the screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 }); // deliberately short
    await page.goto('/');
    const sheet = await openMoreSheet(page);
    const last = sheet.getByRole('link').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });
});

test.describe('representative pages stay inside the viewport on a phone', () => {
  const routes = [
    '/',
    '/players',
    '/players?games_min=200&games_max=249&finals_min=16',
    '/players/scott-pendlebury-4182',
    '/clubs',
    '/clubs/compare?club1=carlton&club2=collingwood',
    '/seasons/1989',
    '/records/most-games',
    '/brownlow/2003',
    '/match-search',
    '/grid-solver',
  ];

  for (const width of [320, 375]) {
    for (const path of routes) {
      test(`no document-level horizontal scroll: ${path} @ ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 720 });
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        const overflow = await page.evaluate(() => {
          const de = document.documentElement;
          return de.scrollWidth - de.clientWidth;
        });
        expect(overflow, `${path} overflows the document by ${overflow}px`).toBeLessThanOrEqual(1);
      });
    }
  }
});

test.describe('data and controls stay reachable on a phone', () => {
  test('a wide table scrolls inside its own region, not the page', async ({ page }) => {
    await page.setViewportSize(SMALL_PHONE);
    await page.goto('/players', { waitUntil: 'networkidle' });

    const state = await page.evaluate(() => {
      const wrap = document.querySelector('.table-wrap') as HTMLElement | null;
      if (!wrap) return null;
      const de = document.documentElement;
      wrap.scrollLeft = wrap.scrollWidth; // drive it to the far end
      return {
        regionScrolls: wrap.scrollWidth > wrap.clientWidth + 1,
        landedRight: wrap.scrollLeft > 0,
        pageStill: de.scrollWidth - de.clientWidth,
      };
    });
    expect(state).not.toBeNull();
    expect(state!.regionScrolls, 'the players table region does not scroll').toBe(true);
    expect(state!.landedRight, 'scrolling the region had no effect').toBe(true);
    expect(state!.pageStill, 'scrolling the table moved the page').toBeLessThanOrEqual(1);

    // The columns that were off-screen carry the sort controls — they must
    // exist and be reachable once the region is scrolled.
    const goals = page.getByRole('link', { name: 'Goals', exact: true });
    await goals.scrollIntoViewIfNeeded();
    await expect(goals).toBeVisible();
    await goals.click();
    await expect(page).toHaveURL(/sort=goals/);
  });

  test('the players filter panel opens and applies at 320px', async ({ page }) => {
    await page.setViewportSize(SMALL_PHONE);
    await page.goto('/players');
    await page.locator('summary', { hasText: 'Advanced search' }).click();
    const gamesMin = page.getByLabel('Games minimum');
    await gamesMin.scrollIntoViewIfNeeded();
    await gamesMin.fill('300');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page).toHaveURL(/games_min=300/);
  });

  test('pagination is usable at 320px', async ({ page }) => {
    await page.setViewportSize(SMALL_PHONE);
    await page.goto('/players');
    const next = page.getByRole('link', { name: /Next/ });
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeInViewport();
    await next.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole('row').nth(1)).toBeVisible();
  });

  test('the club comparison is reachable and legible at 320px', async ({ page }) => {
    await page.setViewportSize(SMALL_PHONE);
    await page.goto('/clubs/compare?club1=carlton&club2=collingwood', { waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { name: 'Carlton v Collingwood', level: 1 }),
    ).toBeVisible();
    // Head-to-head figures render and the page did not blow out sideways.
    await expect(page.getByRole('heading', { name: 'Head-to-head' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
