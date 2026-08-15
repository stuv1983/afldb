/**
 * Grid solver specification: a 3x3 board where each cell answers "who
 * satisfies this row's question AND this column's question", modelled on
 * sports_data_lab's Grid Solver (app_pages/11_Grid_Solver.py,
 * afl/constraints.py) -- a sibling to the AND/OR card-based query builder
 * in query-builder-spec.ts, not a replacement of it. Where that tool asks
 * "pick a column, an operator, a value", this one asks "pick one of these
 * named questions and fill in its details" -- the actual "grid squares"
 * shape the original request also named.
 *
 * Not ported from the reference, all deliberately: the daily board fetch
 * from an external trivia site, saved-grids-per-account (AFLDB has no
 * regular-user accounts, only admin auth), practice/auto-grid modes, and
 * the obscurity/star-rating system (a bespoke precomputed score AFLDB has
 * no equivalent of -- see GridOrder below for the honest substitute).
 *
 * V1 catalogue: ~30 builders across 9 categories, a real cross-section
 * of what AFLDB's schema actually supports, not the reference's 100+ --
 * extensible later the same way QUERYABLE_TABLES and the CSV DATASETS
 * registry already are. Every builder is a fixed, named SQL shape with
 * typed parameters (mirrors constraints.py's `(sql, params)` functions);
 * nothing here lets a request choose a column or operator the way the
 * generic query builder does, so identifiers never need to be checked
 * against a value the request supplied in the first place.
 */

import { decodeUrlState, encodeUrlState } from '@/lib/urlState';

// ------------------------------------------------------------- parameters

export type GridParamKind = 'integer' | 'season' | 'club' | 'venue' | 'player' | 'stat';

export type GridParamDef = {
  key: string;
  label: string;
  kind: GridParamKind;
};

// ----------------------------------------------------------------- stats
// The seven career statistics with a consistent shape across all three
// grains (player_career_stats, player_season_stats, player_match_stats) --
// the same seven ERA_LIMITED_STATS lib/player-compare.ts compares. Kept as
// an independent list rather than importing that one: this catalogue also
// needs SQL column names, which player-compare.ts has no reason to carry.

export const GRID_STATS = {
  behinds: { key: 'behinds', label: 'Behinds' },
  kicks: { key: 'kicks', label: 'Kicks' },
  handballs: { key: 'handballs', label: 'Handballs' },
  disposals: { key: 'disposals', label: 'Disposals' },
  marks: { key: 'marks', label: 'Marks' },
  tackles: { key: 'tackles', label: 'Tackles' },
  hitouts: { key: 'hitouts', label: 'Hitouts' },
} as const;

export type GridStatKey = keyof typeof GRID_STATS;
export const GRID_STAT_KEYS = Object.keys(GRID_STATS) as GridStatKey[];

export function isGridStatKey(value: string): value is GridStatKey {
  return Object.hasOwn(GRID_STATS, value);
}

// -------------------------------------------------------------- builders

export type GridBuilderDef = {
  key: string;
  label: string;
  group: string;
  params: GridParamDef[];
};

const club = (label = 'Club'): GridParamDef => ({ key: 'club', label, kind: 'club' });
const venue = (label = 'Venue'): GridParamDef => ({ key: 'venue', label, kind: 'venue' });
const player = (label = 'Player'): GridParamDef => ({ key: 'player', label, kind: 'player' });
const stat = (label = 'Statistic'): GridParamDef => ({ key: 'stat', label, kind: 'stat' });
const int = (key: string, label: string): GridParamDef => ({ key, label, kind: 'integer' });
const season = (key: string, label: string): GridParamDef => ({ key, label, kind: 'season' });

export const GRID_GROUP_ORDER = [
  'Clubs & journeys',
  'Career milestones',
  'Season & era',
  'Finals & premierships',
  'Grounds & venues',
  'Teammates',
  'Captaincy',
  'Awards & honours',
  'Draft & recruitment',
] as const;

