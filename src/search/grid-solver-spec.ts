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
 * Catalogue: 93 builders across 10 categories, checked against the
 * reference's own generated criteria doc (afl_grid_criteria.md) and
 * verified against AFLDB's live data one category at a time -- family
 * relationships, physical attributes, derby definitions and win-streaks
 * are cut because the data genuinely isn't there (see docs/search.md for
 * the full reasoning), not because they were skipped.
 *
 * Every builder is a fixed, named SQL shape with typed parameters (mirrors
 * constraints.py's `(sql, params)` functions); nothing here lets a request
 * choose a column or operator the way the generic query builder does, so
 * identifiers never need to be checked against a value the request
 * supplied in the first place -- except the `stat` family of params
 * (including `statA`/`statB`), checked against GRID_STATS before
 * sql.unsafe ever sees them.
 */

import { decodeUrlState, encodeUrlState } from '@/lib/urlState';

// ------------------------------------------------------------- parameters

export type GridParamKind =
  | 'integer' | 'decimal' | 'season' | 'club' | 'venue' | 'player' | 'stat'
  | 'award' | 'draftType' | 'signingKind' | 'aaPosition';

export type GridParamDef = {
  key: string;
  label: string;
  kind: GridParamKind;
};

// ----------------------------------------------------------------- stats
// Every real player_match_stats column, plus goals, each tagged with how
// far it's precomputed:
//  - 'always'      goals -- always recorded, no recorded-games gating.
//  - 'era_limited' the original 7 -- precomputed totals on BOTH
//                  player_career_stats and player_season_stats.
//  - 'live_only'   the other 13 -- no precomputed total anywhere; builders
//                  using these aggregate player_match_stats directly.
// grid-solver.ts's statTotalExpr() branches on this so "X+ of a stat"
// builders use the cheap precomputed column wherever one exists and only
// fall back to a live scan for the 13 stats that have no alternative.

export type StatGrain = 'always' | 'era_limited' | 'live_only';

export const GRID_STATS: Record<string, { key: string; label: string; grain: StatGrain }> = {
  goals: { key: 'goals', label: 'Goals', grain: 'always' },
  behinds: { key: 'behinds', label: 'Behinds', grain: 'era_limited' },
  kicks: { key: 'kicks', label: 'Kicks', grain: 'era_limited' },
  handballs: { key: 'handballs', label: 'Handballs', grain: 'era_limited' },
  disposals: { key: 'disposals', label: 'Disposals', grain: 'era_limited' },
  marks: { key: 'marks', label: 'Marks', grain: 'era_limited' },
  tackles: { key: 'tackles', label: 'Tackles', grain: 'era_limited' },
  hitouts: { key: 'hitouts', label: 'Hitouts', grain: 'era_limited' },
  rebounds: { key: 'rebounds', label: 'Rebound 50s', grain: 'live_only' },
  inside_50s: { key: 'inside_50s', label: 'Inside 50s', grain: 'live_only' },
  clearances: { key: 'clearances', label: 'Clearances', grain: 'live_only' },
  clangers: { key: 'clangers', label: 'Clangers', grain: 'live_only' },
  frees_for: { key: 'frees_for', label: 'Frees for', grain: 'live_only' },
  frees_against: { key: 'frees_against', label: 'Frees against', grain: 'live_only' },
  contested: { key: 'contested', label: 'Contested possessions', grain: 'live_only' },
  uncontested: { key: 'uncontested', label: 'Uncontested possessions', grain: 'live_only' },
  contested_marks: { key: 'contested_marks', label: 'Contested marks', grain: 'live_only' },
  marks_inside_50: { key: 'marks_inside_50', label: 'Marks inside 50', grain: 'live_only' },
  one_percenters: { key: 'one_percenters', label: 'One percenters', grain: 'live_only' },
  bounces: { key: 'bounces', label: 'Bounces', grain: 'live_only' },
  goal_assists: { key: 'goal_assists', label: 'Goal assists', grain: 'live_only' },
} as const;

export type GridStatKey = keyof typeof GRID_STATS;
export const GRID_STAT_KEYS = Object.keys(GRID_STATS) as GridStatKey[];

export function isGridStatKey(value: string): value is GridStatKey {
  return Object.hasOwn(GRID_STATS, value);
}

// ------------------------------------------------- other closed vocabularies
// Small, real, hand-verified sets (queried live without LIMIT to confirm
// completeness) -- hardcoded here rather than DB-driven, the same choice
// already made for GRID_STATS: the whole catalogue is a fixed set of
// named questions, so a fixed set of option lists fits it, and it avoids
// another server round-trip for a dropdown that essentially never changes.

export const GRID_DRAFT_TYPES = [
  'National', 'National Draft', 'Rookie', 'Trade', 'Pre-Season', 'Pre-Draft',
  'Mid-Season', 'Post-Draft', 'Free Agency', 'Mini-Draft', 'Training Squad Selection',
] as const;

export const GRID_SIGNING_KINDS = [
  'Academy', 'Foundation', 'Father-Son', 'Zone', 'International', 'SSP',
  'FA', 'DFA', 'Uncontracted', 'Unregistered', 'Scholarship', 'Underage',
  'Concessional', 'Concession', 'Top-Up', 'Supplementary', 'Compensation', 'Special Cat B',
] as const;

export const GRID_AA_POSITIONS: { value: string; label: string }[] = [
  { value: 'FB', label: 'FB — Full Back' },
  { value: 'BP', label: 'BP — Back Pocket' },
  { value: 'HBF', label: 'HBF — Half Back Flank' },
  { value: 'CHB', label: 'CHB — Centre Half Back' },
  { value: 'W', label: 'W — Wing' },
  { value: 'C', label: 'C — Centre' },
  { value: 'HFF', label: 'HFF — Half Forward Flank' },
  { value: 'CHF', label: 'CHF — Centre Half Forward' },
  { value: 'FP', label: 'FP — Forward Pocket' },
  { value: 'FF', label: 'FF — Full Forward' },
  { value: 'Ru', label: 'Ru — Ruck' },
  { value: 'RR', label: 'RR — Ruck Rover' },
  { value: 'Ro', label: 'Ro — Rover' },
  { value: 'IC', label: 'IC — Interchange' },
];

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
const stat = (key = 'stat', label = 'Statistic'): GridParamDef => ({ key, label, kind: 'stat' });
const int = (key: string, label: string): GridParamDef => ({ key, label, kind: 'integer' });
const decimal = (key: string, label: string): GridParamDef => ({ key, label, kind: 'decimal' });
const season = (key: string, label: string): GridParamDef => ({ key, label, kind: 'season' });
const award = (label = 'Award'): GridParamDef => ({ key: 'award', label, kind: 'award' });
const draftType = (label = 'Draft type'): GridParamDef => ({ key: 'draftType', label, kind: 'draftType' });
const signingKind = (label = 'Recruited from'): GridParamDef => ({ key: 'signingKind', label, kind: 'signingKind' });
const aaPosition = (label = 'Position'): GridParamDef => ({ key: 'position', label, kind: 'aaPosition' });

// "Single-game feats" is added in Phase B once builders actually populate
// it -- an empty category here would let the form select a category whose
// Question dropdown has nothing in it.
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

// Phase A ships infrastructure only: the original 31 builders (unchanged
// behaviour) plus the captaincy fix (2 relabels + 2 new). Phases B/C/D add
// the remaining ~60 entries category by category, each landing here in the
// same commit as its compileAxis case so GRID_BUILDER_KEYS never names a
// builder grid-solver.ts can't yet compile -- tests/integration/grid-solver.test.ts's
// it.each(GRID_BUILDER_KEYS) loop would otherwise fail between phases.
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

  // Captaincy -- club_captain/captain_between_seasons kept their original
  // keys and behaviour from V1 but are relabelled here: they were always
  // "captain of a specific club" and "captain of any club in a season
  // range" respectively, not the generic questions their old labels
  // suggested. club_captain_any and captain_of_club_between_seasons fill
  // the two gaps that mislabelling was hiding.
  club_captain: { key: 'club_captain', label: 'Captain of club', group: 'Captaincy', params: [club()] },
  club_captain_any: { key: 'club_captain_any', label: 'Club captain', group: 'Captaincy', params: [] },
  captain_between_seasons: { key: 'captain_between_seasons', label: 'Club captain between seasons', group: 'Captaincy', params: [season('from', 'From season'), season('to', 'To season')] },
  captain_of_club_between_seasons: { key: 'captain_of_club_between_seasons', label: 'Captain of club between seasons', group: 'Captaincy', params: [club(), season('from', 'From season'), season('to', 'To season')] },

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
