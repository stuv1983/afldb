/**
 * Natural-language query plan: the structured intermediate representation
 * every question is turned into before it ever reaches SQL.
 *
 *   Question -> parser (parser.ts) -> NlQueryPlan -> validatePlan -> a
 *   grain compiler (db/queries/nl/*.ts) -> NlAnswer
 *
 * This module is deliberately DB-free and carries no `server-only` import,
 * like grid-solver-spec.ts and match-spec.ts: it is the shared vocabulary
 * between the (client-safe) parser and the (server-only) compilers, and it
 * has to be unit-testable without a database connection.
 *
 * THE LLM SEAM: nothing here cares how a plan was produced. The
 * deterministic parser in parser.ts is the only producer today, but any
 * future component -- an LLM fallback for a question the deterministic
 * parser declines -- only has to emit an object that satisfies
 * `validatePlan`. It never gets to emit SQL, a column name outside
 * NL_METRICS/NL_CAREER_COLUMNS/NL_AWARDS, or an unbounded limit. The
 * validation gate is the same for a plan from the parser and a plan from
 * anywhere else.
 *
 * Every identifier a plan carries into SQL is a lookup into one of the
 * fixed maps below or a GridAxisState builder key already checked
 * against GRID_BUILDERS -- the same allowlist-then-bind discipline every
 * other query surface in this codebase follows (see query-builder-spec.ts,
 * grid-solver-spec.ts). A bound value (an award slug, a threshold number)
 * reaching SQL as a parameter is never a safety concern by itself; the
 * allowlists exist so a plan can only ASK about a concept this codebase
 * has actually verified exists and is answerable, not to prevent
 * injection through a value that was always going to be bound.
 */

import { decodeUrlState, encodeUrlState } from '@/lib/urlState';
import { GRID_BUILDERS, GRID_STATS, isGridStatKey, type GridAxisState, type GridStatKey } from '@/search/grid-solver-spec';

// ---------------------------------------------------------------- version

/**
 * Bumped whenever the parser's vocabulary or decision logic changes in a
 * way that would make two log rows not directly comparable -- phase F's
 * tuning pass groups by this so a vocabulary addition doesn't get
 * credited (or blamed) for outcomes it couldn't have affected.
 *
 * The bump belongs IN the commit that changes the behaviour, not in a
 * later cleanup: version 1 sat unchanged through several vocabulary and
 * role-logic fixes, which quietly made "version 1" span two different
 * parsers in the log.
 *
 * 2: stress-run review batch -- total_score reachable, decades parsed,
 *    strict top-N counts, justified-token player consumption, club-season
 *    routing for named clubs, player_season for club+season leaderboards,
 *    surname-ambiguity detection, and the clarify-band leftover gate.
 * 3: conversational filler stripped at canonicalisation ("can you tell me",
 *    "show me", "afl question", "please"), decorative punctuation including
 *    the em dash, and "vs"/"v" recognised as the preposition they always
 *    were -- the largest failure cause in the 250,000-question run.
 */
export const PARSER_VERSION = 3;

// ------------------------------------------------------------------ grain

export type NlGrain = 'player_career' | 'player_game' | 'player_season' | 'team_match' | 'club_season';

// ---------------------------------------------------------------- entities

export type NlPlayerRef = { id: number; slug: string; name: string };
/** organizationId is club_organizations.id (lineage-level), the same id space grid-solver club params use. */
export type NlClubRef = { organizationId: number; slug: string; name: string };
export type NlVenueRef = { id: number; slug: string; name: string };

export type NlMatchType =
  | 'finals' | 'home_and_away' | 'grand_final' | 'preliminary_final'
  | 'semi_final' | 'qualifying_final' | 'elimination_final';

const NL_MATCH_TYPES: readonly NlMatchType[] = [
  'finals', 'home_and_away', 'grand_final', 'preliminary_final',
  'semi_final', 'qualifying_final', 'elimination_final',
];

export function isNlMatchType(value: string): value is NlMatchType {
  return (NL_MATCH_TYPES as readonly string[]).includes(value);
}

export type NlMatchScope = {
  /** "for/by Richmond": the player/team side of the question. */
  clubFor?: NlClubRef;
  /** "against Carlton": the opponent side. */
  clubAgainst?: NlClubRef;
  /** "at the MCG". */
  venue?: NlVenueRef;
  seasonMin?: number;
  seasonMax?: number;
  matchType?: NlMatchType;
};

