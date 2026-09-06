/**
 * AFLDB-ISSUE-144 Stage 7 — route state for /clubs/compare.
 *
 * These exercise the route's own resolution against real `afldb_test`
 * data, because every rule this stage adds is a rule about canonical
 * rows: which seasons exist, which slugs are organisations, and which
 * two organisations are the same one under different names. Fixtures
 * could not prove any of it.
 *
 * Nothing here re-proves Stage 1-6 query semantics; those live in
 * tests/integration/club-comparison.test.ts and are untouched. The one
 * statistical value asserted (Adelaide/Brisbane Lions 41 meetings) is
 * the runbook witness, used only to show the route loaded real data.
 *
 * No year is written down: the default season, the historical season and
 * the "did not compete" case are all discovered from `seasons`.
 */
import './guard';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateMetadata } from '@/app/clubs/compare/page';
import {
  resolveClubComparisonMetadata,
  resolveClubComparisonState,
} from '@/app/clubs/compare/state';
import { sql } from '@/db/client';
import { MEETINGS_PAGE_SIZE, getComparisonSeasons } from '@/db/queries/club-comparison';

afterAll(async () => {
  await sql.end();
});

let latestSeason = 0;
let historicalSeason = 0;

beforeAll(async () => {
  const seasons = await getComparisonSeasons();
  expect(seasons.length).toBeGreaterThan(0);
  latestSeason = seasons[0].season;
  // A canonical season that is not the default, discovered rather than named.
  historicalSeason = seasons[seasons.length - 1].season;
  expect(historicalSeason).toBeLessThan(latestSeason);
});

describe('Stage 7 route state: unselected landing', () => {
  it('renders a landing state and chooses nobody', async () => {
    const state = await resolveClubComparisonState({});

    expect(state.kind).toBe('unselected');
    expect(state.params.club1).toBeNull();
    expect(state.params.club2).toBeNull();
    // No pair-specific data exists on this state, so no pair query ran.
    expect('data' in state).toBe(false);
    expect(state.canonicalPath).toBe('/clubs/compare');
    expect(state.noindex).toBe(false);
    expect(state.notices).toEqual([]);
  });

  it('offers canonical seasons and organisations to the selectors', async () => {
    const state = await resolveClubComparisonState({});

    expect(state.options.seasons[0].season).toBe(latestSeason);
    expect(state.options.organizations.length).toBeGreaterThan(0);

    const slugs = state.options.organizations.map((o) => o.slug);
    expect(slugs).toContain('carlton');
    // Historical identities inside a continuing organisation are not choices.
    expect(slugs).not.toContain('footscray');
    expect(slugs).not.toContain('south-melbourne');

    // Current organisations first, alphabetical within each group.
    const activeCount = state.options.organizations.filter((o) => o.isActive).length;
    const active = state.options.organizations.slice(0, activeCount);
    const historical = state.options.organizations.slice(activeCount);
    expect(active.every((o) => o.isActive)).toBe(true);
    expect(historical.every((o) => !o.isActive)).toBe(true);
    expect(active.map((o) => o.name)).toEqual([...active.map((o) => o.name)].sort());
    expect(historical.map((o) => o.name)).toEqual([...historical.map((o) => o.name)].sort());
  });

  it('treats half a pair as unselected', async () => {
    const state = await resolveClubComparisonState({ club1: 'carlton' });
    expect(state.kind).toBe('unselected');
    expect('data' in state).toBe(false);
  });
});

