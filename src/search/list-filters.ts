/**
 * The filter panel each list page offers.
 *
 * One builder per table, so the fields a page exposes are declared in a
 * single place and the page itself stays about presenting rows. Builders
 * take the lookups they need (club lists, season bounds) rather than
 * reading the database, which keeps this module importable from Client
 * Components and testable without a connection.
 *
 * Bounds are generous rather than exact: they exist to stop a hand-edited
 * URL asking for a billion goals, not to encode the current record.
 */

import type { FilterField, SelectOption } from '@/search/table-filters';

export const CAREER_GROUPS: Record<string, string> = {
  identity: 'Who',
  career: 'Career',
  honours: 'Honours',
  span: 'Career span',
};

export const SEASON_MIN = 1897;
export const SEASON_MAX = 2100;

/** Clubs as options, historical identities marked as such. */
export function clubOptions(
  clubs: readonly { slug: string; name: string; isCurrent: boolean }[],
): SelectOption[] {
  return clubs.map((club) => ({
    value: club.slug,
    label: club.isCurrent ? club.name : `${club.name} (historical)`,
  }));
}

/**
 * Player index filters.
 *
 * Deliberately the same field set as Advanced Player Search: a reader who
 * narrows the index and then wants to sort or page through it should not
 * find a different vocabulary in the two places.
 */
export function playerFilterFields(options: {
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
    },
    {
      kind: 'select', key: 'season', label: 'Played in season', group: 'identity',
      options: options.seasons, anyLabel: 'Any season',
    },
    { kind: 'range', key: 'games', label: 'Games', min: 0, max: 1000, group: 'career' },
    { kind: 'range', key: 'goals', label: 'Goals', min: 0, max: 2000, group: 'career' },
    { kind: 'range', key: 'finals', label: 'Finals', min: 0, max: 100, group: 'career' },
    { kind: 'range', key: 'wins', label: 'Wins', min: 0, max: 500, group: 'career' },
    {
      kind: 'range', key: 'seasons', label: 'Seasons played',
      min: 1, max: 30, group: 'career',
    },
    {
      kind: 'range', key: 'clubs', label: 'Clubs played for',
      min: 1, max: 10, group: 'career',
      help: 'Counts actual clubs: a rename such as Kangaroos to North Melbourne counts once.',
    },
    {
      kind: 'range', key: 'premierships', label: 'Premierships',
      min: 0, max: 20, group: 'honours',
    },
    {
      kind: 'range', key: 'brownlow_votes', label: 'Brownlow votes',
      min: 0, max: 400, group: 'honours',
      help: 'Career total from the official season counts, available from 1924.',
    },
    {
      kind: 'range', key: 'brownlow_medals', label: 'Brownlow medals',
      min: 0, max: 10, group: 'honours',
    },
    {
      kind: 'range', key: 'debut', label: 'Debut season',
      min: SEASON_MIN, max: SEASON_MAX, group: 'span',
    },
    {
      kind: 'range', key: 'final', label: 'Final season',
      min: SEASON_MIN, max: SEASON_MAX, group: 'span',
    },
  ];
}

export const CLUB_SUCCESSIONS: SelectOption[] = [
  { value: 'current', label: 'Still competing' },
  { value: 'renamed', label: 'Renamed' },
  { value: 'relocated', label: 'Relocated' },
  { value: 'merged', label: 'Merged' },
  { value: 'defunct', label: 'Defunct' },
];

export function clubFilterFields(states: SelectOption[]): FilterField[] {
  return [
    { kind: 'text', key: 'q', label: 'Name', placeholder: 'Search by name' },
    { kind: 'select', key: 'state', label: 'Home state', options: states, anyLabel: 'Any state' },
    {
      kind: 'select', key: 'succession', label: 'Outcome',
      options: CLUB_SUCCESSIONS, anyLabel: 'Any outcome',
      help: 'A rename or relocation carries the club’s record forward; a merger does not.',
    },
    {
      kind: 'range', key: 'first_season', label: 'First season',
      min: SEASON_MIN, max: SEASON_MAX,
    },
    {
      kind: 'range', key: 'last_season', label: 'Last season',
      min: SEASON_MIN, max: SEASON_MAX,
      help: 'A club still competing has no last season and is excluded by this filter.',
    },
  ];
}