// -------------------------------------------------------- comparison ops

/**
 * "at least" / "more than" are different questions (>= vs >), and the
 * acceptance criteria for this feature requires both distinctly, so gte
 * and gt are kept apart rather than collapsed -- same for lte/lt.
 */
export type NlCompareOp = 'gte' | 'lte' | 'gt' | 'lt' | 'eq';

// -------------------------------------------------------- career columns

/**
 * Fixed name -> `c.<column>` map, `c` being player_career_stats. The ONLY
 * path a plain career-condition column reaches SQL: compilers must look
 * the name up here (never splice a request-typed name into `sql.unsafe`
 * directly), the same discipline CAREER_RECORD_FILTER_COLUMNS and
 * PLAYER_FILTER_COLUMNS already apply.
 *
 * Era-limited stat columns (behinds..hitouts) are included because a
 * threshold condition on them ("500+ career disposals") is a legitimate
 * question; NL_COVERAGE below is what makes an answer using one of them
 * carry a coverage note or get declined against a season range that
 * predates the stat.
 */
export const NL_CAREER_COLUMNS = {
  games: 'c.games',
  goals: 'c.goals',
  finals: 'c.finals',
  premierships: 'c.premierships',
  wins: 'c.wins',
  draws: 'c.draws',
  losses: 'c.losses',
  brownlow_votes: 'c.brownlow_votes',
  brownlow_medals: 'c.brownlow_medals',
  clubs_played: 'c.clubs_played',
  seasons_played: 'c.seasons_played',
  debut_season: 'c.debut_season',
  final_season: 'c.final_season',
  behinds: 'c.behinds',
  kicks: 'c.kicks',
  handballs: 'c.handballs',
  disposals: 'c.disposals',
  marks: 'c.marks',
  tackles: 'c.tackles',
  hitouts: 'c.hitouts',
} as const;

export type NlCareerColumn = keyof typeof NL_CAREER_COLUMNS;

export function isNlCareerColumn(value: string): value is NlCareerColumn {
  return Object.hasOwn(NL_CAREER_COLUMNS, value);
}

// ------------------------------------------------------------------ awards

/**
 * Honours that are a COUNT of linked award_winners rows rather than a
 * player_career_stats column -- All-Australian selections chief among
 * them (there is no precomputed "AA selections" total anywhere; it is
 * counted from award_winners at query time, the same join
 * best_and_fairest_multi_club already uses for a related count).
 *
 * A closed, named set rather than an arbitrary award slug: the parser
 * only ever asks about a concept this codebase has confirmed exists and
 * is answerable this way, the same reasoning GRID_BUILDERS is closed.
 */
export const NL_AWARDS = {
  all_australian: { slug: 'all-australian', label: 'All-Australian selections' },
} as const;

export type NlAwardKey = keyof typeof NL_AWARDS;

export function isNlAwardKey(value: string): value is NlAwardKey {
  return Object.hasOwn(NL_AWARDS, value);
}

// ---------------------------------------------------------- career conditions

/**
 * A single filter at player_career grain. `column` conditions read
 * player_career_stats directly; `award_count` conditions count linked
 * award_winners rows for a closed award key. `eq` with value 0 is how a
 * negative reads: "no premiership" = { kind:'column', column:
 * 'premierships', op:'eq', value: 0 }.
 */
export type NlCareerCondition =
  | { kind: 'column'; column: NlCareerColumn; op: NlCompareOp; value: number }
  | { kind: 'award_count'; awardKey: NlAwardKey; op: NlCompareOp; value: number };

// -------------------------------------------------------------- metrics

/**
 * Per-grain metric allowlist. A metric name is meaningless without its
 * grain -- "goals" at player_game grain reads player_match_stats.goals,
 * at player_career grain reads player_career_stats.goals, at team_match
 * grain doesn't exist at all (team scoring uses team_score/win_margin/…).
 *
 * A `column` metric's `statKey`, present only for the two player grains,
 * is the GridStatKey this metric shares with the grid solver's own stat
 * vocabulary (GRID_STATS), so grain and coverage tagging come from one
 * source rather than two copies drifting. An `award_count` metric ranks
 * players by how many times they hold a closed-set award (see NL_AWARDS)
 * rather than by a career_stats column.
 */
