/**
 * Catalogue lookups on request-supplied keys.
 *
 * Two fixed catalogues are indexed by a value that came from outside: the
 * dataset key on an upload (a form field, or the subject line of an emailed
 * CSV) and the record-category slug in a /records/<slug> URL. Both are trust
 * boundaries, so these tests are about what the lookups refuse as much as
 * what they return.
 *
 * The regression they guard: a plain `CATALOGUE[key]` index also finds
 * properties inherited from Object.prototype, and every one of them is
 * truthy. That made the `if (!spec)` / `if (!definition)` guards passable
 * with a key like "constructor" — the guard let it through and the next line
 * read a field off Object's constructor, turning a clean rejection into a
 * 500 (or, for /records, a garbage page instead of a 404). Both lookups now
 * use Object.hasOwn, the same discipline the search specs already apply to
 * their own catalogues (isGridStatKey, isPlayerSort).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { DATASETS, getDataset } from '@/lib/ingest/datasets';

// db/queries/records.ts imports @/db/client, which throws at module load
// without DATABASE_URL. postgres.js connects lazily, so a placeholder is
// enough for tests that only read the category catalogue and never issue a
// query. Set only when absent, so a full run against afldb_test keeps the
// real value tests/setup.ts puts here.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/afldb_unit_placeholder';

const { RECORD_CATEGORIES, getCareerRecord, getRecordCategory } = await import('@/db/queries/records');

/**
 * Truthy when read off a plain object index, so each one used to pass a
 * `if (!result)` guard.
 */
const INHERITED_KEYS = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  '__proto__',
  '__defineGetter__',
  'isPrototypeOf',
  'propertyIsEnumerable',
];

describe('getDataset', () => {
  it('returns the spec for every registered dataset', () => {
    const keys = Object.keys(DATASETS);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(getDataset(key)).toBe(DATASETS[key]);
    }
  });

  it('returns null for an unregistered key', () => {
    expect(getDataset('not_a_dataset')).toBeNull();
    expect(getDataset('')).toBeNull();
  });

  it('returns null for inherited Object properties', () => {
    for (const key of INHERITED_KEYS) {
      expect(getDataset(key)).toBeNull();
    }
  });

  it('matches keys exactly, ignoring case and whitespace variants', () => {
    // The intake route does not normalise the key, so neither does the lookup.
    expect(getDataset('MATCH_RESULTS')).toBeNull();
    expect(getDataset(' match_results')).toBeNull();
    expect(getDataset('match_results ')).toBeNull();
  });
});

describe('getCareerRecord category guard', () => {
  it('rejects inherited Object properties before attempting SQL', async () => {
    for (const category of INHERITED_KEYS) {
      await expect(getCareerRecord(category)).resolves.toEqual([]);
    }
  });
});

describe('getRecordCategory', () => {
  it('returns the category for every registered slug', () => {
    const slugs = Object.keys(RECORD_CATEGORIES);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(getRecordCategory(slug)).toBe(RECORD_CATEGORIES[slug]);
    }
  });

  it('returns null for an unregistered slug', () => {
    expect(getRecordCategory('most-hugs')).toBeNull();
    expect(getRecordCategory('')).toBeNull();
  });

  it('returns null for inherited Object properties', () => {
    // /records/constructor must reach notFound(), not render.
    for (const slug of INHERITED_KEYS) {
      expect(getRecordCategory(slug)).toBeNull();
    }
  });
});

/*
 * AFLDB-ISSUE-281: the public match-log and draft sort keys. The guards used
 * `in`, which admits an inherited key; the admitted value is a function, and
 * its source text was interpolated into ORDER BY through sql.unsafe, so
 * `?sort=constructor` turned the page into a PostgreSQL syntax error instead
 * of the default order.
 *
 * The queries are exercised against a recording stand-in for @/db/client, so
 * the ORDER BY each one would send can be read without a database. doMock
 * applies only to modules loaded after it, so records.ts above keeps the real
 * (lazily connecting) client and its "before attempting SQL" case stays strict.
 */
type Recorded = { strings: readonly string[]; values: unknown[] };
const recordedQueries: Recorded[] = [];
/** AFLDB-ISSUE-344: results for the next awaited statements, in order; empty means the default row. */
const scriptedResults: unknown[][] = [];

