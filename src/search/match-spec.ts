/**
 * Match Search query specification.
 *
 * This module is shared by the page and the server-side query builder, so it
 * contains no server-only imports. SQL expressions are fixed here; URL values
 * are parsed into bounded numbers and fixed enum values before they can reach
 * the database.
 */

export type MatchFieldDefinition = {
  key: string;
  label: string;
  /** Fixed SQL expression. Never derived from a request value. */
  column: string;
  min: number;
  max: number;
  group: 'when' | 'scoreline';
  help?: string;
};

export const MATCH_FIELDS: Record<string, MatchFieldDefinition> = {
  season: {
    key: 'season', label: 'Season', column: 'm.season',
    min: 1897, max: 2100, group: 'when',
  },
  margin: {
    key: 'margin', label: 'Margin (points)', column: 'm.margin',
    min: 0, max: 400, group: 'scoreline',
    help: 'A draw has a margin of 0. “Under a goal” is 1–5 points.',
  },
  low_score: {
    key: 'low_score', label: 'Lower team score',
    column: 'LEAST(m.home_score, m.away_score)',
    min: 0, max: 400, group: 'scoreline',
    help: 'Set the minimum to require both teams to reach that score.',
  },
  high_score: {
    key: 'high_score', label: 'Higher team score',
    column: 'GREATEST(m.home_score, m.away_score)',
    min: 0, max: 400, group: 'scoreline',
  },
  total_score: {
    key: 'total_score', label: 'Combined score',
    column: '(m.home_score + m.away_score)',
    min: 0, max: 800, group: 'scoreline',
  },
};

export const MATCH_FIELD_KEYS = Object.keys(MATCH_FIELDS);

/** Fixed ORDER BY fragments operating on the filtered CTE's output columns. */
export const MATCH_SORTS: Record<string, { label: string; sql: string }> = {
  date_desc: { label: 'Newest first', sql: '"matchDate" DESC, id DESC' },
  date_asc: { label: 'Oldest first', sql: '"matchDate", id' },
  margin_asc: { label: 'Closest first', sql: 'margin, "matchDate" DESC, id DESC' },
  margin_desc: { label: 'Largest margin', sql: 'margin DESC, "matchDate" DESC, id DESC' },
  total_desc: { label: 'Highest combined score', sql: '"totalScore" DESC, "matchDate" DESC, id DESC' },
  high_score_desc: { label: 'Highest team score', sql: '"highScore" DESC, "matchDate" DESC, id DESC' },
};

export const MATCH_OUTCOMES = {
  all: 'Any result',
  decided: 'Decided games',
  draw: 'Draws',
} as const;

export const MATCH_TYPES = {
  all: 'Any match',
  home_and_away: 'Home-and-away',
  finals: 'Finals only',
} as const;

export const DEFAULT_MATCH_SORT = 'date_desc';

export const MATCH_LIMITS = {
  maxFilters: 10,
  maxClubFilters: 2,
  defaultPageSize: 50,
  maxPage: 400,
} as const;

export type MatchRangeFilter = {
  field: string;
  min?: number;
  max?: number;
};

export type MatchOutcome = keyof typeof MATCH_OUTCOMES;
export type MatchType = keyof typeof MATCH_TYPES;

export type MatchSearchQuery = {
  filters: MatchRangeFilter[];
  clubSlugs: string[];
  outcome: MatchOutcome;
  matchType: MatchType;
  sort: string;
  page: number;
  pageSize: number;
};

export type MatchParseResult = {
  query: MatchSearchQuery;
  errors: string[];
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clampInt(
  raw: string | undefined,
  definition: MatchFieldDefinition,
): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), definition.min), definition.max);
}

export function parseMatchSearchQuery(
  params: Record<string, string | string[] | undefined>,
): MatchParseResult {
  const errors: string[] = [];
  const filters: MatchRangeFilter[] = [];

  for (const key of MATCH_FIELD_KEYS) {
    const definition = MATCH_FIELDS[key];
    const min = clampInt(first(params[`${key}_min`]), definition);
    const max = clampInt(first(params[`${key}_max`]), definition);
    if (min === undefined && max === undefined) continue;

    if (min !== undefined && max !== undefined && min > max) {
      errors.push(
        `${definition.label}: minimum (${min}) is above maximum (${max}).`,
      );
      continue;
    }
    filters.push({ field: key, min, max });
  }

  if (filters.length > MATCH_LIMITS.maxFilters) {
    errors.push(
      `Too many filters; only the first ${MATCH_LIMITS.maxFilters} were applied.`,
    );
    filters.length = MATCH_LIMITS.maxFilters;
  }

  const clubRaw = first(params.club);
  const clubSlugs = [...new Set((clubRaw ? clubRaw.split(',') : [])
    .map((slug) => slug.trim().toLowerCase())
    .filter((slug) => /^[a-z0-9-]{1,80}$/.test(slug)))]
    .slice(0, MATCH_LIMITS.maxClubFilters);

  const outcomeRaw = first(params.outcome);
  const outcome: MatchOutcome = outcomeRaw && Object.hasOwn(MATCH_OUTCOMES, outcomeRaw)
    ? outcomeRaw as MatchOutcome
    : 'all';

  const typeRaw = first(params.match_type);
  const matchType: MatchType = typeRaw && Object.hasOwn(MATCH_TYPES, typeRaw)
    ? typeRaw as MatchType
    : 'all';

  const sortRaw = first(params.sort);
  const sort = sortRaw && Object.hasOwn(MATCH_SORTS, sortRaw)
    ? sortRaw
    : DEFAULT_MATCH_SORT;

  const pageRaw = Number(first(params.page));
  const page = Number.isSafeInteger(pageRaw) && pageRaw >= 1
    ? Math.min(pageRaw, MATCH_LIMITS.maxPage)
    : 1;

  return {
    query: {
      filters,
      clubSlugs,
      outcome,
      matchType,
      sort,
      page,
      pageSize: MATCH_LIMITS.defaultPageSize,
    },
    errors,
  };
}

/** Build the canonical, shareable URL state for a parsed match search. */
export function buildMatchQueryString(query: Partial<MatchSearchQuery>): string {
  const params = new URLSearchParams({ search: '1' });
  for (const filter of query.filters ?? []) {
    if (filter.min !== undefined) {
      params.set(`${filter.field}_min`, String(filter.min));
    }
    if (filter.max !== undefined) {
      params.set(`${filter.field}_max`, String(filter.max));
    }
  }
  if (query.clubSlugs?.length) params.set('club', query.clubSlugs.join(','));
  if (query.outcome && query.outcome !== 'all') params.set('outcome', query.outcome);
  if (query.matchType && query.matchType !== 'all') {
    params.set('match_type', query.matchType);
  }
  if (query.sort && query.sort !== DEFAULT_MATCH_SORT) params.set('sort', query.sort);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  return params.toString();
}

export function describeMatchQuery(query: MatchSearchQuery): string[] {
  const descriptions = query.filters.map((filter) => {
    const definition = MATCH_FIELDS[filter.field];
    if (filter.min !== undefined && filter.max !== undefined) {
      return `${definition.label} ${filter.min}–${filter.max}`;
    }
    if (filter.min !== undefined) return `${definition.label} ≥ ${filter.min}`;
    return `${definition.label} ≤ ${filter.max}`;
  });

  if (query.outcome !== 'all') descriptions.push(MATCH_OUTCOMES[query.outcome]);
  if (query.matchType !== 'all') descriptions.push(MATCH_TYPES[query.matchType]);
  return descriptions;
}