export type NlMetricDef =
  | { kind: 'column'; key: string; label: string; column: string; statKey?: GridStatKey }
  | { kind: 'award_count'; key: string; label: string; awardKey: NlAwardKey };

function columnMetric(key: string, label: string, column: string, statKey?: GridStatKey): NlMetricDef {
  return { kind: 'column', key, label, column, statKey };
}

const PLAYER_STAT_METRICS: Record<string, NlMetricDef> = Object.fromEntries(
  (Object.keys(GRID_STATS) as GridStatKey[]).map((key) => [
    key,
    columnMetric(key, GRID_STATS[key].label, key, key),
  ]),
);

export const NL_METRICS: Record<NlGrain, Record<string, NlMetricDef>> = {
  player_game: {
    ...PLAYER_STAT_METRICS,
    brownlow_votes: columnMetric('brownlow_votes', 'Brownlow votes', 'brownlow_votes'),
  },
  player_season: {
    ...PLAYER_STAT_METRICS,
    brownlow_votes: columnMetric('brownlow_votes', 'Brownlow votes', 'brownlow_votes'),
    games: columnMetric('games', 'Games', 'games'),
    wins: columnMetric('wins', 'Wins', 'wins'),
  },
  player_career: {
    games: columnMetric('games', 'Games', 'c.games'),
    goals: columnMetric('goals', 'Goals', 'c.goals', 'goals'),
    finals: columnMetric('finals', 'Finals', 'c.finals'),
    premierships: columnMetric('premierships', 'Premierships', 'c.premierships'),
    brownlow_votes: columnMetric('brownlow_votes', 'Brownlow votes', 'c.brownlow_votes'),
    behinds: columnMetric('behinds', 'Behinds', 'c.behinds', 'behinds'),
    kicks: columnMetric('kicks', 'Kicks', 'c.kicks', 'kicks'),
    handballs: columnMetric('handballs', 'Handballs', 'c.handballs', 'handballs'),
    disposals: columnMetric('disposals', 'Disposals', 'c.disposals', 'disposals'),
    marks: columnMetric('marks', 'Marks', 'c.marks', 'marks'),
    tackles: columnMetric('tackles', 'Tackles', 'c.tackles', 'tackles'),
    hitouts: columnMetric('hitouts', 'Hitouts', 'c.hitouts', 'hitouts'),
    // The 13 live_only stats have no precomputed career column; a
    // compiler reading one of these keys joins a GROUP BY subquery over
    // player_match_stats instead (careerStatValueExpr in grid-solver.ts
    // already does exactly this for the grid catalogue) -- column here
    // is the bare stat name, a marker for the compiler, not literal SQL.
    rebounds: columnMetric('rebounds', 'Rebound 50s', 'rebounds', 'rebounds'),
    inside_50s: columnMetric('inside_50s', 'Inside 50s', 'inside_50s', 'inside_50s'),
    clearances: columnMetric('clearances', 'Clearances', 'clearances', 'clearances'),
    clangers: columnMetric('clangers', 'Clangers', 'clangers', 'clangers'),
    contested: columnMetric('contested', 'Contested possessions', 'contested', 'contested'),
    uncontested: columnMetric('uncontested', 'Uncontested possessions', 'uncontested', 'uncontested'),
    goal_assists: columnMetric('goal_assists', 'Goal assists', 'goal_assists', 'goal_assists'),
    // Award-count metrics: ranking "most X selections" rather than a
    // plain column.
    all_australian_selections: { kind: 'award_count', key: 'all_australian_selections', label: 'All-Australian selections', awardKey: 'all_australian' },
  },
  team_match: {
    win_margin: columnMetric('win_margin', 'Winning margin', 'margin'),
    loss_margin: columnMetric('loss_margin', 'Losing margin', 'margin'),
    team_score: columnMetric('team_score', 'Score', 'score_for'),
    opponent_score: columnMetric('opponent_score', "Opponent's score", 'score_against'),
    total_score: columnMetric('total_score', 'Combined score', '(score_for + score_against)'),
    attendance: columnMetric('attendance', 'Attendance', 'attendance'),
  },
  club_season: {
    wins: columnMetric('wins', 'Wins', 'wins'),
    losses: columnMetric('losses', 'Losses', 'losses'),
    draws: columnMetric('draws', 'Draws', 'draws'),
    percentage: columnMetric('percentage', 'Percentage', 'percentage'),
  },
};