describe('Stage 7 route state: valid pair', () => {
  it('loads the comparison with dynamic defaults', async () => {
    const state = await resolveClubComparisonState({
      club1: 'adelaide', club2: 'brisbane-lions',
    });

    expect(state.kind).toBe('comparison');
    if (state.kind !== 'comparison') return;

    expect(state.organizationA.slug).toBe('adelaide');
    expect(state.organizationB.slug).toBe('brisbane-lions');
    expect(state.params.season).toBe(latestSeason);
    expect(state.params.matchType).toBe('all');
    expect(state.params.page).toBe(1);
    expect(state.notices).toEqual([]);

    // Real data, not an empty shell.
    expect(state.data.summary.meetings).toBe(41);
    expect(state.data.meetings.pageSize).toBe(MEETINGS_PAGE_SIZE);
    expect(state.data.seasonA?.season).toBe(latestSeason);
    expect(state.data.seasonB?.season).toBe(latestSeason);
    expect(state.data.brownlowA).toBeTruthy();
    expect(state.data.decades.length).toBeGreaterThan(0);
    expect(state.data.periodRecords).toBeTruthy();
    expect(state.data.playerAverages).toBeTruthy();
  });

  it('keeps requested presentation order while canonicalising alphabetically', async () => {
    const [forward, reversed] = await Promise.all([
      resolveClubComparisonState({ club1: 'adelaide', club2: 'brisbane-lions' }),
      resolveClubComparisonState({ club1: 'brisbane-lions', club2: 'adelaide' }),
    ]);
    if (forward.kind !== 'comparison' || reversed.kind !== 'comparison') {
      throw new Error('both pairs must resolve');
    }

    // Presentation order is the requested order...
    expect(reversed.organizationA.slug).toBe('brisbane-lions');
    expect(reversed.organizationB.slug).toBe('adelaide');
    // ...and the statistics are oriented to it, not silently re-sorted.
    expect(reversed.data.summary.aWins).toBe(forward.data.summary.bWins);
    expect(reversed.data.summary.bWins).toBe(forward.data.summary.aWins);
    expect(reversed.data.summary.meetings).toBe(forward.data.summary.meetings);

    // The canonical URL is alphabetical in both directions.
    const canonical = '/clubs/compare?club1=adelaide&club2=brisbane-lions';
    expect(forward.canonicalPath).toBe(canonical);
    expect(reversed.canonicalPath).toBe(canonical);

    // The shareable URL is the current view, with the season it actually
    // resolved to pinned so a shared link keeps showing what was shared.
    expect(reversed.sharePath)
      .toBe(`/clubs/compare?club1=brisbane-lions&club2=adelaide&season=${latestSeason}`);
    expect(reversed.swapPath).toBe(forward.sharePath);
  });

  it('compares related but distinct organisations', async () => {
    const pairs: Array<[string, string]> = [
      ['brisbane-bears', 'brisbane-lions'],
      ['fitzroy', 'brisbane-lions'],
      ['brisbane-bears', 'fitzroy'],
    ];
    for (const [club1, club2] of pairs) {
      const state = await resolveClubComparisonState({ club1, club2 });
      expect(state.kind, `${club1} vs ${club2}`).toBe('comparison');
    }
  });
});

describe('Stage 7 route state: season handling', () => {
  it('keeps a canonical historical season', async () => {
    const state = await resolveClubComparisonState({
      club1: 'carlton', club2: 'collingwood', season: String(historicalSeason),
    });

    expect(state.kind).toBe('comparison');
    expect(state.params.season).toBe(historicalSeason);
    expect(state.seasonMeta?.season).toBe(historicalSeason);
    expect(state.notices).toEqual([]);
    if (state.kind !== 'comparison') return;
    expect(state.data.seasonA?.season).toBe(historicalSeason);
  });

  it('falls back to the maximum canonical season with a notice', async () => {
    for (const bad of ['1066', 'not-a-season', '']) {
      const state = await resolveClubComparisonState({
        club1: 'carlton', club2: 'collingwood', season: bad,
      });
      expect(state.params.season, bad).toBe(latestSeason);
      if (bad === '') {
        // An empty value is an absent value, not a wrong one.
        expect(state.notices).toEqual([]);
      } else {
        const notice = state.notices.find((n) => n.field === 'season');
        expect(notice, bad).toBeTruthy();
        expect(notice?.message).toContain(String(latestSeason));
      }
    }
  });

  it('preserves a season an organisation did not compete in', async () => {
    // Discovered, not assumed: a canonical season with no participation.
    const [row] = await sql<{ season: number }[]>`
      SELECT s.year::int AS season
        FROM seasons s
       WHERE NOT EXISTS (
               SELECT 1 FROM club_seasons cs
                 JOIN clubs c ON c.id = cs.club_id
                 JOIN club_organizations o ON o.id = c.organization_id
                WHERE cs.season = s.year AND o.slug = 'adelaide')
       ORDER BY s.year DESC
       LIMIT 1
    `;
    if (!row) return; // Nothing to prove on a database where Adelaide played every season.

    const state = await resolveClubComparisonState({
      club1: 'adelaide', club2: 'brisbane-lions', season: String(row.season),
    });
    expect(state.params.season).toBe(row.season);
    if (state.kind !== 'comparison') throw new Error('pair must still resolve');
    expect(state.data.seasonA?.season).toBe(row.season);
    expect(state.data.seasonA?.participated).toBe(false);
    expect(state.data.seasonA?.record).toBeNull();
  });
});

