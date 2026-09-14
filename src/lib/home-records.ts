/**
 * Curated records that may appear in the AFL home-page panel.
 * Stored settings contain only `value`; providers are compile-time choices.
 */

export type RecordCategory = {
  slug: string;
  title: string;
  definition: string;
  coverage?: string;
  unit: string;
};

export const RECORD_CATEGORIES: Record<string, RecordCategory> = {
  'most-games': {
    slug: 'most-games',
    title: 'Most Games',
    definition: 'Total VFL/AFL matches played, including finals, across all clubs.',
    unit: 'Games',
  },
  'most-goals': {
    slug: 'most-goals',
    title: 'Most Goals',
    definition: 'Total career goals in VFL/AFL matches, including finals.',
    coverage: 'Goals are recorded for every season from 1897, so this list is complete.',
    unit: 'Goals',
  },
  'most-finals': {
    slug: 'most-finals',
    title: 'Most Finals',
    definition: 'Matches played in an elimination, qualifying, semi, preliminary or grand final.',
    unit: 'Finals',
  },
  'most-premierships': {
    slug: 'most-premierships',
    title: 'Most Premierships',
    definition: 'Grand finals played in and won.',
    unit: 'Premierships',
  },
  'most-brownlow-votes': {
    slug: 'most-brownlow-votes',
    title: 'Most Brownlow Votes',
    definition: 'Career Brownlow Medal votes, summed from the official season counts.',
    coverage:
      'The Brownlow Medal was first awarded in 1924, so players who finished before then '
      + 'have no votes. Totals come from the official season counts rather than from '
      + 'per-game votes, which exist only for 1931–1934 and 1984–2025.',
    unit: 'Votes',
  },
  'most-goals-in-a-game': {
    slug: 'most-goals-in-a-game',
    title: 'Most Goals in a Match',
    definition: 'Highest goals scored by one player in a single VFL/AFL match.',
    coverage: 'Goals are recorded for every season from 1897.',
    unit: 'Goals',
  },
  'most-disposals-in-a-game': {
    slug: 'most-disposals-in-a-game',
    title: 'Most Disposals in a Match',
    definition: 'Highest disposals recorded for one player in a single match.',
    coverage:
      'Disposals were not recorded before 1965. Matches before then are absent from this '
      + 'list because the statistic was not collected, not because no disposals occurred.',
    unit: 'Disposals',
  },
  'most-goals-in-a-season': {
    slug: 'most-goals-in-a-season',
    title: 'Most Goals in a Season',
    definition: 'Highest goals by one player in a single season, including finals.',
    coverage:
      'A season total is the player\'s, not a club\'s: a player who transferred '
      + 'mid-season is ranked on the whole season. The club shown is the club '
      + 'of most games that year.',
    unit: 'Goals',
  },
};

export function getRecordCategory(slug: string): RecordCategory | null {
  return Object.hasOwn(RECORD_CATEGORIES, slug) ? RECORD_CATEGORIES[slug] : null;
}

export const HOME_RECORD_GROUPS = [
  { id: 'players-career', label: 'Players — Career' },
  { id: 'players-match', label: 'Players — Match' },
  { id: 'players-season', label: 'Players — Season' },
  { id: 'coaches', label: 'Coaches' },
  { id: 'venues', label: 'Venues' },
  { id: 'special', label: 'Special records' },
] as const;

export type HomeRecordGroup = typeof HOME_RECORD_GROUPS[number]['id'];
export type HomeRecordRenderKind =
  | 'player-total'
  | 'player-match'
  | 'player-season'
  | 'coach-total'
  | 'venue-total'
  | 'special-player-total';

export type HomeRecordProvider =
  | { kind: 'career'; category: 'most-goals' | 'most-games' | 'most-finals' | 'most-premierships' | 'most-brownlow-votes' }
  | { kind: 'match'; category: 'most-goals-in-a-game' | 'most-disposals-in-a-game' }
  | { kind: 'season'; category: 'most-goals-in-a-season' }
  | { kind: 'coach'; metric: 'games' | 'wins' | 'finals' | 'grandFinals' | 'premierships' | 'winPct'; minGames?: number }
  | { kind: 'venue'; metric: 'matches' | 'finals' | 'grandFinals' | 'highestAttendance' }
  | { kind: 'after-siren'; metric: 'attempts' | 'goals' | 'goalsToWin' }
  | { kind: 'first-kick'; metric: 'consecutiveGoalKicks' };