export function isNlMetric(grain: NlGrain, metric: string): boolean {
  return Object.hasOwn(NL_METRICS[grain], metric);
}

// ------------------------------------------------------------- coverage

/**
 * When each stat was first recorded, and the note an answer using it
 * should carry. Deliberately static rather than a live query per answer
 * -- an integration test (tests/integration/nl-answers.test.ts) asserts
 * this stays in step with the stat_availability registry, the same
 * "checked against the source of truth, not trusted to stay in sync by
 * hand" discipline the grid solver's GRID_STATS grain tags already rely
 * on being right.
 */
export type NlCoverage = { firstSeason: number; note: string };

export const NL_COVERAGE: Partial<Record<string, NlCoverage>> = {
  behinds: { firstSeason: 1965, note: 'Behinds were not recorded before 1965.' },
  kicks: { firstSeason: 1965, note: 'Kicks were not recorded before 1965.' },
  handballs: { firstSeason: 1965, note: 'Handballs were not recorded before 1965.' },
  disposals: { firstSeason: 1965, note: 'Disposals were not recorded before 1965.' },
  marks: { firstSeason: 1965, note: 'Marks were not recorded before 1965.' },
  hitouts: { firstSeason: 1966, note: 'Hitouts were not recorded before 1966.' },
  tackles: { firstSeason: 1987, note: 'Tackles were not recorded before 1987.' },
  clangers: { firstSeason: 1998, note: 'Clangers were not recorded before 1998.' },
  clearances: { firstSeason: 1998, note: 'Clearances were not recorded before 1998.' },
  inside_50s: { firstSeason: 1998, note: 'Inside 50s were not recorded before 1998.' },
  rebounds: { firstSeason: 1998, note: 'Rebound 50s were not recorded before 1998.' },
  contested: { firstSeason: 1999, note: 'Contested possessions were not recorded before 1999.' },
  uncontested: { firstSeason: 1999, note: 'Uncontested possessions were not recorded before 1999.' },
  bounces: { firstSeason: 1999, note: 'Bounces were not recorded before 1999.' },
  goal_assists: { firstSeason: 2003, note: 'Goal assists were not recorded before 2003.' },
  // Per-game Brownlow votes exist only for 1931-1934 and 1984-2025, and
  // never for finals -- a range, not a floor, so it's a fixed note a
  // compiler attaches whenever brownlow_votes is used at player_game
  // grain, rather than a firstSeason entry here.
};

export const BROWNLOW_GAME_VOTE_NOTE =
  'Per-game Brownlow votes are recorded only for 1931-1934 and 1984 onward, and never for finals.';

// ---------------------------------------------------------------- boundary

export type NlBoundary = {
  event: 'debut' | 'last_game';
  where: 'grand_final' | 'final';
};

// -------------------------------------------------------- club-season conditions

/**
 * Boolean club_season-grain filters -- "fewest wins by a premier",
 * "worst team to make finals". A closed, named set rather than a generic
 * predicate, the same reasoning NL_AWARDS and GRID_BUILDERS are closed:
 * each reads one already-computed club_seasons column
 * (is_premier/wooden_spoon/finals_played), never a request-typed
 * condition.
 */
export type NlClubSeasonCondition = { kind: 'premier' | 'wooden_spoon' | 'made_finals' | 'missed_finals' };

const NL_CLUB_SEASON_CONDITION_KINDS: readonly NlClubSeasonCondition['kind'][] = [
  'premier', 'wooden_spoon', 'made_finals', 'missed_finals',
];

export function isNlClubSeasonConditionKind(value: string): value is NlClubSeasonCondition['kind'] {
  return (NL_CLUB_SEASON_CONDITION_KINDS as readonly string[]).includes(value);
}

// -------------------------------------------------------------- aggregation

export type NlAggregation =
  | { kind: 'max' }
  | { kind: 'min' }
  | { kind: 'top_n'; n: number }
  | { kind: 'list' }
  | { kind: 'count' };

// -------------------------------------------------------------------- plan