function fakeFragment(strings: readonly string[], values: unknown[]) {
  const fragment: Recorded & PromiseLike<unknown[]> = {
    strings,
    values,
    // One row with a window total, so each query returns after its first statement.
    then: (resolve, reject) => Promise.resolve(scriptedResults.shift() ?? [{ total: '1' }]).then(resolve, reject),
  };
  return fragment;
}

const fakeSql = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const fragment = fakeFragment(strings, values);
    recordedQueries.push(fragment);
    return fragment;
  },
  { unsafe: (text: string) => ({ unsafeText: text }) },
);

/**
 * Fragments built by modules that loaded the real client first (filters.ts, through
 * records.ts above) are real postgres.js queries, which keep their parameters in `args`
 * rather than `values`; both shapes are rendered.
 */
function parts(value: unknown): { strings: readonly string[]; values: unknown[] } | null {
  if (!value || typeof value !== 'object' || !('strings' in value)) return null;
  const v = value as { strings: readonly string[]; values?: unknown[]; args?: unknown[] };
  const values = Array.isArray(v.values) ? v.values : Array.isArray(v.args) ? v.args : null;
  return values ? { strings: v.strings, values } : null;
}

function render(value: unknown): string {
  if (value && typeof value === 'object' && 'unsafeText' in value) return String(value.unsafeText);
  const p = parts(value);
  if (p) return p.strings.reduce((text, part, i) => text + part + (i < p.values.length ? render(p.values[i]) : ''), '');
  return '$?';
}

/** Every bound (non-fragment) value of a recorded statement, depth first. */
function leafValues(value: unknown): unknown[] {
  const p = parts(value);
  if (p) return p.values.flatMap(leafValues);
  if (value && typeof value === 'object' && 'unsafeText' in value) return [];
  return [value];
}

/** The ORDER BY clause of the last top-level statement, whitespace collapsed. */
function lastOrderBy(): string {
  const text = render(recordedQueries.at(-1)).replace(/\s+/g, ' ');
  const match = /ORDER BY (.*?) LIMIT /.exec(text);
  if (!match) throw new Error(`no ORDER BY in: ${text}`);
  return match[1];
}

vi.doMock('@/db/client', () => ({ sql: fakeSql }));
const { PLAYER_MATCH_SORTS, getPlayerMatches, isPlayerMatchSort, isPlayerMatchSortDir } = await import(
  '@/db/queries/players'
);
const {
  DRAFT_SORTS, getDraftCategoryCounts, isDraftSort, isDraftSortDir, listDraftPicks,
} = await import('@/db/queries/draft');
const {
  DRAFT_CATEGORIES, DRAFT_KIND_RANK_SQL, draftEventLabel, draftYearViewPath, parseDraftView, selectionLabel,
} = await import('@/lib/draft-categories');

describe('isPlayerMatchSort and isDraftSort', () => {
  it('accept every declared sort key', () => {
    expect(Object.keys(PLAYER_MATCH_SORTS).length).toBeGreaterThan(0);
    for (const key of Object.keys(PLAYER_MATCH_SORTS)) expect(isPlayerMatchSort(key)).toBe(true);
    expect(Object.keys(DRAFT_SORTS).length).toBeGreaterThan(0);
    for (const key of Object.keys(DRAFT_SORTS)) expect(isDraftSort(key)).toBe(true);
  });

  it('refuse inherited Object properties', () => {
    for (const key of INHERITED_KEYS) {
      expect(isPlayerMatchSort(key)).toBe(false);
      expect(isDraftSort(key)).toBe(false);
    }
  });

  it('refuse absent, empty, unknown and case-variant keys', () => {
    for (const key of [undefined, '', 'nope', 'DATE', ' g']) expect(isPlayerMatchSort(key)).toBe(false);
    for (const key of [undefined, '', 'nope', 'PICK', ' year']) expect(isDraftSort(key)).toBe(false);
  });
});

