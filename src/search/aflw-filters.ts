/**
 * Filter panels for the AFLW tables.
 *
 * Deliberately parallel to `list-filters.ts` so the two competitions read
 * the same way, with one real difference: the AFL specs leave out
 * disposals, tackles and other era-limited statistics because filtering
 * on them would silently exclude everyone who played before they were
 * collected. The AFLW source records all of them from the competition's
 * first match in 2017, so here they are safe to expose — and metres
 * gained, which the AFL side does not have at all.
 *
 * Seasons are selected by key, never by year: AFLW played two seasons
 * inside calendar 2022.
 */

import { SEASON_STATUSES } from '@/search/list-filters';
import type { FilterField, SelectOption } from '@/search/table-filters';

export const AFLW_PLAYER_GROUPS: Record<string, string> = {
  identity: 'Who',
  career: 'Career',
  disposal: 'Possession',
  other: 'Around the ground',
  honours: 'Honours',
};

export const AFLW_MATCH_GROUPS: Record<string, string> = {
  scoreline: 'Scoreline',
  context: 'When and where',
};

/** Ordinals run 1–11 today; the ceiling leaves room for future seasons. */
const MAX_SEASON_ORDINAL = 60;

export function aflwPlayerFilterFields(options: {
  clubs: SelectOption[];
  seasons: SelectOption[];
}): FilterField[] {
  return [
    {
      kind: 'text', key: 'name', label: 'Name', group: 'identity',
      placeholder: 'Search by name',
    },
    {
      kind: 'select', key: 'club', label: 'Club', group: 'identity',
      options: options.clubs, anyLabel: 'Any club',
      help: 'Matches any player who appeared for the club, in any season.',
    },
    {
      kind: 'select', key: 'season', label: 'Played in season', group: 'identity',
      options: options.seasons, anyLabel: 'Any season',
    },
    { kind: 'range', key: 'games', label: 'Games', min: 0, max: 300, group: 'career' },
    { kind: 'range', key: 'goals', label: 'Goals', min: 0, max: 500, group: 'career' },
    { kind: 'range', key: 'behinds', label: 'Behinds', min: 0, max: 500, group: 'career' },
    {
      kind: 'range', key: 'seasons', label: 'Seasons played',
      min: 1, max: 20, group: 'career',
    },
    {
      kind: 'range', key: 'clubs', label: 'Clubs played for',
      min: 1, max: 10, group: 'career',
    },
    {
      kind: 'range', key: 'disposals', label: 'Disposals',
      min: 0, max: 5000, group: 'disposal',
    },
    { kind: 'range', key: 'kicks', label: 'Kicks', min: 0, max: 3000, group: 'disposal' },
    {
      kind: 'range', key: 'handballs', label: 'Handballs',
      min: 0, max: 3000, group: 'disposal',
    },
    {
      kind: 'range', key: 'contested', label: 'Contested possessions',
      min: 0, max: 3000, group: 'disposal',
    },
    {
      kind: 'range', key: 'metres_gained', label: 'Metres gained',
      min: -5000, max: 200_000, group: 'disposal',
      help: 'Signed: a single match can finish on negative metres. Not recorded on the AFL side at all.',
    },
    { kind: 'range', key: 'marks', label: 'Marks', min: 0, max: 2000, group: 'other' },
    { kind: 'range', key: 'tackles', label: 'Tackles', min: 0, max: 2000, group: 'other' },
    { kind: 'range', key: 'hitouts', label: 'Hitouts', min: 0, max: 3000, group: 'other' },
    {
      kind: 'range', key: 'fantasy_points', label: 'Fantasy points',
      min: -500, max: 20_000, group: 'other',
    },
    { kind: 'range', key: 'finals', label: 'Finals', min: 0, max: 60, group: 'honours' },
    { kind: 'range', key: 'wins', label: 'Wins', min: 0, max: 300, group: 'honours' },
    {
      kind: 'range', key: 'premierships', label: 'Premierships',
      min: 0, max: 15, group: 'honours',
      help: 'Grand Finals won while on the team sheet. 2020 was abandoned and awarded no premiership.',
    },
    {
      kind: 'range', key: 'debut', label: 'Debut season (ordinal)',
      min: 1, max: MAX_SEASON_ORDINAL, group: 'honours',
      help: 'Season 1 is 2017. Ordinals are used because two seasons were played in 2022.',
    },
  ];
}