export type NlQueryPlan = {
  v: 1;
  grain: NlGrain;
  /** null only for a pure list/count question with no ranked metric (e.g. "players who debuted in a grand final"). */
  metric: string | null;
  /** player_game only: one performance ("in a game") vs a scoped total ("against Carlton" summed across games). */
  mode?: 'single' | 'sum';
  agg: NlAggregation;
  /** The question's subject player, e.g. "dusty's highest disposal game". */
  player?: NlPlayerRef;
  scope: NlMatchScope;
  /** player_career only. */
  careerConditions: NlCareerCondition[];
  /** player_career only; each compiled by grid-solver's compileAxis. */
  careerPredicates: GridAxisState[];
  /** club_season only. */
  clubSeasonConditions: NlClubSeasonCondition[];
  boundary?: NlBoundary;
  /** Whether a value tied for the extreme all come back, or only the first found. Default 'all'. */
  tiePolicy: 'all' | 'first';
  limit: number;
};

export const NL_LIMITS = {
  /** Display cap for a max/min answer's tie list. */
  maxTiedRows: 25,
  /** Display cap for a top-N or list answer, ties at the boundary included. */
  maxListRows: 100,
  minTopN: 1,
  maxTopN: 50,
  maxCareerConditions: 8,
  maxCareerPredicates: 8,
  maxClubSeasonConditions: 4,
  minSeason: 1897,
  maxSeason: 2100,
} as const;

/**
 * Configurable confidence thresholds (kept as named constants rather
 * than inline numbers so a tuning pass can move them without hunting
 * through parser.ts): at or above EXECUTE, answer outright; between
 * CLARIFY and EXECUTE, answer only when every entity/metric the plan
 * needs resolved unambiguously (see parser.ts's decision logic), else
 * decline with reason 'ambiguous'; below CLARIFY, decline outright with
 * reason 'low_confidence'. A plan is never fabricated to force a result.
 */
export const NL_CONFIDENCE = {
  execute: 0.85,
  clarify: 0.60,
} as const;

// -------------------------------------------------------------- validation

export type NlValidationError = { error: string };

const COMPARE_OPS: readonly NlCompareOp[] = ['gte', 'lte', 'gt', 'lt', 'eq'];

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

function validateRef(
  ref: unknown,
  idField: string,
  label: string,
): NlValidationError | null {
  if (ref === undefined) return null;
  if (typeof ref !== 'object' || ref === null) return { error: `${label} reference is malformed.` };
  const r = ref as Record<string, unknown>;
  if (!isPositiveInt(r[idField])) return { error: `${label} reference has no valid id.` };
  if (typeof r.slug !== 'string' || typeof r.name !== 'string') {
    return { error: `${label} reference is missing slug or name.` };
  }
  return null;
}

function validateCondition(cond: NlCareerCondition): NlValidationError | null {
  if (!COMPARE_OPS.includes(cond.op)) return { error: 'Unknown comparison.' };
  if (!Number.isFinite(cond.value)) return { error: 'A condition needs a numeric value.' };
  if (cond.kind === 'column') {
    if (!isNlCareerColumn(cond.column)) return { error: `Unknown career statistic "${cond.column}".` };
    return null;
  }
  if (cond.kind === 'award_count') {
    if (!isNlAwardKey(cond.awardKey)) return { error: `Unknown award "${cond.awardKey}".` };
    return null;
  }
  return { error: 'Unknown condition shape.' };
}

/**
 * Full structural and semantic validation of a plan, run regardless of
 * where the plan came from -- defence in depth even for a plan the
 * parser itself just built, and the ONLY gate a future non-deterministic
 * producer (an LLM fallback) would need to pass. Never throws; returns
 * either a plan clamped to the documented limits, or an error message
 * safe to show the reader.
 */