describe('match-log and draft ORDER BY', () => {
  const PLAYER_DEFAULT = 'm.match_date DESC, m.id DESC';
  // AFLDB-ISSUE-336: category order, pick WITHIN the category, name, then id, so pages are stable.
  const DRAFT_DEFAULT =
    `dp.draft_year DESC, ${DRAFT_KIND_RANK_SQL}, dp.pick_number NULLS LAST, COALESCE(p.sort_name, dp.player_name_raw), dp.id`;
  const draftFilters = { page: 1, pageSize: 50 };

  it('uses the declared column for a valid sort key and direction', async () => {
    await getPlayerMatches(1, { limit: 10, offset: 0, sort: 'g', dir: 'asc' });
    expect(lastOrderBy()).toBe(`s.goals ASC NULLS LAST, ${PLAYER_DEFAULT}`);
    await listDraftPicks({ ...draftFilters, sort: 'player', dir: 'desc' });
    expect(lastOrderBy()).toBe(`COALESCE(p.sort_name, dp.player_name_raw) DESC NULLS LAST, ${DRAFT_DEFAULT}`);
  });

  it('AFLDB-ISSUE-336: a pick sort stays inside each category and a type sort is category order', async () => {
    await listDraftPicks({ ...draftFilters, sort: 'pick', dir: 'desc' });
    expect(lastOrderBy()).toBe(`${DRAFT_KIND_RANK_SQL}, dp.pick_number DESC NULLS LAST, ${DRAFT_DEFAULT}`);
    await listDraftPicks({ ...draftFilters, sort: 'type', dir: 'asc' });
    expect(lastOrderBy()).toBe(`${DRAFT_KIND_RANK_SQL} ASC NULLS LAST, ${DRAFT_DEFAULT}`);
    expect(DRAFT_SORTS.type).not.toContain('draft_type');
  });

  it('AFLDB-ISSUE-336: filters by canonical category and by the Father–Son signing kind', async () => {
    await listDraftPicks({ ...draftFilters, year: 2025, kind: 'rookie' });
    let text = render(recordedQueries.at(-1)).replace(/\s+/g, ' ');
    expect(text).toContain('dp.draft_kind = $?');
    expect(text).not.toContain('dp.signing_kind = $?');
    expect(leafValues(recordedQueries.at(-1))).toEqual(expect.arrayContaining([2025, 'rookie']));

    await listDraftPicks({ ...draftFilters, year: 2021, fatherSon: true });
    text = render(recordedQueries.at(-1)).replace(/\s+/g, ' ');
    expect(text).toContain('dp.signing_kind = $?');
    expect(text).not.toContain('dp.draft_kind = $?');
    expect(leafValues(recordedQueries.at(-1))).toEqual(expect.arrayContaining([2021, 'Father-Son']));
  });

  it('AFLDB-ISSUE-337: a name search canonicalises Unicode spaces on both sides of the match', async () => {
    const { UNICODE_SPACE_SEPARATORS, UNICODE_SPACE_REPLACEMENTS } = await import('@/lib/like');
    for (const q of ['Jake Long', 'Jake Long']) {
      await listDraftPicks({ ...draftFilters, year: 2014, q });
      const text = render(recordedQueries.at(-1)).replace(/\s+/g, ' ');
      expect(text).toContain('translate(dp.player_name_raw, $?::text, $?::text) ILIKE $?');
      expect(text).toContain('translate(p.display_name, $?::text, $?::text) ILIKE $?');
      const values = leafValues(recordedQueries.at(-1));
      // The typed term reaches the pattern with ordinary spaces, whichever space it was typed with.
      expect(values).toContain('%Jake Long%');
      expect(values).not.toContain('%Jake Long%');
      expect(values).toEqual(expect.arrayContaining([UNICODE_SPACE_SEPARATORS, UNICODE_SPACE_REPLACEMENTS]));
    }
    // The per-category counts share the same condition, so a tab count agrees with its list.
    await getDraftCategoryCounts({ year: 2014, q: 'Jake Long' });
    expect(render(recordedQueries.at(-1)).replace(/\s+/g, ' '))
      .toContain('translate(dp.player_name_raw, $?::text, $?::text) ILIKE $?');
  });

  it('falls back to the default order for constructor and toString', async () => {
    for (const sort of ['constructor', 'toString']) {
      for (const dir of ['asc', 'desc']) {
        await getPlayerMatches(1, { limit: 10, offset: 0, sort, dir });
        expect(lastOrderBy()).toBe(PLAYER_DEFAULT);
        await listDraftPicks({ ...draftFilters, sort, dir });
        expect(lastOrderBy()).toBe(DRAFT_DEFAULT);
      }
    }
  });

  it('keeps the existing fallback for an unknown key, a missing key or an invalid direction', async () => {
    expect(isPlayerMatchSortDir('up')).toBe(false);
    expect(isDraftSortDir(undefined)).toBe(false);
    for (const [sort, dir] of [['nope', 'asc'], [undefined, 'asc'], ['g', 'up'], ['g', undefined]] as const) {
      await getPlayerMatches(1, { limit: 10, offset: 0, sort, dir });
      expect(lastOrderBy()).toBe(PLAYER_DEFAULT);
    }
    for (const [sort, dir] of [['nope', 'asc'], [undefined, 'asc'], ['pick', 'up'], ['pick', undefined]] as const) {
      await listDraftPicks({ ...draftFilters, sort, dir });
      expect(lastOrderBy()).toBe(DRAFT_DEFAULT);
    }
  });
});