describe('Stage 7 route state: filter and page normalisation', () => {
  it('applies a valid match filter', async () => {
    const state = await resolveClubComparisonState({
      club1: 'carlton', club2: 'collingwood', matchType: 'finals',
    });
    expect(state.params.matchType).toBe('finals');
    if (state.kind !== 'comparison') throw new Error('pair must resolve');
    expect(state.data.meetings.matchType).toBe('finals');
    expect(state.data.meetings.totalMeetings)
      .toBeLessThan(state.data.summary.meetings);
  });

  it('falls back to all matches on an invalid filter, with a notice', async () => {
    const state = await resolveClubComparisonState({
      club1: 'carlton', club2: 'collingwood', matchType: 'Finals',
    });
    expect(state.params.matchType).toBe('all');
    expect(state.notices.some((n) => n.field === 'matchType')).toBe(true);
  });

  it('normalises an invalid page to 1, with a notice', async () => {
    for (const bad of ['0', '-3', 'two']) {
      const state = await resolveClubComparisonState({
        club1: 'carlton', club2: 'collingwood', page: bad,
      });
      expect(state.params.page, bad).toBe(1);
      expect(state.notices.some((n) => n.field === 'page'), bad).toBe(true);
    }
  });

  it('preserves a page beyond the last one and reports honest totals', async () => {
    const state = await resolveClubComparisonState({
      club1: 'adelaide', club2: 'brisbane-lions', page: '99',
    });
    expect(state.params.page).toBe(99);
    if (state.kind !== 'comparison') throw new Error('pair must resolve');
    expect(state.data.meetings.page).toBe(99);
    expect(state.data.meetings.meetings).toEqual([]);
    expect(state.data.meetings.totalPages).toBe(
      Math.ceil(state.data.meetings.totalMeetings / MEETINGS_PAGE_SIZE),
    );
    expect(state.data.meetings.hasNextPage).toBe(false);
  });

  it('does not let the page change the head-to-head population', async () => {
    const [first, deep] = await Promise.all([
      resolveClubComparisonState({ club1: 'carlton', club2: 'collingwood' }),
      resolveClubComparisonState({ club1: 'carlton', club2: 'collingwood', page: '3' }),
    ]);
    if (first.kind !== 'comparison' || deep.kind !== 'comparison') {
      throw new Error('pair must resolve');
    }
    expect(deep.data.summary).toEqual(first.data.summary);
    expect(deep.data.meetings.totalMeetings).toBe(first.data.meetings.totalMeetings);
  });
});

describe('Stage 7 route state: rejected pairs', () => {
  it('rejects the same organisation before any comparison query', async () => {
    const state = await resolveClubComparisonState({
      club1: 'western-bulldogs', club2: 'western-bulldogs',
    });
    expect(state.kind).toBe('same-organization');
    expect('data' in state).toBe(false);
    expect(state.noindex).toBe(true);
    expect(state.notices.some((n) => n.message === 'Choose two different clubs.')).toBe(true);
  });

  it('rejects a historical identity of a continuing organisation as a club', async () => {
    // `footscray` is an identity, not an organisation, so it cannot be
    // compared against the organisation that continues it.
    const state = await resolveClubComparisonState({
      club1: 'footscray', club2: 'western-bulldogs',
    });
    expect(state.kind).toBe('invalid-club');
    expect('data' in state).toBe(false);
  });

  it('fails safely on an unknown or malformed slug', async () => {
    for (const bad of ['not-a-club', 'Carlton Football Club!', '../../etc/passwd']) {
      const state = await resolveClubComparisonState({ club1: bad, club2: 'carlton' });
      expect(state.kind, bad).toBe('invalid-club');
      expect('data' in state, bad).toBe(false);
      expect(state.noindex, bad).toBe(true);
      if (state.kind !== 'invalid-club') continue;
      expect(state.invalidSlugs).toEqual([bad]);
      // Still enough state to render the selectors and explain the problem.
      expect(state.options.organizations.length).toBeGreaterThan(0);
      expect(state.notices.some((n) => n.field === 'club')).toBe(true);
    }
  });

  it('names both slugs when neither resolves', async () => {
    const state = await resolveClubComparisonState({ club1: 'nope-one', club2: 'nope-two' });
    if (state.kind !== 'invalid-club') throw new Error('expected invalid-club');
    expect(state.invalidSlugs).toEqual(['nope-one', 'nope-two']);
  });
});

