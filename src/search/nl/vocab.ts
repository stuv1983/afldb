/**
 * Vocabulary for the natural-language parser: dictionaries and small
 * regex helpers, no parsing logic. Kept separate from parser.ts so the
 * word lists -- the part most likely to grow from real usage (see
 * db/queries/nl/log.ts) -- can be scanned and edited without wading
 * through control flow.
 *
 * DB-free, like plan.ts: nicknames here are a starting seed, merged at
 * request time with the database's own alias tables (club_aliases,
 * venue_aliases) by db/queries/nl/resolve.ts -- the alias table wins on
 * conflict, since it is the maintained source of truth for what a source
 * document actually called a club or ground.
 */

import { canonicalise as canonicaliseStatWords, NUMBER_WORDS as PLAYER_QUESTION_NUMBER_WORDS } from '@/search/query-intent';
import type { NlCompareOp } from '@/search/nl/plan';

// ------------------------------------------------------------- numbers

/** Superset of query-intent.ts's NUMBER_WORDS -- "a dozen" and "hundred" are questions this parser reaches that the grid-question parser never needed to. */
export const NUMBER_WORDS: Record<string, number> = {
  ...PLAYER_QUESTION_NUMBER_WORDS,
  dozen: 12,
  hundred: 100,
};

/** The first number in text, as digits or a number word. Digits win when both are present. */
export function readCount(text: string): number | null {
  const digits = /\b(\d{1,4})\b/.exec(text);
  if (digits) return Number(digits[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return null;
}

// ---------------------------------------------------------- canonicalise

/**
 * Lowercase, strip possessives and punctuation the vocabulary below isn't
 * written to expect, and apply query-intent.ts's number-word protection
 * ("inside 50s" must never read as the number 50). Run first, always.
 */
export function canonicalise(raw: string): string {
  const text = raw
    .toLowerCase()
    .replace(/['’]s\b/g, '')     // "richmond's" -> "richmond", "dusty's" -> "dusty"
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return canonicaliseStatWords(text);
}

// -------------------------------------------------------------- grain cues

export const IN_ONE_SEASON = /\bin (?:a|one|any|(?:a )?single|the same) season\b/;
export const IN_ONE_GAME = /\bin (?:a|one|any|(?:a )?single|the same) (?:game|match)\b/;
export const IN_A_FINAL = /\bin (?:a|one|any) final\b/;
export const IN_A_GRAND_FINAL = /\bin (?:a|one|any) grand final\b/;
export const OVER_CAREER = /\b(?:career|all[ -]time|ever|in (?:his|their|a) career)\b/;

/**
 * "dusty TOTAL goals against Carlton" -- an explicit cue that a named
 * player's stat should be a scoped running total (player_game mode
 * 'sum'), overriding the single-game-peak default a bare "dusty most
 * goals against Carlton" reads as. Kept distinct from OVER_CAREER: an
 * unscoped "career"/"ever" still means the true player_career grain, but
 * "total"/"combined" alongside a club/venue/season scope has nowhere to
 * live except a scoped player_game sum -- player_career has no
 * opponent/venue scoping at all.
 */
export const AGGREGATE_TOTAL_WORDS = /\b(?:total|combined|overall|cumulative)\b/;

// -------------------------------------------------------------- aggregation

export type AggWord = 'max' | 'min' | 'top_n' | 'list' | 'count';

/**
 * Ordered [pattern, kind] pairs, checked in order. "top N" is matched
 * separately (it carries its own number) so a bare "top" doesn't shadow
 * it; everything else is a fixed word -> aggregation mapping.
 */
export const AGG_WORDS: [RegExp, AggWord][] = [
  [/\b(?:most|highest|best|biggest|largest|greatest|maximum|record)\b/, 'max'],
  // Bare "least" is deliberately excluded: "at least" (an operator
  // phrase, handled by COMPARE_OP_WORDS) is far more common in real
  // questions than "least" meaning minimum, and the two must not compete.
  [/\b(?:fewest|lowest|smallest|minimum|worst)\b/, 'min'],
  [/\bhow many\b/, 'count'],
  [/\b(?:players?|teams?|clubs?) with\b/, 'list'],
  [/\bwho (?:has|have|played|kicked|holds?)\b/, 'max'],
];

/** "top 10", "top ten", "top10" -- captured separately since it also carries a count. */
export const TOP_N_RE = /\btop[ -]?(\d{1,3}|[a-z]+)\b/;

// -------------------------------------------------------------- stat words

/**
 * Team-scoring words, checked BEFORE player stat words: "richmond's
 * biggest win" must read as a team_match question, not a player stat
 * question that happens to contain no player stat word at all. Kept
 * separate from METRIC_WORDS (player stats) because the two vocabularies
 * name different grains and must never be tried in the same pass.
 */
/**
 * "loss" is deliberately SINGULAR-only here, matching "win" (which never
 * included plural "wins" at all) -- the plural "losses"/"wins" reads as a
 * SEASON TALLY (club_season), not one match's margin. Without this, "clubs
 * with the most losses in a season" matched loss_margin here first and
 * was read as team_match before club_season ever got a chance to claim
 * "losses" as its own ranking metric.
 */
export const TEAM_METRIC_WORDS: [RegExp, 'win_margin' | 'loss_margin' | 'team_score' | 'total_score' | 'attendance'][] = [
  [/\b(?:win|victory|victories|thrashing|thumping)\b/, 'win_margin'],
  [/\b(?:loss|defeat|beating)\b/, 'loss_margin'],
  [/\b(?:score|points scored)\b/, 'team_score'],
  [/\b(?:combined score|total score)\b/, 'total_score'],
  [/\b(?:crowd|attendance)\b/, 'attendance'],
];

/**
 * club_season ranking words -- "most wins in a season", "highest
 * percentage". "wins"/"losses"/"draws" also name a PLAYER career column
 * (NL_CAREER_COLUMNS), so the parser only tries this vocabulary once a
 * club-season cue (a leading "teams"/"clubs" word, a named club, or one
 * of CLUB_SEASON_CONDITION_WORDS below) has already made the grain
 * unambiguous -- see parser.ts's clubSeasonCuePresent. "percentage" has
 * no such collision (it is not a player statistic in this vocabulary at
 * all) but is kept in the same gated list for one consistent code path
 * rather than a special case.
 */
export const CLUB_SEASON_METRIC_WORDS: [RegExp, 'wins' | 'losses' | 'draws' | 'percentage'][] = [
  [/\bpercentage\b/, 'percentage'],
  [/\bwins?\b/, 'wins'],
  [/\blosses?\b/, 'losses'],
  [/\bdraws?\b/, 'draws'],
];

/**
 * club_season boolean conditions -- "fewest wins BY A PREMIER", "worst
 * team to MAKE FINALS". Each reads one already-computed club_seasons
 * column (is_premier / wooden_spoon / finals_played); unlike the metric
 * words above, these never collide with player vocabulary, so they are
 * always tried and are themselves one of the cues that makes a question
 * a club-season question in the first place.
 */
export const CLUB_SEASON_CONDITION_WORDS: [RegExp, 'premier' | 'wooden_spoon' | 'made_finals' | 'missed_finals'][] = [
  [/\bwooden spoon\b/, 'wooden_spoon'],
  [/\bpremiers?\b|\bpremiership (?:team|side)\b|\bwon the flag\b/, 'premier'],
  [/\b(?:missed|missing|miss(?:es)?) (?:the )?finals\b/, 'missed_finals'],
  [/\b(?:made|make|makes|making|qualified for|reached) (?:the )?finals\b/, 'made_finals'],
];

/**
 * Player stat vocabulary. Multi-word / numeric-named stats first, same
 * discipline as query-intent.ts's STAT_WORDS (which this supersedes for
 * the NL engine -- query-intent.ts's own copy is untouched so the
 * existing grid-question parser keeps working unchanged).
 */
export const METRIC_WORDS: [RegExp, string][] = [
  [/\bgoal assists?\b/, 'goal_assists'],
  [/\bcontested marks?\b/, 'contested_marks'],
  [/\bcontested possessions?\b/, 'contested'],
  [/\buncontested possessions?\b/, 'uncontested'],
  [/\binside-fifties\b/, 'inside_50s'],
  [/\brebound-fifties\b/, 'rebounds'],
  [/\bbrownlow votes?\b/, 'brownlow_votes'],
  [/\bbiggest bags?\b/, 'goals'],
  [/\bgoalkickers?\b/, 'goals'],
  [/\bgoals?\b/, 'goals'],
  [/\bbehinds?\b/, 'behinds'],
  [/\bkicks?\b/, 'kicks'],
  [/\bhandballs?\b/, 'handballs'],
  [/\btouches?\b/, 'disposals'],
  [/\bpossessions?\b/, 'disposals'],
  [/\bdisposals?\b/, 'disposals'],
  [/\bmarks?\b/, 'marks'],
  [/\btackles?\b/, 'tackles'],
  [/\bhit ?outs?\b/, 'hitouts'],
  [/\bclearances?\b/, 'clearances'],
  [/\bclangers?\b/, 'clangers'],
  [/\bbounces?\b/, 'bounces'],
];

// -------------------------------------------------------------- scoping

/** "for/by Richmond" vs "against/versus Carlton" -- the only thing separating the two club roles a question can name. */
export const FOR_PREPOSITION = /\b(?:for|by|from)\b/;
export const AGAINST_PREPOSITION = /\b(?:against|versus|vs\.?|v\.?)\b/;
export const AT_PREPOSITION = /\b(?:at|on)\b/;

export const SINCE_RE = /\bsince (\d{4})\b/;
export const BEFORE_RE = /\bbefore (\d{4})\b/;
export const BETWEEN_RE = /\bbetween (\d{4}) and (\d{4})\b/;
export const DECADE_RE = /\bin the (\d{4})0?s\b|\bin the (\d{2})0s\b/;
export const BARE_YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;

export const NEGATION_WORDS = /\b(?:without|never|no|didn'?t|hasn'?t|hadn'?t)\b/;

/**
 * Comparison-operator phrases, checked in order (longest/most specific
 * first: "at least" before a bare number would otherwise be read as
 * "exactly", and "more than" must not be shadowed by a later bare digit
 * match). "200+ games" is handled separately by NUMBER_PLUS_RE below,
 * since the operator there is attached to the digits themselves.
 */
export const COMPARE_OP_WORDS: [RegExp, NlCompareOp][] = [
  [/\bat least\b/, 'gte'],
  [/\bat most\b/, 'lte'],
  [/\bmore than\b/, 'gt'],
  [/\bless than\b/, 'lt'],
  [/\bfewer than\b/, 'lt'],
  [/\bexactly\b/, 'eq'],
];

/** "200+ games" -- the number carries its own >= operator. */
export const NUMBER_PLUS_RE = /\b(\d{1,4})\+/;

/**
 * "5 disposal games", "top 5 disposal games by dusty" -- a plural-noun
 * idiom equivalent to "5 disposals in a game", common enough in real
 * usage that it needs its own recognition alongside the explicit
 * IN_ONE_GAME phrase. Matches the WHOLE "<stat> game(s)" span so both
 * words are consumed together, rather than leaving "games" behind for
 * the player-name scan to trip over.
 */
export const STAT_GAMES_IDIOM_WORDS: [RegExp, string][] = [
  [/\bgoal assists? games?\b/, 'goal_assists'],
  [/\bcontested marks? games?\b/, 'contested_marks'],
  [/\bdisposal games?\b/, 'disposals'],
  [/\btouch games?\b/, 'disposals'],
  [/\bpossession games?\b/, 'disposals'],
  [/\bgoal games?\b/, 'goals'],
  [/\bbehind games?\b/, 'behinds'],
  [/\bkick games?\b/, 'kicks'],
  [/\bhandball games?\b/, 'handballs'],
  [/\bmark games?\b/, 'marks'],
  [/\btackle games?\b/, 'tackles'],
  [/\bhit ?out games?\b/, 'hitouts'],
  [/\bclearance games?\b/, 'clearances'],
  [/\bclanger games?\b/, 'clangers'],
  [/\bbounce games?\b/, 'bounces'],
];

/** Words that make a question about clubs rather than players -- the same word query-intent.ts's CLUB_SUBJECT uses. */
export const CLUB_SUBJECT = /\b(?:teams?|clubs?|sides?)\b/;

// ---------------------------------------------------------------- match type

export const MATCH_TYPE_WORDS: [RegExp, string][] = [
  [/\bgrand finals?\b/, 'grand_final'],
  // "GF" only as its own token -- not inside a longer word -- since a
  // two-letter abbreviation is otherwise an easy false match.
  [/\bgf\b/, 'grand_final'],
  [/\bpreliminary finals?\b/, 'preliminary_final'],
  [/\bsemi finals?\b/, 'semi_final'],
  [/\bqualifying finals?\b/, 'qualifying_final'],
  [/\belimination finals?\b/, 'elimination_final'],
  [/\bfinals?\b/, 'finals'],
  [/\bhome[- ]and[- ]away\b/, 'home_and_away'],
];

// ------------------------------------------------------------------- awards

/**
 * Honour-vocabulary words, resolved to an NlAwardKey (plan.ts's closed
 * NL_AWARDS set) rather than a free-text award name -- "AA" is
 * deliberately narrow (word-boundary, two capital-insensitive letters)
 * since it is otherwise an easy false match; it is only ever checked
 * after the unanswerable-topic gate and player/club extraction, by which
 * point most incidental "aa" substrings have already been consumed.
 */
export const AWARD_WORDS: [RegExp, 'all_australian'][] = [
  // Longest phrase first, so "selections" is consumed along with
  // "all-australian" rather than left dangling for the player-name scan
  // to trip over.
  [/\ball[- ]australians? selections?\b/, 'all_australian'],
  [/\baa selections?\b/, 'all_australian'],
  [/\ball[- ]australians?\b/, 'all_australian'],
  [/\baa\b/, 'all_australian'],
];

// ------------------------------------------------------------------ stopwords

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'was', 'were', 'has', 'have', 'had', 'did', 'does', 'do',
  'in', 'on', 'at', 'of', 'to', 'by', 'for', 'with', 'and', 'or', 'that', 'this',
  // "against"/"versus" are consumed as a club-role preposition the same
  // way "for"/"by" already are above, but only the club NAME they govern
  // is stripped from `text` (extractClubs), never the preposition word
  // itself -- without this, a scoped question with no player named
  // ("most goals against carlton ever") left "against" as the only
  // leftover alpha token, misread as a failed player-name candidate.
  'against', 'versus',
  'his', 'her', 'their', 'its', 'who', 'whom', 'which', 'what', 'ever',
  // Operator/connective words: never plausible fragments of a player name,
  // and a safety net alongside the explicit stripping each extraction
  // stage does for its own operator phrases ("at least", "more than").
  'more', 'less', 'fewer', 'least', 'than', 'exactly', 'without', 'never', 'no',
  // Question-scaffolding nouns: "players with…", "teams that…" carry no
  // meaning beyond what CLUB_SUBJECT_LEADING already reads structurally
  // from their leading position, so they add nothing to a confidence
  // score once the rest of the question has been extracted.
  'player', 'players', 'team', 'teams', 'club', 'clubs', 'side', 'sides',
  // Filler verbs attached to a stat/condition word that has already been
  // consumed ("finals played", "goals kicked", "votes recorded") --
  // meaningful as English, redundant once their subject is resolved.
  'played', 'kicked', 'scored', 'recorded', 'achieved', 'won', 'whose',
]);

/** Only the LEADING word decides a club-season question ("teams that…", "clubs with…") -- a bare "clubs" buried in a count phrase ("exactly two clubs") must not trigger it. */
export const CLUB_SUBJECT_LEADING = /^(?:teams?|clubs?|sides?)\b/;

// ------------------------------------------------------------------ nicknames

/** Seed vocabulary; grown from real search-log usage (db/queries/nl/log.ts, phase F). */
export const PLAYER_NICKNAMES: Record<string, string> = {
  dusty: 'dustin martin',
  buddy: 'lance franklin',
  plugger: 'tony lockett',
  gazza: 'gary ablett',
  pendles: 'scott pendlebury',
  hodgey: 'shaun hodge',
  roo: 'kevin bartlett',
  dangerfield: 'patrick dangerfield',
  dangerwood: 'patrick dangerfield',
  chappy: 'matthew richardson',
  cazza: 'chris judd',
  judd: 'chris judd',
  swanny: 'dane swan',
  fev: 'brendan fevola',
  cousins: 'ben cousins',
  bont: 'marcus bontempelli',
  nank: 'todd goldstein',
};

/**
 * Colloquial club names not reliably present in club_aliases -- merged
 * server-side with the database's own alias rows, which take precedence
 * on any conflict (they are the maintained record of what a source
 * document actually calls a club).
 */
export const CLUB_NICKNAMES: Record<string, string> = {
  pies: 'collingwood',
  magpies: 'collingwood',
  tigers: 'richmond',
  dogs: 'western bulldogs',
  doggies: 'western bulldogs',
  cats: 'geelong',
  hawks: 'hawthorn',
  dees: 'melbourne',
  demons: 'melbourne',
  blues: 'carlton',
  swans: 'sydney',
  bombers: 'essendon',
  dons: 'essendon',
  saints: 'st kilda',
  roos: 'north melbourne',
  kangas: 'north melbourne',
  kangaroos: 'north melbourne',
  eagles: 'west coast',
  power: 'port adelaide',
  crows: 'adelaide',
  dockers: 'fremantle',
  freo: 'fremantle',
  suns: 'gold coast',
  giants: 'greater western sydney',
  gws: 'greater western sydney',
  lions: 'brisbane lions',
};

/** Merged server-side with venue_aliases the same way club nicknames are. */
export const VENUE_NICKNAMES: Record<string, string> = {
  'the g': 'melbourne cricket ground',
  mcg: 'melbourne cricket ground',
  kardinia: 'kardinia park',
  gmhba: 'kardinia park',
  docklands: 'docklands stadium',
  marvel: 'docklands stadium',
  etihad: 'docklands stadium',
  'the gabba': 'the gabba',
  gabba: 'the gabba',
  scg: 'sydney cricket ground',
  waverley: 'waverley park',
  'vfl park': 'waverley park',
};

// ------------------------------------------------------------ unanswerable

export type UnanswerableTopic = { re: RegExp; topic: string; reason: string };

/**
 * Checked before entity extraction, so a question naming an absent topic
 * declines cleanly rather than partially matching a club or player and
 * producing a misleading answer. Each of these is verified absent from
 * the schema -- see docs/search.md and the schema inventory this file's
 * commit is based on.
 */
export const UNANSWERABLE_TOPICS: UnanswerableTopic[] = [
  {
    re: /\bcoach(?:es|ed|ing)?\b/,
    topic: 'coaching',
    reason: 'AFLDB has no coaching data at all -- no coach, no coach-per-club-season, nothing.',
  },
  {
    re: /\b(?:score involvements?|fantasy points?|supercoach)\b/,
    topic: 'score involvements or fantasy points',
    reason: 'Score involvements and fantasy/SuperCoach points are not recorded in AFLDB.',
  },
  {
    re: /\bposition(?:s)?\b/,
    topic: 'playing position',
    reason: 'AFLDB does not record which position a player lined up in.',
  },
  {
    re: /\b(?:consecutive|in a row|winning streak|losing streak|unbeaten streak|win streak|loss streak)\b/,
    topic: 'streaks',
    reason: 'Consecutive-game streaks are not precomputed in AFLDB yet.',
  },
  {
    re: /\bcomeback|trailing|three[- ]quarter time\b/,
    topic: 'quarter-by-quarter comebacks',
    reason: 'Comeback questions need quarter-by-quarter analysis AFLDB does not yet compute.',
  },
  {
    re: /\b(?:youngest|oldest)\b/,
    topic: 'age',
    reason: 'Date of birth is recorded for about 93% of players, not enough to safely answer a youngest/oldest question.',
  },
  {
    re: /\baverage\b/,
    topic: 'averages',
    reason: 'Average-based questions are not yet supported.',
  },
];