/*
 * AFLDB-ISSUE-344: the total came only from `count(*) OVER ()` on the returned rows, so a page
 * past the last one (no rows) reported zero matches for a nonempty result. The fallback count
 * runs only for that empty past-the-end page, with the page query's own WHERE.
 */
describe('AFLDB-ISSUE-344 draft list total past the last page', () => {
  const whereOf = (text: string): string => {
    const match = /WHERE (.*?)(?: ORDER BY .*)?$/.exec(text);
    if (!match) throw new Error(`no WHERE in: ${text}`);
    return match[1].trim();
  };
  const textOf = (q: Recorded | undefined) => render(q).replace(/\s+/g, ' ').trim();
  const filters = {
    year: 2025, kind: 'rookie', clubSlug: 'carlton', q: 'Jake Long', sort: 'pick', dir: 'asc', pageSize: 50,
  };

  it('a page beyond the final one reports the true total, counted with identical predicates', async () => {
    scriptedResults.push([], [{ total: '73' }]);
    const before = recordedQueries.length;
    const result = await listDraftPicks({ ...filters, page: 3 });
    expect(result).toEqual({ rows: [], total: 73 });

    const top = recordedQueries.slice(before).filter((q) => /\bFROM draft_picks dp\b/.test(textOf(q)));
    expect(top).toHaveLength(2);
    const [pageQuery, countQuery] = top.map(textOf);
    expect(countQuery).toMatch(/^SELECT count\(\*\) AS total FROM draft_picks dp /);
    expect(countQuery).not.toContain('LIMIT');
    // Same joins and the same WHERE text; the bound values are the page's minus LIMIT/OFFSET.
    expect(countQuery.slice(countQuery.indexOf('FROM'), countQuery.indexOf(' WHERE ')))
      .toBe(pageQuery.slice(pageQuery.indexOf('FROM'), pageQuery.indexOf(' WHERE ')));
    expect(whereOf(countQuery)).toBe(whereOf(pageQuery).replace(/ LIMIT .*$/, ''));
    expect(leafValues(top[1])).toEqual(leafValues(top[0]).slice(0, -2));
    expect(leafValues(top[0]).slice(-2)).toEqual([50, 100]);
    scriptedResults.length = 0;
  });

  it('a past-the-end page whose filters now match nothing is still zero', async () => {
    scriptedResults.push([], [{ total: '0' }]);
    expect(await listDraftPicks({ ...filters, page: 4 })).toEqual({ rows: [], total: 0 });
    scriptedResults.length = 0;
  });

  it('page one with no rows is a genuine no-match and issues no second statement', async () => {
    scriptedResults.push([]);
    const before = recordedQueries.length;
    expect(await listDraftPicks({ ...filters, page: 1 })).toEqual({ rows: [], total: 0 });
    const statements = recordedQueries.slice(before).filter((q) => /\bFROM draft_picks dp\b/.test(textOf(q)));
    expect(statements).toHaveLength(1);
    scriptedResults.length = 0;
  });

  it('a normal nonempty page takes its total from the window count and never runs the fallback', async () => {
    const before = recordedQueries.length;
    const result = await listDraftPicks({ ...filters, page: 2 });
    expect(result.total).toBe(1);
    const statements = recordedQueries.slice(before).filter((q) => /\bFROM draft_picks dp\b/.test(textOf(q)));
    expect(statements).toHaveLength(1);
    expect(textOf(statements[0])).toContain('count(*) OVER () AS total');
  });
});

