import { describe, expect, it } from 'vitest';

import {
  type FilterField,
  describeFilters,
  fieldValue,
  filterQueryParams,
  filterSearchParams,
  parseFilterValues,
} from '@/search/table-filters';

/**
 * The filter parser is the boundary between a URL anyone can write and
 * the SQL builders, so these tests are about what it refuses as much as
 * what it accepts.
 */

const FIELDS: FilterField[] = [
  { kind: 'range', key: 'games', label: 'Games', min: 0, max: 1000 },
  { kind: 'text', key: 'name', label: 'Name', maxLength: 10 },
  {
    kind: 'select',
    key: 'club',
    label: 'Club',
    options: [
      { value: 'carlton', label: 'Carlton' },
      { value: 'fitzroy', label: 'Fitzroy' },
    ],
  },
  {
    kind: 'multi',
    key: 'state',
    label: 'State',
    max: 2,
    options: [
      { value: 'VIC', label: 'Victoria' },
      { value: 'SA', label: 'South Australia' },
      { value: 'WA', label: 'Western Australia' },
    ],
  },
];

describe('parseFilterValues', () => {
  it('reads a range from its min and max parameters', () => {
    const values = parseFilterValues(FIELDS, { games_min: '100', games_max: '200' });
    expect(values.range.games).toEqual({ min: 100, max: 200 });
    expect(values.active).toBe(1);
    expect(values.errors).toEqual([]);
  });

  it('clamps a range to the field bounds rather than erroring', () => {
    const values = parseFilterValues(FIELDS, { games_min: '-50', games_max: '99999' });
    expect(values.range.games).toEqual({ min: 0, max: 1000 });
  });

  it('truncates a fractional bound to a whole number', () => {
    const values = parseFilterValues(FIELDS, { games_min: '10.9' });
    expect(values.range.games).toEqual({ min: 10, max: undefined });
  });

  it('reports a minimum above its maximum and applies neither', () => {
    const values = parseFilterValues(FIELDS, { games_min: '200', games_max: '100' });
    expect(values.range.games).toBeUndefined();
    expect(values.errors).toHaveLength(1);
    expect(values.errors[0]).toContain('Games');
    expect(values.active).toBe(0);
  });

  it('ignores a non-numeric bound', () => {
    const values = parseFilterValues(FIELDS, { games_min: 'DROP TABLE players' });
    expect(values.range.games).toBeUndefined();
    expect(values.active).toBe(0);
  });

  it('drops a select value that is not in the allowlist', () => {
    const values = parseFilterValues(FIELDS, { club: "carlton'; DELETE FROM clubs --" });
    expect(values.select.club).toBeUndefined();
    expect(values.active).toBe(0);
  });

  it('keeps a select value that is in the allowlist', () => {
    const values = parseFilterValues(FIELDS, { club: 'fitzroy' });
    expect(values.select.club).toBe('fitzroy');
  });

  it('caps a text value at the field length', () => {
    const values = parseFilterValues(FIELDS, { name: 'abcdefghijklmnop' });
    expect(values.text.name).toBe('abcdefghij');
  });

  it('treats whitespace-only text as absent', () => {
    const values = parseFilterValues(FIELDS, { name: '   ' });
    expect(values.text.name).toBeUndefined();
    expect(values.active).toBe(0);
  });

  it('filters a multi-select to allowlisted values and caps the count', () => {
    const values = parseFilterValues(FIELDS, { state: ['VIC', 'QLD', 'SA', 'WA'] });
    expect(values.multi.state).toEqual(['VIC', 'SA']);
  });

  it('accepts a single repeated parameter as a one-element list', () => {
    const values = parseFilterValues(FIELDS, { state: 'SA' });
    expect(values.multi.state).toEqual(['SA']);
  });

  it('ignores parameters it does not know', () => {
    const values = parseFilterValues(FIELDS, { unknown: 'x', games_min: '5' });
    expect(values.active).toBe(1);
    expect(values.range.games).toEqual({ min: 5, max: undefined });
  });

  it('counts each applied filter once', () => {
    const values = parseFilterValues(FIELDS, {
      games_min: '10', games_max: '20', name: 'ablett', club: 'carlton', state: 'VIC',
    });
    expect(values.active).toBe(4);
  });
});

describe('round-tripping a filter through the URL', () => {
  it('rebuilds only the parameters that were applied', () => {
    const values = parseFilterValues(FIELDS, {
      games_min: '10', name: 'smith', club: 'carlton', state: ['VIC', 'SA'],
    });
    expect(filterQueryParams(FIELDS, values)).toEqual({
      games_min: '10', name: 'smith', club: 'carlton', state: ['VIC', 'SA'],
    });
  });

  it('never carries the page number, so a new filter starts at page one', () => {
    const values = parseFilterValues(FIELDS, { games_min: '10', page: '7' });
    expect(filterQueryParams(FIELDS, values)).not.toHaveProperty('page');
  });

  it('repeats a multi-select key in the query string', () => {
    const values = parseFilterValues(FIELDS, { state: ['VIC', 'SA'] });
    expect(filterSearchParams(FIELDS, values).toString()).toBe('state=VIC&state=SA');
  });

  it('appends extra parameters without losing a repeated key', () => {
    const values = parseFilterValues(FIELDS, { state: ['VIC', 'SA'] });
    expect(filterSearchParams(FIELDS, values, { sort: 'goals' }).toString())
      .toBe('state=VIC&state=SA&sort=goals');
  });

  it('drops an undefined extra rather than writing it as a value', () => {
    const values = parseFilterValues(FIELDS, { games_min: '10' });
    expect(filterSearchParams(FIELDS, values, { sort: undefined }).toString())
      .toBe('games_min=10');
  });

  it('shows the clamped value in the control, not the value typed', () => {
    const values = parseFilterValues(FIELDS, { games_min: '99999' });
    expect(fieldValue(values, FIELDS[0], 'min')).toBe('1000');
  });
});

describe('describeFilters', () => {
  it('describes a two-sided range as a span', () => {
    const values = parseFilterValues(FIELDS, { games_min: '100', games_max: '200' });
    expect(describeFilters(FIELDS, values)).toEqual(['Games 100–200']);
  });

  it('describes one-sided ranges with an inequality', () => {
    expect(describeFilters(FIELDS, parseFilterValues(FIELDS, { games_min: '100' })))
      .toEqual(['Games ≥ 100']);
    expect(describeFilters(FIELDS, parseFilterValues(FIELDS, { games_max: '200' })))
      .toEqual(['Games ≤ 200']);
  });

  it('uses the option label rather than the stored value', () => {
    const values = parseFilterValues(FIELDS, { club: 'fitzroy', state: ['VIC'] });
    expect(describeFilters(FIELDS, values)).toEqual(['Club: Fitzroy', 'State: Victoria']);
  });

  it('describes nothing when nothing is applied', () => {
    expect(describeFilters(FIELDS, parseFilterValues(FIELDS, {}))).toEqual([]);
  });
});