export type HomeRecordDefinition = {
  value: string;
  group: HomeRecordGroup;
  adminLabel: string;
  publicTitle: string;
  definition: string;
  coverage?: string;
  unit: string;
  domain: 'player' | 'coach' | 'venue' | 'special';
  grain: 'career' | 'match' | 'season' | 'coach-career' | 'venue' | 'curated-player';
  provider: HomeRecordProvider;
  renderKind: HomeRecordRenderKind;
  destination?: string;
};

const career = (value: 'most-goals' | 'most-games' | 'most-finals' | 'most-premierships' | 'most-brownlow-votes') => ({
  value,
  group: 'players-career' as const,
  adminLabel: RECORD_CATEGORIES[value].title,
  publicTitle: RECORD_CATEGORIES[value].title,
  definition: RECORD_CATEGORIES[value].definition,
  coverage: RECORD_CATEGORIES[value].coverage,
  unit: RECORD_CATEGORIES[value].unit,
  domain: 'player' as const,
  grain: 'career' as const,
  provider: { kind: 'career' as const, category: value },
  renderKind: 'player-total' as const,
  destination: `/records/${value}`,
});

export const HOME_RECORD_CATALOGUE = [
  career('most-goals'), career('most-games'), career('most-finals'),
  career('most-premierships'), career('most-brownlow-votes'),
  {
    value: 'most-goals-in-a-game', group: 'players-match',
    adminLabel: RECORD_CATEGORIES['most-goals-in-a-game'].title,
    publicTitle: RECORD_CATEGORIES['most-goals-in-a-game'].title,
    definition: RECORD_CATEGORIES['most-goals-in-a-game'].definition,
    coverage: RECORD_CATEGORIES['most-goals-in-a-game'].coverage,
    unit: RECORD_CATEGORIES['most-goals-in-a-game'].unit,
    domain: 'player', grain: 'match',
    provider: { kind: 'match', category: 'most-goals-in-a-game' },
    renderKind: 'player-match', destination: '/records/most-goals-in-a-game',
  },
  {
    value: 'most-disposals-in-a-game', group: 'players-match',
    adminLabel: RECORD_CATEGORIES['most-disposals-in-a-game'].title,
    publicTitle: RECORD_CATEGORIES['most-disposals-in-a-game'].title,
    definition: RECORD_CATEGORIES['most-disposals-in-a-game'].definition,
    coverage: RECORD_CATEGORIES['most-disposals-in-a-game'].coverage,
    unit: RECORD_CATEGORIES['most-disposals-in-a-game'].unit,
    domain: 'player', grain: 'match',
    provider: { kind: 'match', category: 'most-disposals-in-a-game' },
    renderKind: 'player-match', destination: '/records/most-disposals-in-a-game',
  },
  {
    value: 'most-goals-in-a-season', group: 'players-season',
    adminLabel: RECORD_CATEGORIES['most-goals-in-a-season'].title,
    publicTitle: RECORD_CATEGORIES['most-goals-in-a-season'].title,
    definition: RECORD_CATEGORIES['most-goals-in-a-season'].definition,
    coverage: RECORD_CATEGORIES['most-goals-in-a-season'].coverage,
    unit: RECORD_CATEGORIES['most-goals-in-a-season'].unit,
    domain: 'player', grain: 'season',
    provider: { kind: 'season', category: 'most-goals-in-a-season' },
    renderKind: 'player-season', destination: '/records/most-goals-in-a-season',
  },
  {
    value: 'coach-most-games', group: 'coaches', adminLabel: 'Most Games Coached',
    publicTitle: 'Most Games Coached',
    definition: 'Most VFL/AFL matches coached, derived from canonical per-match assignments.',
    unit: 'Games', domain: 'coach', grain: 'coach-career',
    provider: { kind: 'coach', metric: 'games' }, renderKind: 'coach-total',
    destination: '/records/coaches',
  },
  {
    value: 'coach-most-wins', group: 'coaches', adminLabel: 'Most Wins Coached',
    publicTitle: 'Most Wins Coached',
    definition: 'Most VFL/AFL wins as coach, derived from canonical per-match assignments.',
    unit: 'Wins', domain: 'coach', grain: 'coach-career',
    provider: { kind: 'coach', metric: 'wins' }, renderKind: 'coach-total',
    destination: '/records/coaches',
  },
  {
    value: 'coach-most-finals', group: 'coaches', adminLabel: 'Most Finals Coached',
    publicTitle: 'Most Finals Coached', definition: 'Most VFL/AFL finals coached, including Grand Finals.',
    unit: 'Finals', domain: 'coach', grain: 'coach-career',
    provider: { kind: 'coach', metric: 'finals' }, renderKind: 'coach-total',
    destination: '/records/coaches',
  },
  {
    value: 'coach-most-grand-finals', group: 'coaches', adminLabel: 'Most Grand Finals Coached',
    publicTitle: 'Most Grand Finals Coached',
    definition: 'Most VFL/AFL Grand Finals coached from canonical match assignments.',
    unit: 'Grand Finals', domain: 'coach', grain: 'coach-career',
    provider: { kind: 'coach', metric: 'grandFinals' }, renderKind: 'coach-total',
    destination: '/records/coaches',
  },
  {
    value: 'coach-most-premierships', group: 'coaches', adminLabel: 'Most Premierships Coached',
    publicTitle: 'Most Premierships Coached', definition: 'Most VFL/AFL Grand Finals coached and won.',
    unit: 'Premierships', domain: 'coach', grain: 'coach-career',
    provider: { kind: 'coach', metric: 'premierships' }, renderKind: 'coach-total',
    destination: '/records/coaches',
  },
  {
    value: 'coach-best-win-percentage', group: 'coaches',
    adminLabel: 'Best Coaching Win Percentage (50+ Games)', publicTitle: 'Best Coaching Win Percentage',
    definition: 'Highest coaching win percentage over at least 50 games; a draw counts as half a win.',
    unit: '%', domain: 'coach', grain: 'coach-career',
    provider: { kind: 'coach', metric: 'winPct', minGames: 50 }, renderKind: 'coach-total',
    destination: '/records/coaches',
  },
  {
    value: 'venue-most-matches', group: 'venues', adminLabel: 'Most Matches Hosted',
    publicTitle: 'Most Matches Hosted', definition: 'Most VFL/AFL matches played at a venue, including finals.',
    unit: 'Matches', domain: 'venue', grain: 'venue',
    provider: { kind: 'venue', metric: 'matches' }, renderKind: 'venue-total', destination: '/venues',
  },
  {
    value: 'venue-most-finals', group: 'venues', adminLabel: 'Most Finals Hosted',
    publicTitle: 'Most Finals Hosted', definition: 'Most VFL/AFL finals played at a venue.',
    unit: 'Finals', domain: 'venue', grain: 'venue',
    provider: { kind: 'venue', metric: 'finals' }, renderKind: 'venue-total',
  },
  {
    value: 'venue-most-grand-finals', group: 'venues', adminLabel: 'Most Grand Finals Hosted',
    publicTitle: 'Most Grand Finals Hosted', definition: 'Most VFL/AFL Grand Finals played at a venue.',
    unit: 'Grand Finals', domain: 'venue', grain: 'venue',
    provider: { kind: 'venue', metric: 'grandFinals' }, renderKind: 'venue-total',
  },
  {
    value: 'venue-highest-recorded-attendance', group: 'venues',
    adminLabel: 'Highest Recorded Attendance', publicTitle: 'Highest Recorded Attendance',
    definition: 'Highest recorded crowd for a VFL/AFL match at each venue.',
    coverage: 'Matches with unrecorded attendance are excluded; an unknown crowd is never treated as zero.',
    unit: 'Attendance', domain: 'venue', grain: 'venue',
    provider: { kind: 'venue', metric: 'highestAttendance' }, renderKind: 'venue-total',
  },
  {
    value: 'after-siren-most-attempts', group: 'special',
    adminLabel: 'Most After-the-Siren Attempts', publicTitle: 'Most After-the-Siren Attempts',
    definition: 'Most active, source-backed after-the-siren kicks by a linked player.',
    coverage: 'This is a curated historical record, not a claim of complete play-by-play coverage.',
    unit: 'Attempts', domain: 'special', grain: 'curated-player',
    provider: { kind: 'after-siren', metric: 'attempts' },
    renderKind: 'special-player-total', destination: '/records/after-the-siren',
  },
  {
    value: 'after-siren-most-goals', group: 'special',
    adminLabel: 'Most After-the-Siren Goals', publicTitle: 'Most After-the-Siren Goals',
    definition: 'Most goals kicked after the siren in active, source-backed records.',
    coverage: 'This is a curated historical record, not a claim of complete play-by-play coverage.',
    unit: 'Goals', domain: 'special', grain: 'curated-player',
    provider: { kind: 'after-siren', metric: 'goals' },
    renderKind: 'special-player-total', destination: '/records/after-the-siren',
  },
  {
    value: 'after-siren-most-goals-to-win', group: 'special',
    adminLabel: 'Most After-the-Siren Goals to Win', publicTitle: 'Most After-the-Siren Goals to Win',
    definition: 'Most after-the-siren goals that changed the match result to a win.',
    coverage: 'This is a curated historical record, not a claim of complete play-by-play coverage.',
    unit: 'Goals', domain: 'special', grain: 'curated-player',
    provider: { kind: 'after-siren', metric: 'goalsToWin' },
    renderKind: 'special-player-total', destination: '/records/after-the-siren',
  },
  {
    value: 'first-kick-most-consecutive-goals', group: 'special',
    adminLabel: 'Most Consecutive Goals from First Career Kicks',
    publicTitle: 'Most Consecutive Goals from First Career Kicks',
    definition: 'Longest run of goals beginning with a player\'s first recorded VFL/AFL kick.',
    coverage: 'Active, source-backed first-kick records linked to AFLDB players; not complete play-by-play coverage.',
    unit: 'Goals', domain: 'special', grain: 'curated-player',
    provider: { kind: 'first-kick', metric: 'consecutiveGoalKicks' },
    renderKind: 'special-player-total', destination: '/records/first-kick-goal',
  },
] as const satisfies readonly HomeRecordDefinition[];

