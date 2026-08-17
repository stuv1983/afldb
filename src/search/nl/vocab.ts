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
 * Conversational scaffolding: the words a reader wraps a question in, which
 * carry no part of the question itself. Stripped during canonicalisation,
 * before any extraction stage sees the text.
 *
 * This is not politeness-trimming for its own sake. Filler was the single
 * largest failure cause in the 250,000-question qualification run, and it
 * failed in the worst of the two available ways. A leftover meaningful word
 * makes the clarify-band gate decline (annoying but safe); but filler
 * adjacent to a name is swallowed by candidatePlayerSpan, so "can you tell
 * me Nick Dal Santo ..." looked up a player called "can you tell me nick"
 * and declined as an ambiguous player -- 26,287 rows, the largest single
 * cluster, all of them questions the engine understood perfectly apart from
 * the greeting in front. Stripping here rather than in STOPWORDS matters:
 * these are PHRASES, and declaring their constituent words individually
 * meaningless would also disarm "in ONE game" and "QUICK" as a surname.
 *
 * Ordered longest-first, since a bare "afl" must not claim the "afl
 * question" prefix before the phrase gets a chance at it. Every entry below
 * is taken from the run's own unsupported-term frequency table, with the
 * obvious siblings of an observed phrase included alongside it ("thank you"
 * beside "thanks") -- a reader who writes one writes the other.
 */