/**
 * Sort keys, each with the label the control shows and the fixed ORDER BY
 * the query runs.
 *
 * One declaration rather than a label list here and an ORDER BY map in
 * the query module: a sort offered in the UI but missing from the SQL
 * would render a link that silently falls back to the default order, and
 * nothing would catch it. The SQL is fixed text, never built from a
 * request — the same arrangement `advanced-spec.ts` uses.
 */
export const AFLW_PLAYER_SORTS = {
  games: { label: 'Games', sql: 'c.games DESC, p.sort_name' },
  goals: { label: 'Goals', sql: 'c.goals DESC, p.sort_name' },
  disposals: { label: 'Disposals', sql: 'c.disposals DESC, p.sort_name' },
  marks: { label: 'Marks', sql: 'c.marks DESC, p.sort_name' },
  tackles: { label: 'Tackles', sql: 'c.tackles DESC, p.sort_name' },
  premierships: {
    label: 'Premierships', sql: 'c.premierships DESC, c.games DESC, p.sort_name',
  },
  finals: { label: 'Finals', sql: 'c.finals DESC, p.sort_name' },
  debut: { label: 'Debut season', sql: 'c.debut_season_ordinal, p.sort_name' },
  name: { label: 'Name', sql: 'p.sort_name' },
} as const;

export type AflwPlayerSort = keyof typeof AFLW_PLAYER_SORTS;

export function isAflwPlayerSort(value: string | undefined): value is AflwPlayerSort {
  return value !== undefined && Object.hasOwn(AFLW_PLAYER_SORTS, value);
}

export const AFLW_PLAYER_SORT_OPTIONS: SelectOption[] =
  Object.entries(AFLW_PLAYER_SORTS).map(([value, { label }]) => ({ value, label }));

export function aflwClubFilterFields(): FilterField[] {
  return [
    { kind: 'text', key: 'q', label: 'Name', placeholder: 'Search by name' },
    { kind: 'range', key: 'seasons', label: 'Seasons contested', min: 0, max: 60 },
    { kind: 'range', key: 'matches', label: 'Matches', min: 0, max: 600 },
    { kind: 'range', key: 'wins', label: 'Wins', min: 0, max: 600 },
    { kind: 'range', key: 'finals', label: 'Finals', min: 0, max: 100 },
    { kind: 'range', key: 'premierships', label: 'Premierships', min: 0, max: 30 },
  ];
}

export function aflwSeasonFilterFields(premiers: SelectOption[]): FilterField[] {
  return [
    {
      kind: 'range', key: 'year', label: 'Calendar year', min: 2017, max: 2100,
      help: 'Two seasons were played in 2022, so a year can return both.',
    },
    {
      kind: 'range', key: 'ordinal', label: 'Season number', min: 1, max: MAX_SEASON_ORDINAL,
    },
    {
      // Both competitions' season views emit the same two values, so they
      // share one vocabulary rather than each keeping a copy to drift.
      kind: 'select', key: 'status', label: 'Status',
      options: SEASON_STATUSES, anyLabel: 'Any status',
    },
    {
      kind: 'select', key: 'premier', label: 'Premier',
      options: premiers, anyLabel: 'Any club',
      help: '2020 was abandoned at the semi-finals and awarded no premiership.',
    },
    { kind: 'range', key: 'matches', label: 'Matches played', min: 0, max: 300 },
    { kind: 'range', key: 'clubs', label: 'Clubs', min: 0, max: 40 },
    { kind: 'range', key: 'players', label: 'Players', min: 0, max: 1000 },
  ];
}

/**
 * Result and match-type options, each with the condition it selects.
 *
 * Declared the same way as the sorts, and for the same reason: an option
 * the query has no branch for passes the parse allowlist, counts as an
 * active filter and is described above the table while the search returns
 * everything.
 */
