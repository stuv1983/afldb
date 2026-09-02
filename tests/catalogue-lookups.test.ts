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
import { describe, expect, it } from 'vitest';

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