export const GRID_BUILDERS: Record<string, GridBuilderDef> = {
  // Clubs & journeys -- club-scoped builders resolve at the organization
  // level (lineage-inclusive: "Western Bulldogs" also matches Footscray-
  // era rows), the same convention club pages already use.
  played_for_club: { key: 'played_for_club', label: 'Played for club', group: 'Clubs & journeys', params: [club()] },
  debut_club: { key: 'debut_club', label: 'First career game for club', group: 'Clubs & journeys', params: [club()] },
  one_club_player: { key: 'one_club_player', label: 'One-club player', group: 'Clubs & journeys', params: [] },
  multi_club_player: { key: 'multi_club_player', label: 'Multi-club player', group: 'Clubs & journeys', params: [] },
  games_at_one_club_min: { key: 'games_at_one_club_min', label: 'X+ games at one club', group: 'Clubs & journeys', params: [int('games', 'Games')] },

  // Career milestones
  career_games_min: { key: 'career_games_min', label: 'X+ career games', group: 'Career milestones', params: [int('games', 'Games')] },
  career_games_max: { key: 'career_games_max', label: 'Fewer than X career games', group: 'Career milestones', params: [int('games', 'Games')] },
  career_goals_min: { key: 'career_goals_min', label: 'X+ career goals', group: 'Career milestones', params: [int('goals', 'Goals')] },
  career_stat_total_min: { key: 'career_stat_total_min', label: 'X+ of a stat in a career', group: 'Career milestones', params: [stat(), int('x', 'At least')] },

  // Season & era
  debuted_between: { key: 'debuted_between', label: 'Debuted between seasons', group: 'Season & era', params: [season('from', 'From season'), season('to', 'To season')] },
  played_in_decade: { key: 'played_in_decade', label: 'Played in a decade', group: 'Season & era', params: [season('decade', 'Decade start (e.g. 1990)')] },
  played_between_seasons: { key: 'played_between_seasons', label: 'Played between seasons', group: 'Season & era', params: [season('from', 'From season'), season('to', 'To season')] },
  season_stat_total_min: { key: 'season_stat_total_min', label: 'X+ of a stat in one season', group: 'Season & era', params: [stat(), int('x', 'At least')] },
  games_in_season_min: { key: 'games_in_season_min', label: 'X+ games in one season', group: 'Season & era', params: [int('games', 'Games')] },

  // Finals & premierships
  played_in_a_final: { key: 'played_in_a_final', label: 'Played in a final', group: 'Finals & premierships', params: [] },
  never_played_finals: { key: 'never_played_finals', label: 'Never played finals', group: 'Finals & premierships', params: [] },
  finals_games_min: { key: 'finals_games_min', label: 'X+ finals games', group: 'Finals & premierships', params: [int('games', 'Games')] },
  premiership_player: { key: 'premiership_player', label: 'Premiership player', group: 'Finals & premierships', params: [] },
  won_a_final: { key: 'won_a_final', label: 'Won a final', group: 'Finals & premierships', params: [] },

  // Grounds & venues
  played_at_venue: { key: 'played_at_venue', label: 'Played at venue', group: 'Grounds & venues', params: [venue()] },
  games_at_venue_min: { key: 'games_at_venue_min', label: 'X+ games at venue', group: 'Grounds & venues', params: [venue(), int('games', 'Games')] },

  // Teammates -- the same player_match_stats self-join as
  // getPlayerOverlapSummary in db/queries/player-compare.ts.
  teammate_of: { key: 'teammate_of', label: 'Teammate of…', group: 'Teammates', params: [player()] },
  played_against: { key: 'played_against', label: 'Played against…', group: 'Teammates', params: [player()] },

  // Captaincy
  club_captain: { key: 'club_captain', label: 'Club captain', group: 'Captaincy', params: [club()] },
  captain_between_seasons: { key: 'captain_between_seasons', label: 'Captain between seasons', group: 'Captaincy', params: [season('from', 'From season'), season('to', 'To season')] },

  // Awards & honours
  hall_of_fame_player: { key: 'hall_of_fame_player', label: 'Hall of Fame player', group: 'Awards & honours', params: [] },
  brownlow_medallist: { key: 'brownlow_medallist', label: 'Brownlow medallist', group: 'Awards & honours', params: [] },
  brownlow_votes_career_min: { key: 'brownlow_votes_career_min', label: 'X+ career Brownlow votes', group: 'Awards & honours', params: [int('votes', 'Votes')] },

  // Draft & recruitment -- linked rows only (link_status_value IN
  // ('unique','resolved')), the same rule every other draft query follows.
  drafted_by_club: { key: 'drafted_by_club', label: 'Drafted by club', group: 'Draft & recruitment', params: [club()] },
  draft_pick_between: { key: 'draft_pick_between', label: 'Draft pick between', group: 'Draft & recruitment', params: [int('from', 'From pick'), int('to', 'To pick')] },
  draft_year_between: { key: 'draft_year_between', label: 'Drafted between years', group: 'Draft & recruitment', params: [season('from', 'From year'), season('to', 'To year')] },
};