/*
 * AFLDB-ISSUE-336: the draft category catalogue. `view` is request-supplied, and a pick
 * number is only meaningful inside its category: National pick 1 and Rookie pick 1 are
 * different selections, unnumbered acquisitions stay unnumbered, and Father–Son is a
 * signing mechanism that keeps the real category rather than a category of its own.
 */
describe('AFLDB-ISSUE-336 draft categories', () => {
  it('enumerates exactly the kinds of the tracked DraftGuru event contract', () => {
    const contract = JSON.parse(readFileSync(join(process.cwd(), 'data', 'reference', 'draftguru-event-kinds.json'), 'utf8')) as {
      events: { draft_kind: string }[]; absent_column: { draft_kind: string };
    };
    const kinds = new Set([...contract.events.map((e) => e.draft_kind), contract.absent_column.draft_kind]);
    expect(new Set(DRAFT_CATEGORIES.map((c) => c.kind))).toEqual(kinds);
    expect(new Set(DRAFT_CATEGORIES.map((c) => c.slug)).size).toBe(DRAFT_CATEGORIES.length);
    for (const c of DRAFT_CATEGORIES) expect(DRAFT_KIND_RANK_SQL).toContain(`WHEN '${c.kind}' THEN`);
  });

  it('opens the named view and treats unknown, inherited or empty values as All', () => {
    expect(parseDraftView('rookie')).toMatchObject({ type: 'category', category: { kind: 'rookie' } });
    expect(parseDraftView('pre-season')).toMatchObject({ type: 'category', category: { kind: 'preseason' } });
    expect(parseDraftView('father-son')).toEqual({ type: 'father-son' });
    for (const value of [undefined, '', 'all', 'Rookie', 'preseason', ...INHERITED_KEYS]) {
      expect(parseDraftView(value)).toEqual({ type: 'all' });
    }
  });

  it('labels a pick within its own category and never numbers an unnumbered acquisition', () => {
    const fred = { draftYear: 2025, draftKind: 'rookie', draftType: 'Rookie', pickNumber: 1, signingKind: null };
    const willem = { draftYear: 2025, draftKind: 'national', draftType: 'National', pickNumber: 1, signingKind: null };
    const nick = { draftYear: 2021, draftKind: 'national', draftType: 'National', pickNumber: 4, signingKind: 'Father-Son' };
    expect(draftEventLabel(fred)).toBe('2025 Rookie Draft — Pick 1');
    expect(draftEventLabel(willem)).toBe('2025 National Draft — Pick 1');
    expect(selectionLabel(fred)).not.toBe(selectionLabel(willem));
    expect(selectionLabel(nick)).toBe('National — Pick 4 — Father–Son');
    expect(selectionLabel({ draftKind: 'pre_draft', draftType: 'Pre-Draft', pickNumber: null, signingKind: 'Father-Son' }))
      .toBe('Pre-Draft — Father–Son');
    expect(selectionLabel({ draftKind: 'rookie', draftType: 'Rookie', pickNumber: 12, signingKind: 'Father-Son' }))
      .toBe('Rookie — Pick 12 — Father–Son');
    expect(selectionLabel({ draftKind: 'trade', draftType: 'Trade', pickNumber: null })).toBe('Trade');
    expect(draftEventLabel({ draftYear: 1987, draftKind: 'national', draftType: 'National Draft', pickNumber: 3 }))
      .toBe('1987 National Draft — Pick 3');
    // An unknown kind keeps the source's own label rather than being merged into another category.
    expect(selectionLabel({ draftKind: 'mystery', draftType: 'Mystery Draft', pickNumber: 2 })).toBe('Mystery Draft — Pick 2');
    expect(draftYearViewPath(2025, 'rookie')).toBe('/draft/2025?view=rookie');
    expect(draftYearViewPath(2025, 'mystery')).toBe('/draft/2025');
  });
});
