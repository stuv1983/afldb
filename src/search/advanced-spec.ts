/**
 * Advanced Search query specification.
 *
 * Security model: the engine never accepts SQL. A request is parsed into
 * a typed specification whose every field, operator and sort key is
 * looked up in a fixed allowlist defined here. Column names come from
 * this table, never from user input, and all values are bound as query
 * parameters.
 *
 * This module is shared by the server query builder and the Client
 * Component form, so it must stay free of server-only imports.
 */

import { clampBound, firstValue, invertedRangeError } from '@/lib/params';
import { describeRange } from '@/search/table-filters';

export type FieldType = 'integer' | 'season';

export type FieldDefinition = {
  key: string;
  label: string;
  /** Physical column. Fixed here; never derived from user input. */
  column: string;
  type: FieldType;
  min: number;
  max: number;
  group: 'career' | 'honours' | 'span';
  help?: string;
};

/**
 * Allowlisted filter fields.
 *
 * Only statistics recorded across the whole history are exposed as
 * filters. Era-limited statistics such as disposals and tackles are
 * deliberately excluded: filtering on them would silently exclude every
 * player from before the statistic was collected, which reads as a
 * factual claim that they recorded none.
 */
export const FIELDS: Record<string, FieldDefinition> = {
  games: {
    key: 'games', label: 'Career games', column: 'c.games',
    type: 'integer', min: 0, max: 1000, group: 'career',
  },
  goals: {
    key: 'goals', label: 'Career goals', column: 'c.goals',
    type: 'integer', min: 0, max: 2000, group: 'career',
  },
  finals: {
    key: 'finals', label: 'Finals played', column: 'c.finals',
    type: 'integer', min: 0, max: 100, group: 'career',
  },
  premierships: {
    key: 'premierships', label: 'Premierships', column: 'c.premierships',
    type: 'integer', min: 0, max: 20, group: 'honours',
  },
  brownlow_votes: {
    key: 'brownlow_votes', label: 'Brownlow votes', column: 'c.brownlow_votes',
    type: 'integer', min: 0, max: 400, group: 'honours',
    help: 'Career total from the official season counts, available from 1924.',
  },
  brownlow_medals: {
    key: 'brownlow_medals', label: 'Brownlow medals', column: 'c.brownlow_medals',
    type: 'integer', min: 0, max: 10, group: 'honours',
  },
  clubs: {
    key: 'clubs', label: 'Clubs played for', column: 'c.clubs_played',
    type: 'integer', min: 1, max: 10, group: 'career',
    help: 'Counts actual clubs: a rename such as Kangaroos to North Melbourne counts once.',
  },
  seasons: {
    key: 'seasons', label: 'Seasons played', column: 'c.seasons_played',
    type: 'integer', min: 1, max: 30, group: 'career',
  },
  wins: {
    key: 'wins', label: 'Career wins', column: 'c.wins',
    type: 'integer', min: 0, max: 500, group: 'career',
  },
  debut: {
    key: 'debut', label: 'Debut season', column: 'c.debut_season',
    type: 'season', min: 1897, max: 2100, group: 'span',
  },
  final: {
    key: 'final', label: 'Final season', column: 'c.final_season',
    type: 'season', min: 1897, max: 2100, group: 'span',
  },
};

export const FIELD_KEYS = Object.keys(FIELDS);

/** Allowlisted sort keys, mapped to fixed ORDER BY fragments. */
export const SORTS: Record<string, { label: string; sql: string }> = {
  games: { label: 'Games', sql: 'c.games DESC, p.sort_name' },
  goals: { label: 'Goals', sql: 'c.goals DESC, p.sort_name' },
  finals: { label: 'Finals', sql: 'c.finals DESC, p.sort_name' },
  premierships: { label: 'Premierships', sql: 'c.premierships DESC, c.games DESC' },
  brownlow_votes: { label: 'Brownlow votes', sql: 'c.brownlow_votes DESC, p.sort_name' },
  debut: { label: 'Debut season', sql: 'c.debut_season, p.sort_name' },
  name: { label: 'Name', sql: 'p.sort_name' },
};

export const DEFAULT_SORT = 'games';

/** Abuse limits. Generous enough for research, bounded enough to be safe. */
export const LIMITS = {
  maxFilters: 20,
  maxPageSize: 100,
  defaultPageSize: 50,
  maxPage: 200,
  maxClubFilters: 5,
} as const;

export type RangeFilter = {
  field: string;
  min?: number;
  max?: number;
};

export type AdvancedQuery = {
  filters: RangeFilter[];
  clubSlugs: string[];
  sort: string;
  page: number;
  pageSize: number;
};

export type ParseResult = {
  query: AdvancedQuery;
  errors: string[];
};

function clampInt(
  raw: string | undefined,
  def: FieldDefinition,
): number | undefined {
  return clampBound(raw, def.min, def.max).value;
}

/**
 * Parse URL search parameters into a validated specification.
 *
 * Unknown parameters are ignored rather than rejected, so links stay
 * durable as the field list evolves. Out-of-range values are clamped
 * rather than erroring, so a hand-edited URL still returns something
 * sensible.
 */
export function parseAdvancedQuery(
  params: Record<string, string | string[] | undefined>,
): ParseResult {
  const errors: string[] = [];
  const first = firstValue;

  const filters: RangeFilter[] = [];
  for (const key of FIELD_KEYS) {
    const def = FIELDS[key];
    const min = clampInt(first(params[`${key}_min`]), def);
    const max = clampInt(first(params[`${key}_max`]), def);
    if (min === undefined && max === undefined) continue;

    if (min !== undefined && max !== undefined && min > max) {
      errors.push(invertedRangeError(def.label, min, max));
      continue;
    }
    filters.push({ field: key, min, max });
  }

  if (filters.length > LIMITS.maxFilters) {
    errors.push(`Too many filters; only the first ${LIMITS.maxFilters} were applied.`);
    filters.length = LIMITS.maxFilters;
  }

  const clubRaw = first(params.club);
  const clubSlugs = (clubRaw ? clubRaw.split(',') : [])
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9-]{1,80}$/.test(s))
    .slice(0, LIMITS.maxClubFilters);

  const sortRaw = first(params.sort);
  const sort = sortRaw && Object.hasOwn(SORTS, sortRaw) ? sortRaw : DEFAULT_SORT;

  const pageRaw = Number(first(params.page));
  const page = Number.isSafeInteger(pageRaw) && pageRaw >= 1
    ? Math.min(pageRaw, LIMITS.maxPage)
    : 1;

  return {
    query: { filters, clubSlugs, sort, page, pageSize: LIMITS.defaultPageSize },
    errors,
  };
}

/** Rebuild a query string from a specification, for shareable links. */
export function buildQueryString(query: Partial<AdvancedQuery>): string {
  const params = new URLSearchParams();
  for (const filter of query.filters ?? []) {
    if (filter.min !== undefined) params.set(`${filter.field}_min`, String(filter.min));
    if (filter.max !== undefined) params.set(`${filter.field}_max`, String(filter.max));
  }
  if (query.clubSlugs?.length) params.set('club', query.clubSlugs.join(','));
  if (query.sort && query.sort !== DEFAULT_SORT) params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  return params.toString();
}

export function describeQuery(query: AdvancedQuery): string[] {
  return query.filters.map((filter) =>
    describeRange(FIELDS[filter.field].label, filter.min, filter.max));
}
