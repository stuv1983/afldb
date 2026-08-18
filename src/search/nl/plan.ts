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
 * 4: "ambiguous player" now requires two candidates that plausibly spell
 *    the mention, not merely a non-empty candidate list. Changes only the
 *    decline REASON, never the plan -- but failure_reason is exactly what
 *    the tuning pass groups by, so the rows must not be pooled with v3's.
 * 5: coverage is a refusal, not a footnote. NlCoverage can now express a
 *    discontinuous range and a match-type exclusion, so per-game Brownlow
 *    votes decline for 1935-1983 and for finals rather than answering with
 *    a note that contradicts the number above it.
 * 6: "at most" is no longer read as the superlative "most" -- it inverted
 *    the first condition of a multi-clause question to its opposite and
 *    ranked instead of listing.
 * 7: a boundary question no longer repeats its match type in scope. Slang
 *    ("possies", "snags", "danger") and the multi-word stat-games idioms
 *    ("uncontested possessions game", "inside-fifties game") resolve.
 *    ALSO shipped a season-range grain split, reverted in 8 -- see below.
 * 8: reverts 7's season-range split. Routing a range to a summed
 *    player_game answered "most tackles since 1900" with a career total
 *    (Scott Pendlebury, 2022) where the verified answer is a season
 *    record (Tom Atkins, 232). Any named season scope is a season
 *    leaderboard again.
 * 9: grounded UI qualification fixes, deployed as three commits in quick
 *    succession without a re-bump between them -- the discipline this
 *    header asks for lapsed for two of the three, so version 9 spans more
 *    ground than a version normally should. Recorded in full rather than
 *    split after the fact, because nl_search_log rows already logged
 *    under "9" cannot retroactively be told apart: a tuning pass reading
 *    version 9 must treat it as the union of all of the below, not a
 *    single coherent behaviour.
 *    - venue-before-club extraction (a club name that is a whole word
 *      inside a venue name, e.g. "Melbourne" inside "Melbourne Cricket
 *      Ground", no longer wins the match), the empty-token confidence bug
 *      ("players with at least 2 clubs" scored tokenRatio 0 -- and so
 *      declined outright -- purely because every word in it was a
 *      stopword or a digit), new slang/vocabulary ("bag" and "bag of
 *      goals", "majors", "granny" for grand_final), and a subjective
 *      all-time-ranking refusal ("best team of all time" was confidently
 *      answering with all 1,640 club seasons on file).
 *    - every CAREER_STAT_WORDS column except games/goals/finals reachable
 *      as a bare ranking subject, not just a numbered threshold ("most
 *      premierships" used to decline outright); a named player asking for
 *      one of those columns ("Nick Dal Santo most games") now routes to
 *      player_career instead of a player_game grain with no matching
 *      column; the negativeTargets alternation-precedence bug ("most
 *      flags" was silently answering players-with-zero-premierships);
 *      CLUB_SUBJECT_LEADING requiring something to follow "clubs"/"teams"
 *      (bare "most clubs" no longer elects an unranked club_season dump);
 *      and a second vocabulary batch (sausage(s), "find the sticks",
 *      grab(s)/clunk(s), handpass(es), bare assist(s), numeral inside/
 *      rebound-50 forms, "forward entry", "the big dance", September,
 *      bare "spoon").
 *    - ambiguous-surname ranking: a mention with 2-12 plausible candidates
 *      ("Ablett most goals") now ranks across all of them via
 *      scope.playerIdIn instead of declining outright. This is a genuine
 *      plan-shape change (a new scope field, a status that used to be
 *      'decline' now 'plan') and the clearest case of the three that
 *      should have carried its own version number.
 * 10: extractCareerConditions' operator/number lookup used a fixed
 *    20-character lookbehind window. Two numeric career conditions close
 *    together in one sentence ("more than 300 clubs and over 10
 *    premierships") could have the first-processed clause (CAREER_STAT_WORDS
 *    is a fixed array order, not sentence order) open a window reaching
 *    across "and" into the other clause's number -- stealing it outright,
 *    or slicing through a multi-digit number and reading the severed
 *    remainder as if it were complete. The stolen span was then removed
 *    from the source text too, corrupting the clause it belonged to for
 *    the rest of the pass. A clause that lost its number this way was
 *    silently dropped, and the orphaned stat word could then be misread by
 *    bare-metric detection as a ranking subject instead of a condition
 *    ("at least 1 games and over 1 goals" turned "games" into the plan's
 *    metric). Found by the 250k-row V2 stress corpus, not hand-written
 *    cases. Fix: the lookbehind window is now clipped at the nearest
 *    preceding clause boundary (comma or "and"), so one clause's number
 *    search can never see a token belonging to the clause before it.
 * 11: "most wins" / "most losses" / "most draws" / "most brownlow medals" /
 *    "most clubs" answer instead of declining. Version 9 taught the parser
 *    to rank these columns, but NL_METRICS.player_career had no entry for
 *    any of them, so validatePlan rejected every one as "not a recognised
 *    statistic" -- which a reader can only read as "AFLDB does not track
 *    wins". Not a change to parsing (the plan was always right), but it
 *    moves these questions from outcome=unanswerable/coverage_unavailable
 *    to outcome=answered, which is exactly the shift that must not be
 *    pooled with version 10's rows when the log is read.
 * 12: "goal with their first kick" answers, as a career predicate and as a
 *    new achievement_summary grain ("which club has had the most", "by
 *    decade", "which clubs never have", "who was first/most recent").
 *    Two fixes ship with it, both in the plan-assembly step of parser.ts:
 *    careerPredicates was excluded from `structuralOk` and from the
 *    aggregation default, so the first parser-produced predicate plan
 *    would have declined as unrecognised, and -- once accepted -- would
 *    have defaulted to {kind:'max'} and been capped at 25 rows instead of
 *    listing all 100. Neither could fire before now: nothing in the
 *    parser had ever populated careerPredicates, so the array was always
 *    empty and both bugs were unreachable.
 */
export const PARSER_VERSION = 12;

// ------------------------------------------------------------------ grain

export type NlGrain =
  | 'player_career' | 'player_game' | 'player_season' | 'team_match' | 'club_season'
  /**
   * Summaries OF an achievement rather than a list of players who hold it
   * ("which club has had the most players kick a goal with their first
   * kick"). The player_career grain answers "who", filtered by the same
   * achievement as a career predicate; this one answers "how are they
   * distributed", which is a group-and-count no player-row grain can
   * express.
   */
  | 'achievement_summary';

// ----------------------------------------------------------- achievements

/**
 * Achievements that can be summarised, as a closed catalogue -- the same
 * shape and the same reason as NL_AWARDS: the value reaches SQL as a bound
 * parameter chosen from this map, never as text from the question.
 *
 * Adding a second player_achievement_type is one entry here plus one
 * GRID_BUILDERS entry; nothing else in this file changes.
 */
export const NL_ACHIEVEMENTS = {
  first_kick_goal: {
    value: 'first_kick_goal',
    label: 'Scored a goal with their first kick',
    /** The career predicate answering "who", for the player_career grain. */
    builder: 'first_kick_goal_player',
  },
} as const;

export type NlAchievementKey = keyof typeof NL_ACHIEVEMENTS;

export function isNlAchievementKey(value: string): value is NlAchievementKey {
  return Object.prototype.hasOwnProperty.call(NL_ACHIEVEMENTS, value);
}

/**
 * by_club/by_decade/by_season are distributions; clubs_without is the
 * inverse ("which clubs have never had one"); earliest/latest name the
 * first and most recent occurrence.
 */
export type NlAchievementSummaryKind =
  | 'by_club' | 'by_decade' | 'by_season' | 'clubs_without' | 'earliest' | 'latest';

const NL_ACHIEVEMENT_SUMMARY_KINDS: readonly NlAchievementSummaryKind[] = [
  'by_club', 'by_decade', 'by_season', 'clubs_without', 'earliest', 'latest',
];

export type NlAchievementSummary = {
  achievementKey: NlAchievementKey;
  kind: NlAchievementSummaryKind;
};

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
  /**
   * "Ablett most goals" -- a surname that names several real players
   * (Jnr, Snr, Geoff, Luke, Len), none confident enough on its own to
   * accept outright. Rather than decline, the ranking runs across every
   * plausible candidate's id and lets the SAME rank()-with-ties SQL every
   * grain already uses for a genuine tie pick the actual answer: whoever
   * of the Abletts scores highest wins outright, or a real tie between
   * two of them is named as one (see describe.ts's tiedSubject/
   * dedupeByIdentity, unchanged by this -- it already handles "more than
   * one row at the lead value" regardless of why there is more than one).
   *
   * Mutually exclusive with `player` on the plan itself: a plan carries
   * ONE OR THE OTHER, never both -- see validatePlan.
   */
  playerIdIn?: number[];
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
  // An achievement summary counts rows rather than ranking a statistic,
  // so it has no metric vocabulary at all -- validatePlan requires its
  // metric to be null.
  achievement_summary: {},
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
    // The rest of NL_CAREER_COLUMNS' countable columns. These were
    // thresholdable ("players with 3+ clubs") long before they were
    // rankable, and parser.ts's CAREER_STAT_WORDS reuse made "most wins" /
    // "most clubs" / "most brownlow medals" parse -- but with no entry
    // here validatePlan then rejected every one of them as "not a
    // recognised statistic", which reads to a reader as though the site
    // does not track the thing at all. The parser-level regression tests
    // asserted plan SHAPE and so passed throughout; this is the same
    // check-the-plan-not-the-answer gap that hid the player_career
    // missing-player-filter bug, found the same way (executing the
    // question end to end against real data rather than inspecting a plan).
    wins: columnMetric('wins', 'Wins', 'c.wins'),
    losses: columnMetric('losses', 'Losses', 'c.losses'),
    draws: columnMetric('draws', 'Draws', 'c.draws'),
    brownlow_medals: columnMetric('brownlow_medals', 'Brownlow medals', 'c.brownlow_medals'),
    clubs_played: columnMetric('clubs_played', 'Clubs', 'c.clubs_played'),
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
export type NlCoverage = {
  /** Earliest recorded season. The common case is a plain floor. */
  firstSeason: number;
  note: string;
  /**
   * The seasons actually recorded, when coverage is NOT one unbroken run
   * from `firstSeason` to the present. Omitted means [firstSeason, ∞).
   * Per-game Brownlow votes are the reason this exists: a floor of 1931
   * describes their coverage exactly as badly as no floor at all, since
   * the fifty seasons after 1934 hold nothing.
   */
  seasons?: readonly (readonly [number, number])[];
  /** Match types for which the stat was never recorded at all. */
  neverForMatchTypes?: readonly NlMatchType[];
  /** Grains the rule applies at. Omitted means all of them. */
  grains?: readonly NlGrain[];
};

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
  // Per-game Brownlow votes are the one stat whose coverage is neither a
  // floor nor continuous: 1931-1934, then a fifty-season hole, then 1984
  // onward -- and never for a final in any of those years, because the
  // medal is polled on home-and-away matches only.
  //
  // This used to be a note the answer CARRIED rather than a rule that
  // could refuse. That reads well for "most Brownlow votes in a game",
  // which the 1984+ data answers properly, and badly for "most Brownlow
  // votes in one game in 1935" or "in a Grand Final", which have no
  // answer at all: those returned a confident record from whatever rows
  // the query happened to touch, with a footnote that quietly
  // contradicted the number above it. The qualification corpus counts
  // 2,855 such questions, every one of them interpreted correctly and
  // answered wrongly.
  brownlow_votes: {
    firstSeason: 1931,
    note: 'Per-game Brownlow votes are recorded only for 1931-1934 and 1984 onward, and never for finals.',
    // Open-ended rather than pinned to NL_LIMITS.maxSeason: "1984 onward"
    // is the actual fact, and it needs no editing each time a season is
    // played. (NL_LIMITS is declared below this, so referencing it here
    // would also be a temporal-dead-zone error.)
    seasons: [[1931, 1934], [1984, Number.POSITIVE_INFINITY]],
    neverForMatchTypes: ['finals', 'grand_final', 'preliminary_final', 'semi_final', 'qualifying_final', 'elimination_final'],
    // player_career/player_season brownlow_votes are season and career
    // TOTALS, which exist for every year the medal has been awarded.
    // Only the per-match figure has the gap.
    grains: ['player_game'],
  },
};

export const BROWNLOW_GAME_VOTE_NOTE = NL_COVERAGE.brownlow_votes!.note;

/** The coverage rule for a metric, but only where it actually applies. */
export function nlCoverageFor(grain: NlGrain, metric: string | null): NlCoverage | null {
  if (!metric) return null;
  const coverage = NL_COVERAGE[metric];
  if (!coverage) return null;
  if (coverage.grains && !coverage.grains.includes(grain)) return null;
  return coverage;
}

/**
 * Why the requested scope holds no data at all, or null when some part of
 * it is covered. "At all" is the bar deliberately: a range that overlaps
 * coverage even partly is answerable, and the answer carries the note.
 */
export function nlCoverageGap(
  coverage: NlCoverage,
  scope: { seasonMin?: number; seasonMax?: number; matchType?: NlMatchType },
): string | null {
  if (scope.matchType && coverage.neverForMatchTypes?.includes(scope.matchType)) {
    return `${coverage.note} There is nothing recorded for finals to rank.`;
  }

  // An unbounded end of the requested range cannot exclude anything, so
  // an unscoped question always survives this and is answered from the
  // seasons that do exist.
  const from = scope.seasonMin ?? Number.NEGATIVE_INFINITY;
  const to = scope.seasonMax ?? Number.POSITIVE_INFINITY;
  const recorded = coverage.seasons ?? [[coverage.firstSeason, Number.POSITIVE_INFINITY]] as const;
  if (recorded.some(([start, end]) => from <= end && to >= start)) return null;

  const asked = scope.seasonMin === scope.seasonMax && scope.seasonMin !== undefined
    ? String(scope.seasonMin)
    : `${scope.seasonMin ?? 'the earliest season'}-${scope.seasonMax ?? 'the latest season'}`;
  return `${coverage.note} Nothing in ${asked} can be recorded.`;
}

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
  /** achievement_summary only: which achievement, summarised which way. */
  achievementSummary?: NlAchievementSummary;
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
  /**
   * scope.playerIdIn's cap. The real cases are small -- five Abletts is
   * the widest genuine one seen -- so a plan naming more than this is
   * treated as a bug in whatever built it (a stray "found everything"
   * candidate list, not a real ambiguous surname) rather than answered.
   */
  maxPlayerCandidates: 12,
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

  const grains: NlGrain[] = ['player_career', 'player_game', 'player_season', 'team_match', 'club_season', 'achievement_summary'];
  if (!grains.includes(raw.grain)) return { error: `Unknown grain "${raw.grain}".` };

  // An achievement summary counts rows; it never ranks by a statistic, so
  // it carries its own descriptor instead of a metric.
  if (raw.grain === 'achievement_summary') {
    if (!raw.achievementSummary) return { error: 'An achievement summary must say which achievement it summarises.' };
    if (!isNlAchievementKey(raw.achievementSummary.achievementKey)) {
      return { error: `Unknown achievement "${raw.achievementSummary.achievementKey}".` };
    }
    if (!NL_ACHIEVEMENT_SUMMARY_KINDS.includes(raw.achievementSummary.kind)) {
      return { error: `Unknown achievement summary "${raw.achievementSummary.kind}".` };
    }
    if (raw.metric !== null) return { error: 'An achievement summary does not rank by a statistic.' };
  } else if (raw.achievementSummary) {
    return { error: 'An achievement summary only applies to an achievement-summary question.' };
  }

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

  if (raw.player && raw.scope.playerIdIn) {
    return { error: 'A plan cannot name one player and a candidate set at the same time.' };
  }
  if (raw.scope.playerIdIn) {
    if (raw.scope.playerIdIn.length < 2 || raw.scope.playerIdIn.length > NL_LIMITS.maxPlayerCandidates) {
      return { error: 'A player-candidate set must have between 2 and the documented maximum ids.' };
    }
    if (!raw.scope.playerIdIn.every((id) => Number.isInteger(id) && id > 0)) {
      return { error: 'A player-candidate id must be a positive integer.' };
    }
    if (raw.grain !== 'player_career' && raw.grain !== 'player_game' && raw.grain !== 'player_season') {
      return { error: 'A player-candidate set only applies to a player question.' };
    }
  }

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

  // Era coverage: a scope that holds no recorded data at all cannot be
  // answered, and must say so rather than silently return nothing (the
  // same principle records.ts states on every era-limited category and
  // search.md enforces for filters). nlCoverageGap covers both shapes --
  // a metric that starts after the range, and per-game Brownlow votes,
  // whose coverage has a hole in the middle and excludes finals outright.
  const coverage = nlCoverageFor(raw.grain, raw.metric);
  if (coverage) {
    const gap = nlCoverageGap(coverage, { seasonMin, seasonMax, matchType: raw.scope.matchType });
    if (gap) return { error: gap };
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
  achievement_summary: 'achievement',
};

/** The subject noun for a grain with no ranked metric ("every matching <noun>"). */
const GRAIN_SUBJECT: Record<NlGrain, string> = {
  player_career: 'player',
  player_game: 'player',
  player_season: 'player',
  team_match: 'club',
  club_season: 'club season',
  achievement_summary: 'group',
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