export function venueFilterFields(states: SelectOption[]): FilterField[] {
  return [
    { kind: 'text', key: 'q', label: 'Name', placeholder: 'Search by name' },
    { kind: 'select', key: 'state', label: 'State', options: states, anyLabel: 'Any state' },
    { kind: 'range', key: 'matches', label: 'Matches hosted', min: 0, max: 10_000 },
    {
      kind: 'range', key: 'first_season', label: 'First season',
      min: SEASON_MIN, max: SEASON_MAX,
    },
    {
      kind: 'range', key: 'last_season', label: 'Last season',
      min: SEASON_MIN, max: SEASON_MAX,
    },
  ];
}

export const SEASON_STATUSES: SelectOption[] = [
  { value: 'complete', label: 'Complete' },
  { value: 'in_progress', label: 'In progress' },
];

export function seasonFilterFields(options: {
  leagues: SelectOption[];
  premiers: SelectOption[];
}): FilterField[] {
  return [
    {
      kind: 'range', key: 'year', label: 'Season',
      min: SEASON_MIN, max: SEASON_MAX,
    },
    {
      kind: 'select', key: 'league', label: 'League',
      options: options.leagues, anyLabel: 'Any league',
    },
    {
      kind: 'select', key: 'status', label: 'Status',
      options: SEASON_STATUSES, anyLabel: 'Any status',
    },
    {
      kind: 'select', key: 'premier', label: 'Premier',
      options: options.premiers, anyLabel: 'Any club',
      help: 'A season still being played has no premier and is excluded by this filter.',
    },
    { kind: 'range', key: 'matches', label: 'Matches', min: 0, max: 500 },
    { kind: 'range', key: 'clubs', label: 'Clubs', min: 0, max: 40 },
  ];
}

export function draftFilterFields(options: {
  years: SelectOption[];
  clubs: SelectOption[];
  types: SelectOption[];
}): FilterField[] {
  return [
    { kind: 'text', key: 'q', label: 'Player', placeholder: 'Search by name' },
    {
      kind: 'select', key: 'year', label: 'Year',
      options: options.years, anyLabel: 'Any year',
    },
    {
      kind: 'select', key: 'club', label: 'Club',
      options: options.clubs, anyLabel: 'Any club',
    },
    {
      kind: 'select', key: 'type', label: 'Draft type',
      options: options.types, anyLabel: 'Any type',
    },
    { kind: 'range', key: 'pick', label: 'Pick number', min: 1, max: 200 },
    {
      kind: 'range', key: 'age', label: 'Draft age', min: 14, max: 45,
      help: 'Age is not recorded for every selection; those rows are excluded by this filter.',
    },
    {
      kind: 'range', key: 'games', label: 'Career games', min: 0, max: 1000,
      help: 'Games played after being drafted. Unlinked selections are excluded.',
    },
  ];
}

export function hallOfFameFilterFields(categories: SelectOption[]): FilterField[] {
  return [
    { kind: 'text', key: 'q', label: 'Name', placeholder: 'Search by name' },
    {
      kind: 'select', key: 'category', label: 'Category',
      options: categories, anyLabel: 'Any category',
    },
    {
      kind: 'range', key: 'inducted', label: 'Inducted',
      min: 1996, max: SEASON_MAX,
    },
  ];
}

export function brownlowWinnerFilterFields(clubs: SelectOption[]): FilterField[] {
  return [
    { kind: 'text', key: 'q', label: 'Winner', placeholder: 'Search by name' },
    {
      kind: 'select', key: 'club', label: 'Club', options: clubs, anyLabel: 'Any club',
      help: 'The club the player represented that season.',
    },
    {
      kind: 'range', key: 'season', label: 'Season',
      min: 1924, max: SEASON_MAX,
    },
    { kind: 'range', key: 'votes', label: 'Winning votes', min: 0, max: 100 },
  ];
}

export function brownlowLeaderFilterFields(): FilterField[] {
  return [
    { kind: 'text', key: 'lq', label: 'Player', placeholder: 'Search by name' },
    { kind: 'range', key: 'lvotes', label: 'Career votes', min: 0, max: 400 },
    { kind: 'range', key: 'lmedals', label: 'Medals', min: 0, max: 10 },
    { kind: 'range', key: 'lgames', label: 'Games', min: 0, max: 1000 },
  ];
}