export function validatePlan(raw: NlQueryPlan): NlQueryPlan | NlValidationError {
  if (raw.v !== 1) return { error: 'Unrecognised plan version.' };

  const grains: NlGrain[] = ['player_career', 'player_game', 'player_season', 'team_match', 'club_season'];
  if (!grains.includes(raw.grain)) return { error: `Unknown grain "${raw.grain}".` };

  if (raw.metric !== null && !isNlMetric(raw.grain, raw.metric)) {
    return { error: `"${raw.metric}" is not a recognised statistic for this kind of question.` };
  }
  // Only player_career and club_season can be answered as a plain list
  // with no ranked metric ("players with 300 games and no premiership").
  // Every other grain's compiler ranks by a metric and has no other
  // question shape to fall back to.
  if (raw.metric === null && (raw.grain === 'player_game' || raw.grain === 'player_season' || raw.grain === 'team_match')) {
    return { error: 'This kind of question needs a statistic to rank by.' };
  }

  if (raw.grain === 'player_game' && raw.mode === undefined) {
    return { error: 'A player-game question must say whether it means one game or a total across games.' };
  }
  if (raw.grain !== 'player_game' && raw.mode !== undefined) {
    return { error: 'Only a single-game question can be "single" or "sum".' };
  }

  if (raw.grain !== 'player_career' && (raw.careerConditions.length > 0 || raw.careerPredicates.length > 0)) {
    return { error: 'Career conditions only apply to a career-grain question.' };
  }
  if (raw.careerConditions.length > NL_LIMITS.maxCareerConditions) {
    return { error: `A question can combine at most ${NL_LIMITS.maxCareerConditions} conditions.` };
  }
  for (const cond of raw.careerConditions) {
    const err = validateCondition(cond);
    if (err) return err;
  }
  if (raw.careerPredicates.length > NL_LIMITS.maxCareerPredicates) {
    return { error: `A question can combine at most ${NL_LIMITS.maxCareerPredicates} predicates.` };
  }
  for (const axis of raw.careerPredicates) {
    if (!Object.hasOwn(GRID_BUILDERS, axis.builder)) {
      return { error: `Unknown question shape "${axis.builder}".` };
    }
  }

  if (raw.grain !== 'club_season' && raw.clubSeasonConditions.length > 0) {
    return { error: 'Club-season conditions only apply to a club-season question.' };
  }
  if (raw.clubSeasonConditions.length > NL_LIMITS.maxClubSeasonConditions) {
    return { error: `A question can combine at most ${NL_LIMITS.maxClubSeasonConditions} club-season conditions.` };
  }
  for (const cond of raw.clubSeasonConditions) {
    if (!isNlClubSeasonConditionKind(cond.kind)) return { error: `Unknown club-season condition "${cond.kind}".` };
  }

  if (raw.boundary) {
    if (!['debut', 'last_game'].includes(raw.boundary.event)) return { error: 'Unknown boundary event.' };
    if (!['grand_final', 'final'].includes(raw.boundary.where)) return { error: 'Unknown boundary target.' };
    if (raw.grain !== 'player_career') return { error: 'A boundary question is answered at career grain.' };
  }

  const playerErr = validateRef(raw.player, 'id', 'Player');
  if (playerErr) return playerErr;
  const forErr = validateRef(raw.scope.clubFor, 'organizationId', 'Club');
  if (forErr) return forErr;
  const againstErr = validateRef(raw.scope.clubAgainst, 'organizationId', 'Opponent club');
  if (againstErr) return againstErr;
  const venueErr = validateRef(raw.scope.venue, 'id', 'Venue');
  if (venueErr) return venueErr;

  if (raw.scope.matchType !== undefined && !isNlMatchType(raw.scope.matchType)) {
    return { error: `Unknown match type "${raw.scope.matchType}".` };
  }

  const { seasonMin, seasonMax } = raw.scope;
  if (seasonMin !== undefined && (seasonMin < NL_LIMITS.minSeason || seasonMin > NL_LIMITS.maxSeason)) {
    return { error: 'Season is out of range.' };
  }
  if (seasonMax !== undefined && (seasonMax < NL_LIMITS.minSeason || seasonMax > NL_LIMITS.maxSeason)) {
    return { error: 'Season is out of range.' };
  }
  if (seasonMin !== undefined && seasonMax !== undefined && seasonMin > seasonMax) {
    return { error: 'The season range is backwards.' };
  }

  // Era coverage: a metric whose earliest recorded season is entirely
  // after the requested range cannot be answered, and must say so rather
  // than silently return nothing (the same principle records.ts states
  // on every era-limited category and search.md enforces for filters).
  if (raw.metric) {
    const coverage = NL_COVERAGE[raw.metric];
    if (coverage && seasonMax !== undefined && seasonMax < coverage.firstSeason) {
      return {
        error: `${coverage.note} Nothing in ${seasonMin ?? 'the requested range'}-${seasonMax} can be recorded.`,
      };
    }
  }

  if (raw.agg.kind === 'top_n') {
    if (!Number.isInteger(raw.agg.n) || raw.agg.n < NL_LIMITS.minTopN) {
      return { error: 'A "top N" question needs a positive count.' };
    }
  }

  if (!['all', 'first'].includes(raw.tiePolicy)) return { error: 'Unknown tie policy.' };

  // Clamp rather than reject: an oversized N or limit is the reader
  // asking for more than the display supports, not a malformed question.
  const clampedAgg: NlAggregation = raw.agg.kind === 'top_n'
    ? { kind: 'top_n', n: Math.min(raw.agg.n, NL_LIMITS.maxTopN) }
    : raw.agg;
  const isRankedList = raw.agg.kind === 'top_n' || raw.agg.kind === 'list';
  const cap = isRankedList ? NL_LIMITS.maxListRows : NL_LIMITS.maxTiedRows;
  const clampedLimit = Math.min(Math.max(1, raw.limit), cap);

  return { ...raw, agg: clampedAgg, limit: clampedLimit };
}