export type HomeRecordValue = typeof HOME_RECORD_CATALOGUE[number]['value'];
export const HOME_RECORD_VALUES = HOME_RECORD_CATALOGUE.map((entry) => entry.value) as HomeRecordValue[];
export const DEFAULT_HOME_RECORD: HomeRecordValue = 'most-goals';

const HOME_RECORD_BY_VALUE = Object.fromEntries(
  HOME_RECORD_CATALOGUE.map((entry) => [entry.value, entry]),
) as Record<HomeRecordValue, HomeRecordDefinition>;

export function parseHomeRecordValue(value: unknown): HomeRecordValue {
  return typeof value === 'string' && Object.hasOwn(HOME_RECORD_BY_VALUE, value)
    ? value as HomeRecordValue
    : DEFAULT_HOME_RECORD;
}

export function getHomeRecordDefinition(value: unknown): HomeRecordDefinition {
  return HOME_RECORD_BY_VALUE[parseHomeRecordValue(value)];
}

export type HomeRecordOptionGroup = {
  id: HomeRecordGroup;
  label: string;
  options: { value: HomeRecordValue; label: string }[];
};

export function homeRecordOptionGroups(): HomeRecordOptionGroup[] {
  return HOME_RECORD_GROUPS.map((group) => ({
    ...group,
    options: HOME_RECORD_CATALOGUE
      .filter((entry) => entry.group === group.id)
      .map((entry) => ({ value: entry.value, label: entry.adminLabel })),
  }));
}