export const GRID_BUILDER_KEYS = Object.keys(GRID_BUILDERS);

/** Builders grouped in display order, derived from GRID_BUILDERS so there is one source of truth for membership. */
export function buildersByGroup(): { group: string; builders: GridBuilderDef[] }[] {
  return GRID_GROUP_ORDER.map((group) => ({
    group,
    builders: Object.values(GRID_BUILDERS).filter((b) => b.group === group),
  }));
}

// ------------------------------------------------------------------- limits

export const GRID_LIMITS = {
  defaultRowsPerCell: 25,
  maxRowsPerCell: 200,
  /** Hard ceiling on a share token's decoded size. */
  maxStateChars: 4_096,
} as const;

// --------------------------------------------------------------------- AST

export type GridAxisState = {
  builder: string;
  /** Raw string values as typed into the form; parsed and validated by the compiler. */
  params: Record<string, string>;
};

/**
 * "Obscurity" in the reference is a bespoke precomputed rarity percentile
 * AFLDB has no equivalent of. Fewest career games first is the honest,
 * simple substitute: a player who barely played but still satisfies two
 * specific constraints is the same kind of surprising answer.
 */
export type GridOrder = 'games_asc' | 'games_desc' | 'debut_asc' | 'debut_desc';

export const GRID_ORDER_LABELS: Record<GridOrder, string> = {
  games_asc: 'Fewest games',
  games_desc: 'Most games',
  debut_asc: 'Earliest debut',
  debut_desc: 'Most recent debut',
};

export type GridBoardState = {
  rows: [GridAxisState, GridAxisState, GridAxisState];
  cols: [GridAxisState, GridAxisState, GridAxisState];
  order: GridOrder;
};

/**
 * A self-contained default board: three career-games thresholds against
 * three debut-era bands. Deliberately built from nothing but integers --
 * no club/venue/player id has to be guessed at and looked up just to give
 * the page something non-empty to show on first load.
 */
export const DEFAULT_BOARD_STATE: GridBoardState = {
  rows: [
    { builder: 'career_games_min', params: { games: '50' } },
    { builder: 'career_games_min', params: { games: '150' } },
    { builder: 'career_games_min', params: { games: '300' } },
  ],
  cols: [
    { builder: 'debuted_between', params: { from: '1990', to: '1999' } },
    { builder: 'debuted_between', params: { from: '2000', to: '2009' } },
    { builder: 'debuted_between', params: { from: '2010', to: '2019' } },
  ],
  order: 'games_asc',
};

// ------------------------------------------------------------ URL state

export function serializeBoardState(state: GridBoardState): string {
  return encodeUrlState(state, GRID_LIMITS.maxStateChars);
}

export function parseBoardState(token: string): GridBoardState | null {
  const raw = decodeUrlState(token, GRID_LIMITS.maxStateChars);
  return raw === null ? null : validateBoardState(raw);
}

const ORDERS: GridOrder[] = ['games_asc', 'games_desc', 'debut_asc', 'debut_desc'];

function validateAxis(raw: unknown): GridAxisState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.builder !== 'string' || !Object.hasOwn(GRID_BUILDERS, obj.builder)) return null;
  const paramsRaw = obj.params;
  if (paramsRaw !== undefined && (typeof paramsRaw !== 'object' || paramsRaw === null)) return null;
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries((paramsRaw as Record<string, unknown>) ?? {})) {
    if (typeof value !== 'string') return null;
    params[key] = value.slice(0, 200);
  }
  return { builder: obj.builder, params };
}

function validateAxisTriple(raw: unknown): [GridAxisState, GridAxisState, GridAxisState] | null {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const axes = raw.map(validateAxis);
  if (axes.some((a) => a === null)) return null;
  return axes as [GridAxisState, GridAxisState, GridAxisState];
}

function validateBoardState(raw: unknown): GridBoardState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rows = validateAxisTriple(obj.rows);
  const cols = validateAxisTriple(obj.cols);
  if (!rows || !cols) return null;
  const order = typeof obj.order === 'string' && ORDERS.includes(obj.order as GridOrder)
    ? (obj.order as GridOrder) : 'games_asc';
  return { rows, cols, order };
}

/** True once every param a builder declares has a non-empty value -- mirrors "both axes defined" in the reference. */
export function isAxisComplete(axis: GridAxisState): boolean {
  const def = GRID_BUILDERS[axis.builder];
  if (!def) return false;
  return def.params.every((p) => (axis.params[p.key] ?? '').trim() !== '');
}