// --------------------------------------------------------- English gloss

const AGG_WORDS: Record<NlAggregation['kind'], string> = {
  max: 'the highest',
  min: 'the lowest',
  top_n: 'the top',
  list: 'every',
  count: 'a count of',
};

const GRAIN_LABEL: Record<NlGrain, string> = {
  player_career: 'career',
  player_game: 'single-match',
  player_season: 'season',
  team_match: 'match',
  club_season: 'club season',
};

/** The subject noun for a grain with no ranked metric ("every matching <noun>"). */
const GRAIN_SUBJECT: Record<NlGrain, string> = {
  player_career: 'player',
  player_game: 'player',
  player_season: 'player',
  team_match: 'club',
  club_season: 'club season',
};

const OP_WORDS: Record<NlCompareOp, string> = {
  gte: 'at least', lte: 'at most', gt: 'more than', lt: 'less than', eq: 'exactly',
};

const CLUB_SEASON_CONDITION_LABEL: Record<NlClubSeasonCondition['kind'], string> = {
  premier: 'Premiers that season',
  wooden_spoon: 'Wooden spoon that season',
  made_finals: 'Played finals that season',
  missed_finals: 'Missed finals that season',
};

function metricLabelOf(grain: NlGrain, metric: string | null): string | null {
  if (!metric) return null;
  return NL_METRICS[grain][metric]?.label ?? metric;
}

/**
 * A short, ordered restatement of the plan in English, for the "How was
 * this calculated?" panel. Deliberately mechanical rather than a natural
 * sentence -- it is a trace of what was searched, not marketing copy.
 */
export function describePlan(plan: NlQueryPlan): string[] {
  const lines: string[] = [];

  const metricLabel = metricLabelOf(plan.grain, plan.metric);
  const aggWord = AGG_WORDS[plan.agg.kind];
  if (metricLabel) {
    lines.push(plan.agg.kind === 'top_n'
      ? `Ranked ${GRAIN_LABEL[plan.grain]} ${metricLabel.toLowerCase()}, ${aggWord} ${(plan.agg as { n: number }).n}.`
      : `Searched for ${aggWord} ${GRAIN_LABEL[plan.grain]} ${metricLabel.toLowerCase()}.`);
  } else {
    lines.push(`Searched ${GRAIN_LABEL[plan.grain]} records for ${aggWord} matching ${GRAIN_SUBJECT[plan.grain]}.`);
  }

  if (plan.player) lines.push(`Player: ${plan.player.name}.`);
  if (plan.scope.clubFor) lines.push(`Club: ${plan.scope.clubFor.name}.`);
  if (plan.scope.clubAgainst) lines.push(`Opponent: ${plan.scope.clubAgainst.name}.`);
  if (plan.scope.venue) lines.push(`Venue: ${plan.scope.venue.name}.`);
  if (plan.scope.matchType) lines.push(`Match type: ${plan.scope.matchType.replace(/_/g, ' ')}.`);
  if (plan.scope.seasonMin !== undefined || plan.scope.seasonMax !== undefined) {
    lines.push(`Seasons: ${plan.scope.seasonMin ?? '…'}-${plan.scope.seasonMax ?? '…'}.`);
  }
  for (const cond of plan.careerConditions) {
    const opWord = OP_WORDS[cond.op];
    if (cond.kind === 'column') {
      lines.push(`Condition: ${NL_CAREER_COLUMNS[cond.column]} ${opWord} ${cond.value}.`);
    } else {
      lines.push(`Condition: ${NL_AWARDS[cond.awardKey].label} ${opWord} ${cond.value}.`);
    }
  }
  for (const axis of plan.careerPredicates) {
    lines.push(`Condition: ${GRID_BUILDERS[axis.builder]?.label ?? axis.builder}.`);
  }
  for (const cond of plan.clubSeasonConditions) {
    lines.push(`Condition: ${CLUB_SEASON_CONDITION_LABEL[cond.kind]}.`);
  }
  if (plan.boundary) {
    lines.push(`Boundary: ${plan.boundary.event === 'debut' ? 'debut' : 'final'} game was a ${
      plan.boundary.where === 'grand_final' ? 'Grand Final' : 'final'}.`);
  }
  lines.push(plan.tiePolicy === 'all' ? 'Ties: every player sharing the value is included.' : 'Ties: only the first found is shown.');

  return lines;
}