export const CONVERSATIONAL_FILLER: RegExp[] = [
  /\b(?:can|could|would) you (?:please )?tell me\b/g,
  /\bi(?: would| ?'d)? (?:like|want) to know\b/g,
  /\bi want know\b/g,          // canonicaliseStatWords drops the "to"
  /\bjust wondering\b/g,
  /\b(?:please )?tell me\b/g,
  /\bshow me\b/g,
  /\bfor afldb\b/g,
  /\bafldb\b/g,
  /\bafl (?:question|stat|trivia)\b/g,
  /\b(?:quick|dumb|silly|stupid|serious) (?:question|one)\b/g,
  /\bif you can\b/g,
  /\bfor me\b/g,
  /\bg'?day\b/g,
  /\bthank you\b/g,
  /\b(?:please|thanks|ta|cheers|mate|hey)\b/g,
  // "in the year 2015" -- "the year" says nothing BARE_YEAR_RE does not
  // already read from the digits themselves.
  /\bthe year\b/g,
  // Bare "afl" last, once every phrase that starts with it has been tried.
  // Safe against "aflw" and "afldb", both of which fail the word boundary.
  /\bafl\b/g,
];

/**
 * Lowercase, strip possessives and punctuation the vocabulary below isn't
 * written to expect, drop conversational filler, and apply
 * query-intent.ts's number-word protection ("inside 50s" must never read as
 * the number 50). Run first, always.
 */
export function canonicalise(raw: string): string {
  let text = raw
    .toLowerCase()
    .replace(/['’]s\b/g, '')     // "richmond's" -> "richmond", "dusty's" -> "dusty"
    // Sentence punctuation, plus the decorative marks readers paste in.
    // The em dash earns its place on evidence: 2,036 questions carried one
    // ("what is most goals in a Grand Final — please") and it survived as a
    // leftover token. Hyphens and apostrophes are deliberately NOT here --
    // "inside-fifties", "home-and-away" and "o'brien" all need theirs.
    .replace(/[.,!?:;—–…"“”()[\]]/g, ' ');
  for (const filler of CONVERSATIONAL_FILLER) text = text.replace(filler, ' ');
  text = text.replace(/\s+/g, ' ').trim();
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
 *
 * The lookahead protects the total_score TEAM metric: in "highest
 * combined score" the word "combined" is half of a metric name, not a
 * sum cue, and stripping it here left "score" to resolve as team_score
 * -- a confidently wrong answer, since the highest single-team score and
 * the highest match aggregate are different records.
 */
export const AGGREGATE_TOTAL_WORDS = /\b(?:total|combined|overall|cumulative|aggregate)\b(?!\s+(?:score|points))/;

// -------------------------------------------------------------- aggregation

export type AggWord = 'max' | 'min' | 'top_n' | 'list' | 'count';

/**
 * Ordered [pattern, kind] pairs, checked in order. "top N" is matched
 * separately (it carries its own number) so a bare "top" doesn't shadow
 * it; everything else is a fixed word -> aggregation mapping.
 */
export const AGG_WORDS: [RegExp, AggWord][] = [
  // "leading"/"led" are aggregation words, not decoration: "Richmond's
  // LEADING goalkicker" is exactly "most goals", and "who LED the
  // goalkicking" the same question again. Before they were listed here
  // the metric ("goalkicker" -> goals) resolved fine and the leftover
  // "leading" was misread as a failed player-name guess, which cost
  // enough confidence to decline a question the engine could answer.
  // "most" is excluded after "at", for exactly the reason bare "least" is
  // excluded outright below -- and the omission was expensive. Aggregation
  // is extracted BEFORE career conditions and STRIPS what it matched, so
  // "players with at most 20 clubs and at most 20 goals" read the "most"
  // of the first "at most" as a superlative, took the aggregation to be
  // `max`, and handed extractCareerConditions "at 20 clubs" -- a count
  // with no operator phrase, which falls back to its `gte` default. The
  // question inverted to "at LEAST 20 clubs", ranked instead of listed.
  //
  // Only the FIRST clause was damaged, because the strip is first-match
  // only, which is what made the failure look like an exotic two-clause
  // interaction rather than one missing lookbehind: the second "at most"
  // was always read correctly. 6,428 questions in the qualification run.
  [/\b(?:highest|best|biggest|largest|greatest|maximum|record|leading|led|heaviest)\b|(?<!\bat )\bmost\b/, 'max'],
  // Bare "least" is deliberately excluded: "at least" (an operator
  // phrase, handled by COMPARE_OP_WORDS) is far more common in real
  // questions than "least" meaning minimum, and the two must not compete.
  [/\b(?:fewest|lowest|smallest|minimum|worst)\b/, 'min'],
  [/\bhow many\b/, 'count'],
  [/\b(?:players?|teams?|clubs?) with\b/, 'list'],
  [/\bwho (?:has|have|played|kicked|holds?)\b/, 'max'],
  // Bare "top" -- the leader, i.e. max -- reached only when TOP_N_RE
  // found no usable count after it ("top goalkicker", "top disposal
  // games"). Listed last so none of the specific phrases above can be
  // shadowed by it. The word after a bare "top" stays in the text: if it
  // was a real metric it is consumed by metric extraction, and if it was
  // noise ("top banana goals") it is left over, which is exactly what
  // makes the parser decline rather than invent a Top 10.
  [/\btop\b/, 'max'],
];

/** "top 10", "top ten", "top10" -- captured separately since it also carries a count. */
export const TOP_N_RE = /\btop[ -]?(\d{1,3}|[a-z]+)\b/;

/**
 * "worst" and "best" are the two aggregation words whose direction
 * depends on the metric rather than on the word.
 *
 * For almost every metric here a bigger number is a better outcome, so
 * worst = min ("worst percentage", "worst season by wins"). For a LOSING
 * MARGIN the polarity inverts: a team's worst loss is its BIGGEST one.
 * AGG_WORDS above still maps worst -> min as the default, and the parser
 * flips it to max only for the metrics named below -- so the special case
 * is confined to the metrics that genuinely have inverted polarity
 * instead of leaking into every question containing the word.
 *
 * This was a real, dangerous bug rather than a theoretical one: "Richmond
 * worst loss to Carlton" answered "1 point" (their narrowest defeat)
 * where the true answer is the 115-point loss of 1984 -- a believable
 * number, silently the opposite of what was asked.
 */
export const POLARITY_AGG_RE = /\b(?:worst|best)\b/;

/** Metrics where a LARGER value is the worse outcome, so "worst" means max. */
export const METRIC_HIGHER_IS_WORSE = new Set(['loss_margin', 'opponent_score']);

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
  // Explicit margin phrases first. They cannot collide with the bare
  // "win"/"loss" patterns below (\bwin\b does not match "winning"), but
  // stating them first keeps the more specific reading in front of the
  // more general one, which is the ordering rule the rest of this file
  // follows.
  [/\b(?:winning margin|win margin|margin of victory)\b/, 'win_margin'],
  [/\b(?:losing margin|loss margin|margin of defeat)\b/, 'loss_margin'],
  [/\b(?:win|victory|victories|thrashing|thumping)\b/, 'win_margin'],
  [/\b(?:loss|defeat|beating)\b/, 'loss_margin'],
  // total_score BEFORE team_score: extraction returns the first match,
  // and \bscore\b matches inside "combined score", so the other order
  // makes total_score unreachable -- "highest combined score" silently
  // answered the single-team record instead of the match aggregate.
  [/\b(?:combined|total|aggregate) (?:score|points)\b/, 'total_score'],
  [/\b(?:score|points scored)\b/, 'team_score'],
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
  [/\bgoal ?kick(?:ers?|ing)\b/, 'goals'],
  [/\bsnags?\b/, 'goals'],
  [/\bgoals?\b/, 'goals'],
  [/\bbehinds?\b/, 'behinds'],
  [/\bkicks?\b/, 'kicks'],
  [/\bhandballs?\b/, 'handballs'],
  [/\btouches?\b/, 'disposals'],
  // Terrace slang, from the qualification run's own frequency table:
  // "possies" 1,695 questions and "snags" 1,642, each declining as an
  // unsupported term. Listed beside the formal word each abbreviates
  // rather than in a table of their own, so the two can never disagree
  // about which column they mean. "possies" sits AFTER the contested/
  // uncontested phrases above for the same first-match-wins reason
  // "possessions" does.
  [/\bpossies\b/, 'disposals'],
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
/**
 * The opponent side. "to" and "over" are the two forms a result question
 * reaches for -- "biggest loss TO Carlton", "biggest win OVER Carlton" --
 * and both were missing, so neither club was governed and the roles fell
 * through to a tiebreak that never looks at word order. That made
 * "Adelaide biggest win over Brisbane Lions" report Brisbane's win, while
 * "Richmond biggest loss to Carlton" happened to come out right only
 * because "richmond" is the longer alias.
 *
 * "over" is safe to include despite also being a comparison operator:
 * COMPARE_OP_WORDS claims it only when digits follow ("over 200 games"),
 * a phrasing that never puts a club immediately after it.
 */
export const AGAINST_PREPOSITION = /\b(?:against|versus|vs\.?|v\.?|to|over)\b/;
export const AT_PREPOSITION = /\b(?:at|on)\b/;

export const SINCE_RE = /\bsince (\d{4})\b/;
export const BEFORE_RE = /\bbefore (\d{4})\b/;
export const BETWEEN_RE = /\bbetween (\d{4}) and (\d{4})\b/;
/**
 * "in the 1990s" (group 1, the decade's first year) or "in the 90s"
 * (group 2, a single leading digit). Two-digit decades resolve 30s-90s
 * to the 1900s and 00s/10s to the 2000s; "the 20s" is DELIBERATELY
 * excluded from group 2 -- with both a 1920s and a 2020s in the data it
 * is genuinely ambiguous, and an unparsed token declines safely where a
 * guessed century answers confidently and wrongly.
 */
export const DECADE_RE = /\bin the (\d{3}0)s\b|\bin the ([013-9])0s\b/;
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
  // "over"/"under" are genuinely two words in one. Immediately before a
  // NUMBER they are comparison operators ("over 200 games"); immediately
  // before a CLUB they are a relationship ("Richmond's biggest win over
  // Carlton"). Requiring the digits here settles it by context rather
  // than by a global rule, and the club reading is handled separately by
  // STOPWORDS -- so neither sense has to know about the other.
  [/\bover(?=\s+\d)/, 'gt'],
  [/\bunder(?=\s+\d)/, 'lt'],
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
 *
 * BOTH nouns take an optional plural, because readers pluralise either
 * half independently: "goal games", "goals game", "goals games" and
 * "highest goals game" are all the same question. Accepting only the
 * singular stat noun was the single largest source of declines in the
 * 12,000-question stress run -- "Dustin Martin highest goals game against
 * Adelaide" left "game" in the text, the player-name scan swallowed it as
 * part of the mention, and 1,887 answerable questions were refused with
 * an unsupported term of "dustin martin game".
 */
export const STAT_GAMES_IDIOM_WORDS: [RegExp, string][] = [
  [/\bgoal assists? games?\b/, 'goal_assists'],
  [/\bcontested marks? games?\b/, 'contested_marks'],
  // The multi-word metrics were absent from this list even though they
  // are all in METRIC_WORDS, so "Tony Lockett most uncontested
  // possessions game at SCG" resolved the metric, left "game" behind, and
  // the player-name scan swallowed it -- declining with the baffling
  // unsupported term "tony lockett uncontested". These MUST precede the
  // bare "possessions games" entry below, which would otherwise claim the
  // tail of the phrase and read contested possessions as plain disposals.
  [/\bcontested possessions? games?\b/, 'contested'],
  [/\buncontested possessions? games?\b/, 'uncontested'],
  [/\binside-fifties games?\b/, 'inside_50s'],
  [/\brebound-fifties games?\b/, 'rebounds'],
  [/\bbrownlow votes? games?\b/, 'brownlow_votes'],
  [/\bpossies games?\b/, 'disposals'],
  [/\bsnags? games?\b/, 'goals'],
  [/\bdisposals? games?\b/, 'disposals'],
  [/\btouch(?:es)? games?\b/, 'disposals'],
  [/\bpossessions? games?\b/, 'disposals'],
  [/\bgoals? games?\b/, 'goals'],
  [/\bbehinds? games?\b/, 'behinds'],
  [/\bkicks? games?\b/, 'kicks'],
  [/\bhandballs? games?\b/, 'handballs'],
  [/\bmarks? games?\b/, 'marks'],
  [/\btackles? games?\b/, 'tackles'],
  [/\bhit ?outs? games?\b/, 'hitouts'],
  [/\bclearances? games?\b/, 'clearances'],
  [/\bclangers? games?\b/, 'clangers'],
  [/\bbounces? games?\b/, 'bounces'],
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
  // "vs"/"v" are the SAME preposition and were the oversight in that list:
  // AGAINST_PREPOSITION has always accepted them for role assignment, so
  // "Richmond heaviest win vs Kangas" resolved both clubs correctly and
  // then declined anyway, because the abbreviation itself was the one
  // unconsumed alpha token left for the player-name scan to misread. 838
  // questions in the qualification run failed on nothing else.
  'against', 'versus', 'vs', 'v',
  // "over" in its RELATIONSHIP sense ("biggest win over Carlton"). The
  // comparison sense ("over 200 games") never reaches here:
  // COMPARE_OP_WORDS claims and strips "over" when digits follow, so what
  // survives to this point is only the club-relationship reading. Without
  // this the word was left over as the sole unmatched alpha token and
  // read as a failed player-name guess, declining a question whose clubs
  // had both resolved perfectly.
  'over',
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
  // Conversational pronouns, as a safety net BEHIND CONVERSATIONAL_FILLER
  // rather than instead of it. The phrase list removes "for me" and "if you
  // can" outright; these catch the same words when a reader arranges them a
  // way the list does not anticipate, so a stray pronoun can neither depress
  // the token ratio nor be swallowed into a player-name span. None is ever a
  // fragment of an AFL player, club or venue name.
  'i', 'me', 'my', 'you', 'your', 'us', 'we',
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
  // "danger" -- 1,669 questions in the qualification run, every one
  // declining, because the bare word reaches the resolver and matches
  // nothing it will commit to.
  danger: 'patrick dangerfield',
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
    // Bare \bfantasy\b, not "fantasy points": readers ask for a "fantasy
    // score" too, and the missed phrasing declined with the baffling
    // reason "unsupported term: fantasy" instead of this honest one.
    re: /\b(?:score involvements?|fantasy|supercoach)\b/,
    topic: 'score involvements or fantasy points',
    reason: 'Score involvements and fantasy/SuperCoach points are not recorded in AFLDB.',
  },
  {
    // Named positions as well as the word "position" itself -- "most
    // games at centre half forward" never says "position" but is exactly
    // this question.
    re: /\bposition(?:s)?\b|\b(?:centre half[- ](?:forward|back)|full[- ](?:forward|back)|half[- ](?:forward|back)(?:[- ]flank)?|(?:forward|back) pocket|ruck[- ]?rovers?|ruck(?:m[ae]n)?|rovers?|wing(?:ers?|m[ae]n)?|centrem[ae]n|followers?|interchange)\b/,
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