export const AFLW_MATCH_OUTCOME_FILTERS = {
  decided: { label: 'Decided', sql: "m.result <> 'draw'" },
  draw: { label: 'Drawn', sql: "m.result = 'draw'" },
} as const;

export const AFLW_MATCH_TYPE_FILTERS = {
  home_and_away: { label: 'Home and away', sql: 'NOT m.is_final' },
  finals: { label: 'Finals', sql: 'm.is_final' },
  grand_final: { label: 'Grand Finals', sql: "m.round_type = 'grand_final'" },
} as const;

export const AFLW_MATCH_SORTS = {
  date_desc: { label: 'Most recent', sql: 'm.match_date DESC, m.match_key DESC' },
  date_asc: { label: 'Oldest', sql: 'm.match_date, m.match_key' },
  margin_desc: { label: 'Biggest margin', sql: 'm.margin DESC, m.match_date DESC' },
  margin_asc: { label: 'Closest margin', sql: 'm.margin, m.match_date DESC' },
  total_desc: { label: 'Highest combined score', sql: 'm.total_score DESC, m.match_date DESC' },
  total_asc: { label: 'Lowest combined score', sql: 'm.total_score, m.match_date DESC' },
  high_score_desc: { label: 'Highest team score', sql: 'm.high_score DESC, m.match_date DESC' },
} as const;

export type AflwMatchSort = keyof typeof AFLW_MATCH_SORTS;

export function isAflwMatchSort(value: string | undefined): value is AflwMatchSort {
  return value !== undefined && Object.hasOwn(AFLW_MATCH_SORTS, value);
}

const options = (
  entries: Record<string, { label: string }>,
): SelectOption[] =>
  Object.entries(entries).map(([value, { label }]) => ({ value, label }));

export const AFLW_MATCH_OUTCOMES: SelectOption[] = options(AFLW_MATCH_OUTCOME_FILTERS);
export const AFLW_MATCH_TYPES: SelectOption[] = options(AFLW_MATCH_TYPE_FILTERS);
export const AFLW_MATCH_SORT_OPTIONS: SelectOption[] = options(AFLW_MATCH_SORTS);

export function aflwMatchFilterFields(options: {
  clubs: SelectOption[];
  seasons: SelectOption[];
  venues: SelectOption[];
}): FilterField[] {
  return [
    {
      kind: 'range', key: 'margin', label: 'Margin', min: 0, max: 300, group: 'scoreline',
      help: 'A drawn match has a margin of 0.',
    },
    {
      kind: 'range', key: 'total_score', label: 'Combined score',
      min: 0, max: 500, group: 'scoreline',
    },
    {
      kind: 'range', key: 'high_score', label: 'Winning-side score',
      min: 0, max: 300, group: 'scoreline',
      help: 'The higher of the two scores, whichever side made it.',
    },
    {
      kind: 'range', key: 'low_score', label: 'Losing-side score',
      min: 0, max: 300, group: 'scoreline',
    },
    {
      kind: 'multi', key: 'club', label: 'Club', options: options.clubs,
      max: 2, group: 'context',
      help: 'Select up to two. Two clubs match games involving either.',
    },
    {
      kind: 'select', key: 'season', label: 'Season', options: options.seasons,
      anyLabel: 'Any season', group: 'context',
    },
    {
      kind: 'select', key: 'venue', label: 'Venue', options: options.venues,
      anyLabel: 'Any venue', group: 'context',
    },
    {
      kind: 'select', key: 'outcome', label: 'Result', options: AFLW_MATCH_OUTCOMES,
      anyLabel: 'Any result', group: 'context',
    },
    {
      kind: 'select', key: 'match_type', label: 'Match type', options: AFLW_MATCH_TYPES,
      anyLabel: 'Any match', group: 'context',
    },
  ];
}

export function aflwVenueFilterFields(): FilterField[] {
  return [
    { kind: 'text', key: 'q', label: 'Name', placeholder: 'Search by name' },
    { kind: 'range', key: 'matches', label: 'Matches hosted', min: 0, max: 300 },
  ];
}