describe('Stage 7 canonical metadata', () => {
  it('canonicalises a valid pair to the alphabetical pair only', async () => {
    const [forward, reversed] = await Promise.all([
      resolveClubComparisonMetadata({
        club1: 'brisbane-lions', club2: 'adelaide',
        season: String(historicalSeason), matchType: 'finals', page: '4',
      }),
      resolveClubComparisonMetadata({ club1: 'adelaide', club2: 'brisbane-lions' }),
    ]);

    const canonical = '/clubs/compare?club1=adelaide&club2=brisbane-lions';
    expect(forward.canonicalPath).toBe(canonical);
    expect(reversed.canonicalPath).toBe(canonical);
    expect(forward.canonicalPath).not.toContain('season');
    expect(forward.canonicalPath).not.toContain('matchType');
    expect(forward.canonicalPath).not.toContain('page');
    expect(forward.noindex).toBe(false);
    // Organisation names, not slugs.
    expect(forward.title).toContain('Brisbane Lions');
    expect(forward.title).toContain('Adelaide');
  });

  it('canonicalises the bare surface to /clubs/compare', async () => {
    for (const params of [{}, { club1: 'carlton' }]) {
      const meta = await resolveClubComparisonMetadata(params);
      expect(meta.canonicalPath).toBe('/clubs/compare');
      expect(meta.noindex).toBe(false);
    }
  });

  it('marks invalid and same-organisation pairs noindex,follow with no pair canonical', async () => {
    const cases = [
      { club1: 'not-a-club', club2: 'carlton' },
      { club1: 'carlton', club2: 'carlton' },
      { club1: 'footscray', club2: 'western-bulldogs' },
    ];
    for (const params of cases) {
      const meta = await resolveClubComparisonMetadata(params);
      expect(meta.noindex, JSON.stringify(params)).toBe(true);
      expect(meta.canonicalPath, JSON.stringify(params)).toBe('/clubs/compare');
    }
  });
});

/**
 * AFLDB-ISSUE-144 Stage 7 route budget.
 *
 * This measures `resolveClubComparisonState` — the exact work a request
 * to /clubs/compare does, from raw query string to loaded state — rather
 * than a hand-assembled `Promise.all`, so the number moves if the route's
 * own sequencing regresses.
 *
 * It is NOT an HTTP measurement and it is NOT taken on the supported
 * Linux runtime: it runs on the developer workstation over a forwarded
 * database connection, which adds per-statement latency. That makes it
 * conservative against the 1.5 s ceiling but leaves the Linux route
 * recheck outstanding (see the Stage 7 log in AFLDB-ISSUE-144.md). The
 * same test run on Linux is the recheck.
 */
describe('Stage 7 route budget', () => {
  const ROUTE_CEILING_MS = 1_500;
  const WARMUP_RUNS = 2;
  const MEASURED_RUNS = 5;

  const pairs: Array<[string, string]> = [
    ['adelaide', 'brisbane-lions'],
    ['carlton', 'collingwood'],
  ];

  for (const [club1, club2] of pairs) {
    it(`loads ${club1} vs ${club2} inside the route budget`, async () => {
      const params = { club1, club2 };
      for (let i = 0; i < WARMUP_RUNS; i += 1) await resolveClubComparisonState(params);

      const samples: number[] = [];
      for (let i = 0; i < MEASURED_RUNS; i += 1) {
        const started = performance.now();
        const state = await resolveClubComparisonState(params);
        samples.push(performance.now() - started);
        expect(state.kind).toBe('comparison');
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)];
      console.log(
        `[ISSUE-144 Stage 7] ${club1}/${club2} route state warm min/median/max = `
        + `${samples[0].toFixed(1)}/${median.toFixed(1)}/${samples[samples.length - 1].toFixed(1)} ms`,
      );
      expect(median, `${club1}/${club2} warm median ${median.toFixed(1)} ms`)
        .toBeLessThan(ROUTE_CEILING_MS);
    }, 120_000);
  }
});

