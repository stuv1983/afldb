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

function fakeFragment(strings: readonly string[], values: unknown[]) {
  const fragment: Recorded & PromiseLike<unknown[]> = {
    strings,
    values,
    // One row with a window total, so each query returns after its first statement.
    then: (resolve, reject) => Promise.resolve([{ total: '1' }]).then(resolve, reject),
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

function render(value: unknown): string {
  if (value && typeof value === 'object' && 'unsafeText' in value) return String(value.unsafeText);
  if (value && typeof value === 'object' && 'strings' in value && 'values' in value) {
    const { strings, values } = value as Recorded;
    return strings.reduce((text, part, i) => text + part + (i < values.length ? render(values[i]) : ''), '');
  }
  return '$?';
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
const { DRAFT_SORTS, isDraftSort, isDraftSortDir, listDraftPicks } = await import('@/db/queries/draft');

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
  const DRAFT_DEFAULT = 'dp.draft_year DESC, dp.pick_number NULLS LAST';
  const draftFilters = { page: 1, pageSize: 50 };

  it('uses the declared column for a valid sort key and direction', async () => {
    await getPlayerMatches(1, { limit: 10, offset: 0, sort: 'g', dir: 'asc' });
    expect(lastOrderBy()).toBe(`s.goals ASC NULLS LAST, ${PLAYER_DEFAULT}`);
    await listDraftPicks({ ...draftFilters, sort: 'pick', dir: 'desc' });
    expect(lastOrderBy()).toBe(`dp.pick_number DESC NULLS LAST, ${DRAFT_DEFAULT}`);
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