// ------------------------------------------------------------ URL token

/** Hard ceiling on a plan token's decoded size, mirroring GRID_LIMITS.maxStateChars. */
const MAX_PLAN_TOKEN_CHARS = 4_096;

/** Encode a validated plan for the "refine" / follow-up seam (?plan=<token>). */
export function encodePlanToken(plan: NlQueryPlan): string {
  return encodeUrlState(plan, MAX_PLAN_TOKEN_CHARS);
}

/** Decode a plan token back to a raw (unvalidated) shape, or null. Callers must still run validatePlan. */
export function decodePlanToken(token: string): NlQueryPlan | null {
  const raw = decodeUrlState(token, MAX_PLAN_TOKEN_CHARS);
  if (!raw || typeof raw !== 'object') return null;
  return raw as NlQueryPlan;
}

// -------------------------------------------------------------- reports

export type NlEntityResolution = { mention: string; resolvedTo: string; certainty: number };

/**
 * The factors `confidence` was multiplied/penalised by, kept alongside the
 * final number rather than only the number itself -- a lone 0.62 doesn't
 * say whether that came from a fuzzy player match, an unresolved mention,
 * or a plan with no metric/condition to anchor it, and a tuning pass needs
 * to tell those apart. Not shown to readers; a debugging/log aid only.
 */
export type NlConfidenceComponents = {
  /** Fraction of meaningful input tokens the parser recognised and used. */
  tokenRatio: number;
  /** Player-name resolution certainty (1 = exact/unambiguous, <1 = a fuzzy match was accepted). */
  playerCertainty: number;
  /** Multiplier applied when the plan has no metric/condition/boundary to anchor it (1 = no penalty). */
  structuralPenalty: number;
  /** Flat subtraction when a player-like mention in the text could not be resolved to anyone. */
  unresolvedPenalty: number;
};

export type NlParseReport = {
  /** 0..1. See NL_CONFIDENCE for the thresholds this drives. */
  confidence: number;
  components: NlConfidenceComponents;
  normalisedQuery: string;
  consumed: string[];
  /**
   * Words the parser recognised as meaningful but could not act on --
   * surfaced to the reader ("AFLDB doesn't support: clangers") rather
   * than silently dropped, and mined from the search log to grow the
   * vocabulary (db/queries/nl/log.ts, phase F).
   */
  unsupportedTerms: string[];
  /** Interpretation caveats to surface alongside the answer ("Reading 'won' as premierships"). */
  notes: string[];
  entityResolution: NlEntityResolution[];
  /**
   * A player mention the resolver returned candidates for but would not
   * commit to -- "ablett" surfacing both Gary Abletts. Distinct from
   * unsupportedTerms because the failure reason differs in kind: the
   * word IS understood, it just names more than one person, and the log
   * and decline message should say ambiguous_player, not
   * "unsupported term".
   */
  ambiguousPlayer?: string;
};

export type NlDeclineReason = 'unrecognised' | 'low_confidence' | 'ambiguous';

export type NlParse =
  | { status: 'plan'; plan: NlQueryPlan; report: NlParseReport }
  | { status: 'unanswerable'; topic: string; reason: string; report: NlParseReport }
  | { status: 'none'; reason: NlDeclineReason; report: NlParseReport };

// Re-exported so callers of this module never need to import
// grid-solver-spec.ts themselves just to type a GridAxisState.
export type { GridAxisState };
export { isGridStatKey, type GridStatKey };