/**
 * AFLDB-ISSUE-144 Stage 9 — the metadata the ROUTE emits.
 *
 * Stage 7 proved `resolveClubComparisonMetadata`. What a crawler reads is
 * the Next `Metadata` object `generateMetadata` returns after that helper
 * has been through `pageMetadata`, and nothing until now asserted the two
 * agree: a canonical dropped on the way out, or a `robots` directive that
 * never reached the head, would have passed every Stage 7 test.
 */
describe('Stage 9 rendered route metadata', () => {
  const meta = (params: Record<string, string>) =>
    generateMetadata({ searchParams: Promise.resolve(params) });

  it('canonicalises the bare surface and leaves it indexable', async () => {
    const result = await meta({});
    expect(result.alternates?.canonical).toBe('/clubs/compare');
    expect(result.robots).toBeUndefined();
    expect(result.title).toBeTruthy();
    expect(result.description).toBeTruthy();
  });

  it('emits one alphabetical canonical for a pair in either order', async () => {
    const canonical = '/clubs/compare?club1=adelaide&club2=brisbane-lions';
    const forward = await meta({ club1: 'adelaide', club2: 'brisbane-lions' });
    const reversed = await meta({ club1: 'brisbane-lions', club2: 'adelaide' });

    expect(forward.alternates?.canonical).toBe(canonical);
    expect(reversed.alternates?.canonical).toBe(canonical);
    expect(forward.robots).toBeUndefined();
    expect(reversed.robots).toBeUndefined();
    // og:url follows the canonical rather than the requested order.
    expect(forward.openGraph && 'url' in forward.openGraph && forward.openGraph.url)
      .toBe(canonical);
  });

  it('keeps season, match filter and page out of the canonical', async () => {
    const result = await meta({
      club1: 'brisbane-lions',
      club2: 'adelaide',
      season: String(historicalSeason),
      matchType: 'finals',
      page: '3',
    });
    expect(result.alternates?.canonical)
      .toBe('/clubs/compare?club1=adelaide&club2=brisbane-lions');
  });

  it('marks invalid and same-organisation states noindex, follow', async () => {
    for (const params of [
      { club1: 'not-a-club', club2: 'adelaide' },
      { club1: 'adelaide', club2: 'adelaide' },
      { club1: 'footscray', club2: 'western-bulldogs' },
    ]) {
      const result = await meta(params);
      expect(result.robots, JSON.stringify(params))
        .toEqual({ index: false, follow: true });
      expect(result.alternates?.canonical, JSON.stringify(params))
        .toBe('/clubs/compare');
    }
  });
});

/**
 * AFLDB-ISSUE-144 Stage 9 — the seeded link on /clubs/[slug].
 *
 * That page links to `/clubs/compare?club1=<current identity slug>`, which
 * is only correct because a club's current identity slug IS its
 * organisation's slug — that is the mapping, and no special table exists.
 * If a future identity or organisation slug diverges, the club page would
 * quietly start seeding an invalid-club state, so the mapping is pinned
 * here rather than assumed.
 */
describe('Stage 9 club page comparison seed', () => {
  it('seeds an organisation slug from every club row', async () => {
    const clubs = await sql<{ slug: string; seed: string }[]>`
      SELECT c.slug, ci.slug AS seed
        FROM clubs c
        JOIN clubs ci ON ci.id = c.current_identity_id
       ORDER BY c.slug
    `;
    expect(clubs.length).toBeGreaterThan(0);

    for (const club of clubs) {
      const state = await resolveClubComparisonState({ club1: club.seed });
      // No second club, so this is the landing state -- but an unresolvable
      // club1 would make it `invalid-club` instead.
      expect(state.kind, `${club.slug} seeds ${club.seed}`).toBe('unselected');
    }
  });
});
