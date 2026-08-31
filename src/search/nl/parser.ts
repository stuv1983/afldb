/**
 * The deterministic natural-language parser: question text -> NlParse.
 *
 * No LLM, no network call except the one injected async dependency
 * (resolvePlayer). Every other stage is synchronous, pure, and driven by
 * the fixed dictionaries in vocab.ts. See plan.ts's header comment for
 * how a future LLM fallback would slot in beside this module without
 * changing anything downstream.
 *
 * Stages, in order (each records what it consumed so confidence can be
 * scored honestly rather than assumed):
 *   1. canonicalise
 *   2. unanswerable-topic gate
 *   3. club/venue entity extraction (sync, directory-based)
 *   4. slot extraction: award, aggregation, metric, grain cues, match
 *      type, season range, career conditions/predicates
 *   5. player mention (the one async step)
 *   6. plan assembly (grain election) + confidence scoring
 */

import {
  isNlAwardKey,
  isNlCareerColumn,
  isNlMetric,
  NL_ACHIEVEMENTS,
  NL_CONFIDENCE,
  NL_LIMITS,
  PARSER_VERSION,
  type NlAchievementKey,
  type NlAchievementSummaryKind,
  type NlAggregation,
  type NlBoundary,
  type NlCareerColumn,
  type NlCareerCondition,
  type NlClubSeasonCondition,
  type NlCompareOp,
  type NlDeclineReason,
  type NlMatchScope,
  type NlMatchType,
  type NlMetricCondition,
  type NlParse,
  type NlParseReport,
  type NlPlayerRef,
  type NlQueryPlan,
} from '@/search/nl/plan';
import type { GridAxisState } from '@/search/grid-solver-spec';
import { extractHeadToHeadCue } from '@/search/nl/semantic-intents';
import {
  findClub, findVenue, stripMatch,
  type NlClubDirectoryEntry, type NlEntityMatch, type NlVenueDirectoryEntry,
} from '@/search/nl/entities';
import {
  ACHIEVEMENT_SUMMARY_CUES,
  AGAINST_PREPOSITION, AGG_WORDS, AGGREGATE_TOTAL_WORDS, AWARD_WORDS,
  BARE_YEAR_RE, BEFORE_RE, BETWEEN_RE, CLUB_SEASON_CONDITION_WORDS, CLUB_SEASON_METRIC_WORDS,
  FIRST_KICK_GOAL_RE,
  DECADE_RE,
  MATCH_EVENT_WORDS, RIVALRY_WORDS,
  CLUB_SUBJECT_LEADING, COMPARE_OP_WORDS,
  IN_A_FINAL, IN_A_GRAND_FINAL, IN_ONE_GAME, IN_ONE_SEASON,
  MATCH_TYPE_WORDS, METRIC_HIGHER_IS_WORSE, METRIC_WORDS, NEGATION_WORDS, NUMBER_PLUS_RE,
  NUMBER_WORDS, OVER_CAREER, POLARITY_AGG_RE,
  PLAYER_NICKNAMES, SINCE_RE, STAT_GAMES_IDIOM_WORDS, STOPWORDS, TEAM_METRIC_WORDS, STREAK_WORDS, PERIOD_SPLIT_WORDS, TOP_N_RE,
  UNANSWERABLE_TOPICS, canonicalise, readCount,
} from '@/search/nl/vocab';

export type NlPlayerCandidate = {
  /** Canonical player identity and display name -- what the plan carries. */
  ref: NlPlayerRef;
  score: number;
  /**
   * The name form the resolver actually matched (primary name or a stored
   * alias). Optional so injected test resolvers and older callers stay
   * valid; absent means the canonical name matched.
   */
  matchedName?: string;
};

export type NlParseContext = {
  clubs: NlClubDirectoryEntry[];
  venues: NlVenueDirectoryEntry[];
  /** The one async dependency. Delegates to searchPlayers in production; tests inject a fake. */
  resolvePlayer: (name: string) => Promise<NlPlayerCandidate[]>;
};

/** A player mention is trusted at prefix-match strength or better -- the same threshold searchPlayers's own ranking uses to mean "clearly this one". */
const PLAYER_ACCEPT_SCORE = 500;

function emptyScope(): NlMatchScope {
  return {};
}

function emptyReport(normalisedQuery: string): NlParseReport {
  return {
    confidence: 0,
    components: { tokenRatio: 0, playerCertainty: 1, structuralPenalty: 1, unresolvedPenalty: 0 },
    normalisedQuery, consumed: [], unsupportedTerms: [], notes: [], entityResolution: [],
  };
}

function meaningfulTokens(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0 && !STOPWORDS.has(t) && !/^\d+\+?$/.test(t));
}

/** True when `matchedText`, as a whole word/phrase, occurs in `text`. */
function consume(text: string, matchedText: string): { text: string; matched: boolean } {
  const re = new RegExp(`\\b${matchedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  if (!re.test(text)) return { text, matched: false };
  return { text: stripMatch(text, matchedText), matched: true };
}

// ------------------------------------------------------- club role scoping

type ClubExtraction = {
  text: string;
  clubFor?: NlEntityMatch<NlClubDirectoryEntry>;
  clubAgainst?: NlEntityMatch<NlClubDirectoryEntry>;
  matchup?: { clubA: NlEntityMatch<NlClubDirectoryEntry>; clubB: NlEntityMatch<NlClubDirectoryEntry> };
  consumed: string[];
};

/** Where a matched phrase sits in the original question, word-boundary anchored so "melbourne" does not report the position of "north melbourne". */
function phrasePosition(text: string, phrase: string): number {
  const at = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(text);
  return at ? at.index : Number.MAX_SAFE_INTEGER;
}

function phraseEnd(text: string, phrase: string): number {
  const at = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(text);
  return at ? at.index + at[0].length : Number.MAX_SAFE_INTEGER;
}

/**
 * Finds up to two club mentions and assigns each a role by the
 * preposition governing it: "against/versus/vs/v/to/over" -> the
 * opponent, "for/by/from" or no preposition at all -> the subject side.
 * "richmond biggest loss to carlton" and "biggest win for richmond
 * against carlton" both resolve the same way from this one rule.
 *
 * When neither mention is governed -- "richmond carlton mcg biggest win"
 * -- the roles go by WORD ORDER, subject first. findClub returns the
 * longest alias rather than the leftmost one, so the previous
 * first-found-wins fallback handed the subject slot to whichever club
 * happened to have the longer name: "Adelaide biggest win over Brisbane
 * Lions" became Brisbane's win, while the same question about Carlton
 * came out right purely because "richmond" is longer than "carlton". A
 * coin-flip that reads as a confident answer is the worst failure this
 * engine has, so position decides it now.
 */
function extractClubs(text: string, clubs: readonly NlClubDirectoryEntry[]): ClubExtraction {
  let working = text;
  const consumed: string[] = [];
  const found: { match: NlEntityMatch<NlClubDirectoryEntry>; governedAgainst: boolean; at: number; end: number }[] = [];

  for (let i = 0; i < 2; i++) {
    const match = findClub(working, clubs);
    if (!match) break;
    consumed.push(match.matchedText);

    // Look at a short window before the match for a governing preposition.
    const idx = working.toLowerCase().indexOf(match.matchedText);
    const before = idx >= 0 ? working.slice(Math.max(0, idx - 20), idx) : '';
    found.push({
      match,
      governedAgainst: AGAINST_PREPOSITION.test(before),
      // Measured against the ORIGINAL text: `working` has had earlier
      // matches spliced out, so its offsets no longer describe the
      // question the reader typed.
      at: phrasePosition(text, match.matchedText),
      end: phraseEnd(text, match.matchedText),
    });
    working = stripMatch(working, match.matchedText);
  }

  const byPosition = [...found].sort((a, b) => a.at - b.at);
  let matchup: ClubExtraction['matchup'];
  if (byPosition.length >= 2) {
    const [left, right] = byPosition;
    const between = left.end <= right.at ? text.slice(left.end, right.at).trim() : '';
    if (/^(?:v|vs\.?|versus)$/.test(between)) {
      matchup = { clubA: left.match, clubB: right.match };
    }
  }

  let clubFor: NlEntityMatch<NlClubDirectoryEntry> | undefined;
  let clubAgainst: NlEntityMatch<NlClubDirectoryEntry> | undefined;

  if (!matchup) {
    for (const entry of found.filter((f) => f.governedAgainst)) {
      if (!clubAgainst) clubAgainst = entry.match;
    }
    for (const entry of found.filter((f) => !f.governedAgainst).sort((a, b) => a.at - b.at)) {
      if (!clubFor) clubFor = entry.match;
      else if (!clubAgainst) clubAgainst = entry.match;
    }
  }

  return { text: working, clubFor, clubAgainst, matchup, consumed };
}

// ------------------------------------------------------------------ seasons

type SeasonExtraction = { text: string; seasonMin?: number; seasonMax?: number; consumed: string[] };

function extractSeasons(text: string): SeasonExtraction {
  const consumed: string[] = [];
  let working = text;

  // "in the 1990s" / "in the 90s" -- a whole decade as the season range.
  // Checked first: nothing else here can match inside the phrase (the
  // trailing "s" keeps BARE_YEAR_RE's \b from firing on the digits), but
  // a decade IS the complete range, so nothing else should run after it.
  // Two-digit decades resolve 30s-90s to the 1900s and 00s/10s to the
  // 2000s; DECADE_RE itself refuses "the 20s" (1920s vs 2020s is a coin
  // flip, and an unparsed token declines safely where a guessed century
  // answers wrongly). The four-digit bounds check does the same for
  // nonsense like "in the 3560s".
  const decade = DECADE_RE.exec(working);
  if (decade) {
    const first = decade[1] !== undefined
      ? Number(decade[1])
      : Number(decade[2]) >= 3 ? 1900 + Number(decade[2]) * 10 : 2000 + Number(decade[2]) * 10;
    if (first >= 1890 && first <= 2090) {
      consumed.push(decade[0]);
      working = working.replace(DECADE_RE, ' ');
      return { text: working, seasonMin: first, seasonMax: first + 9, consumed };
    }
  }

  const between = BETWEEN_RE.exec(working);
  if (between) {
    const a = Number(between[1]);
    const b = Number(between[2]);
    consumed.push(between[0]);
    working = working.replace(BETWEEN_RE, ' ');
    return { text: working, seasonMin: Math.min(a, b), seasonMax: Math.max(a, b), consumed };
  }

  let seasonMin: number | undefined;
  let seasonMax: number | undefined;

  const since = SINCE_RE.exec(working);
  if (since) {
    seasonMin = Number(since[1]);
    consumed.push(since[0]);
    working = working.replace(SINCE_RE, ' ');
  }
  const before = BEFORE_RE.exec(working);
  if (before) {
    seasonMax = Number(before[1]) - 1;
    consumed.push(before[0]);
    working = working.replace(BEFORE_RE, ' ');
  }

  // A bare year ("most goals in 2025") names one exact season -- checked
  // only once since/before found nothing, so "since 1980" never has its
  // own year re-read here. Without this, "in 2025" left both seasonMin
  // and seasonMax undefined (BARE_YEAR_RE existed in vocab.ts but nothing
  // ever called it), and because meaningfulTokens() excludes pure-digit
  // tokens from the confidence ratio, the dropped year cost the parse
  // NOTHING in confidence -- "most goals in 2025" silently answered the
  // career-wide record at high confidence with the year discarded.
  if (seasonMin === undefined && seasonMax === undefined) {
    const bareYear = BARE_YEAR_RE.exec(working);
    if (bareYear) {
      const year = Number(bareYear[1]);
      seasonMin = year;
      seasonMax = year;
      consumed.push(bareYear[0]);
      working = working.replace(BARE_YEAR_RE, ' ');
    }
  }

  return { text: working, seasonMin, seasonMax, consumed };
}

// -------------------------------------------------------------- match type

/**
 * "in finals"/"in a final" is a SCOPE; "most finals played" is a career
 * METRIC -- the same word, two different questions, and the only thing
 * telling them apart is whether "in"/"during" governs it. Without this
 * gate, "most finals played without a premiership" would misread as
 * "rank single final-game performances" instead of "rank career finals
 * totals". A short look-behind window, the same technique club-role
 * assignment uses for "against"/"for".
 */
// "in a grand final" (a scope) and "first game WAS a grand final" (a
// boundary description) are structurally the same signal for this
// purpose -- both name a real match type. Only a governing word from
// this set counts; bare "finals" with nothing before it is the career
// metric instead ("most finals played").
//
// The determiner list must stay in step with IN_ONE_GAME/IN_A_FINAL/
// IN_A_GRAND_FINAL in vocab.ts, which accept "one"/"any"/"single"/"the
// same" as well. When it did not, "most goals in one Grand Final" failed
// this gate and kept its match type -- then IN_A_GRAND_FINAL, which DOES
// accept "one", deleted the phrase at the grain-cue step. The question
// answered as an all-time career total with the Grand Final scope
// silently gone.
const SCOPE_GOVERNS_MATCH_TYPE = /\b(?:in|during|was|is|were)\s+(?:the same|(?:a )?single|an?|any|one|the)?\s*$/;
const BARE_MATCH_TYPE_RECORD_RE = /\b(?:record|holder|holders|leader|leaders?)\b/;

/**
 * `allowBare` lifts the governing-word requirement, and is passed when the
 * question also contains a TEAM-metric word ("biggest grand final WIN").
 *
 * The requirement exists to stop "most finals played" being read as "rank
 * single final-game performances", and that ambiguity is real only for
 * the player_career reading of "finals". A team-scoring word rules that
 * reading out entirely -- there is no career metric for "grand final
 * win" -- so with one present, a bare match-type word can only be scope.
 *
 * The singular/plural convention does the delicate part for free, and it
 * is why this stays a rule rather than a list of phrases:
 *
 *   "biggest finals WIN"   -> \bwin\b matches   -> scope, team_match
 *   "most finals WINS"     -> \bwin\b does NOT  -> career metric, unchanged
 *
 * exactly the distinction asked for, falling out of the same convention
 * that already separates one match's margin from a season tally.
 */
function extractMatchType(
  text: string,
  allowBare = false,
): { text: string; matchType?: NlMatchType; consumed: string[] } {
  for (const [re, type] of MATCH_TYPE_WORDS) {
    const match = re.exec(text);
    if (!match) continue;
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    const governs = SCOPE_GOVERNS_MATCH_TYPE.exec(before);
    if (!allowBare && !governs) continue;
    // The governing phrase is consumed WITH the match type, not left
    // behind. Its determiner is often a meaningful word in its own right
    // ("one", "any", "single" are not stopwords the way "a" and "the"
    // are), and stranding it made "most goals in one Grand Final"
    // decline over a leftover "one" -- the very word that scoped it.
    const span = governs ? `${governs[0]}${match[0]}` : match[0];
    return { text: stripMatch(text, span), matchType: type as NlMatchType, consumed: [span] };
  }
  return { text, consumed: [] };
}

/** Does a team-scoring word appear anywhere? Peeked WITHOUT consuming -- extractTeamMetric still does the real extraction later, against the by-then-stripped text. */
function hasTeamMetricWord(text: string): boolean {
  return TEAM_METRIC_WORDS.some(([re]) => re.test(text));
}

function hasBareMatchTypeRecordCue(text: string): boolean {
  return BARE_MATCH_TYPE_RECORD_RE.test(text) && METRIC_WORDS.some(([re]) => re.test(text));
}

// ----------------------------------------------------------------- awards

function extractAward(text: string): { text: string; awardKey?: 'all_australian'; consumed: string[] } {
  for (const [re, key] of AWARD_WORDS) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), awardKey: key, consumed: [match[0]] };
  }
  return { text, consumed: [] };
}

/**
 * The first-kick-goal achievement, and whether the question asks for the
 * players who hold it or for a summary of them.
 *
 * `summaryKind` is only ever set when the achievement phrase itself
 * matched, so the deliberately broad cue phrases ("which club", "by
 * decade") cannot elect the summary grain on their own.
 */
function extractFirstKickGoal(text: string): {
  text: string;
  achievementKey?: NlAchievementKey;
  summaryKind?: NlAchievementSummaryKind;
  negatedAchievement?: boolean;
  consumed: string[];
} {
  const match = FIRST_KICK_GOAL_RE.exec(text);
  if (!match) return { text, consumed: [] };

  const consumed = [match[0]];
  let remaining = stripMatch(text, match[0]);

  let summaryKind: NlAchievementSummaryKind | undefined;
  for (const [re, kind] of ACHIEVEMENT_SUMMARY_CUES) {
    const cueMatch = re.exec(remaining);
    if (cueMatch) {
      summaryKind = kind as NlAchievementSummaryKind;
      consumed.push(cueMatch[0]);
      remaining = stripMatch(remaining, cueMatch[0]);
      break;
    }
  }

  // A negation governing the phrase itself ("players who NEVER kicked a
  // goal with their first kick") inverts the question into one this
  // engine cannot answer -- the achievement table records who DID it, and
  // "never" is a stopword, so without this check the polarity-inverted
  // list would have executed at full confidence. The one negated shape
  // that IS supported is "which clubs have never had one", where the
  // clubs_without cue owns the negation. Anything else declines.
  const before = text.slice(0, match.index);
  const negatedAchievement = /\b(?:never|not|didn'?t|hasn'?t|hadn'?t|haven'?t|without)\b[^.,;?]*$/.test(before)
    && summaryKind !== 'clubs_without';
  if (negatedAchievement) {
    return { text: remaining, negatedAchievement, consumed };
  }

  return { text: remaining, achievementKey: 'first_kick_goal', summaryKind, consumed };
}

// ------------------------------------------- marquee matches & rivalries

type MarqueeExtraction = {
  text: string;
  predicates: GridAxisState[];
  consumed: string[];
};

/**
 * A superlative immediately governing the phrase means the EVENT COUNT is
 * the ranked subject ("most anzac day games", "fewest showdowns") -- a
 * ranking no career predicate can express. Skipping extraction leaves the
 * phrase as leftover tokens, so the question declines instead of
 * answering "players with 1+ such games" as though it were the ranking.
 */
const SUPERLATIVE_GOVERNS = /\b(?:most|fewest|top|highest|lowest|best|worst)\s+$/;

/**
 * "played on anzac day", "3+ showdowns", "two western derbies" -- each
 * becomes a grid-solver careerPredicate (match_event_min /
 * matchup_played_min) with the count read from a short window before the
 * phrase, defaulting to 1. Rivalry club names resolve through the live
 * directory; a side that fails to resolve leaves the phrase alone.
 *
 * The consumed list is NOT merged into consumedTokens here: the plan can
 * only honour these predicates at career grain with no season range (the
 * predicate answer path ignores scope, and neither builder has a season
 * parameter), so plan assembly decides whether the words count as
 * understood or as leftovers that decline the question.
 */
function extractMarqueeMatches(
  text: string,
  clubs: readonly NlClubDirectoryEntry[],
): MarqueeExtraction {
  const predicates: GridAxisState[] = [];
  const consumed: string[] = [];
  let working = text;

  const entries: [RegExp, (times: number) => GridAxisState | null][] = [
    ...MATCH_EVENT_WORDS.map(([re, event]): [RegExp, (times: number) => GridAxisState | null] => [
      re,
      (times) => ({ builder: 'match_event_min', params: { event, times: String(times) } }),
    ]),
    ...RIVALRY_WORDS.map(([re, [nameA, nameB]]): [RegExp, (times: number) => GridAxisState | null] => [
      re,
      (times) => {
        const a = findClub(nameA, clubs);
        const b = findClub(nameB, clubs);
        if (!a || !b) return null;
        return {
          builder: 'matchup_played_min',
          params: {
            clubA: String(a.entity.organizationId),
            clubB: String(b.entity.organizationId),
            times: String(times),
          },
        };
      },
    ]),
  ];

  for (const [re, build] of entries) {
    const match = re.exec(working);
    if (!match) continue;
    const before = working.slice(Math.max(0, match.index - 12), match.index);
    if (SUPERLATIVE_GOVERNS.test(before)) continue;

    // Count lookback: "3 showdowns", "3+ anzac day games", "two western
    // derbies". Digit counts are read but not stripped -- pure digits are
    // invisible to both the confidence ratio and the player-name scan --
    // while an alpha number word is stripped like any other understood
    // token.
    const countWindow = working.slice(Math.max(0, match.index - 18), match.index);
    let times = 1;
    let countWord: string | null = null;
    const digits = /(\d{1,4})\+?\s*(?:or more\s*)?$/.exec(countWindow);
    if (digits) {
      times = Number(digits[1]);
    } else {
      for (const [word, n] of Object.entries(NUMBER_WORDS)) {
        if (new RegExp(`\\b${word}\\s*$`).test(countWindow)) {
          times = n;
          countWord = word;
          break;
        }
      }
    }

    const predicate = build(times);
    if (!predicate) continue;
    predicates.push(predicate);
    consumed.push(match[0]);
    working = stripMatch(working, match[0]);
    if (countWord) {
      consumed.push(countWord);
      working = stripMatch(working, countWord);
    }
  }

  return { text: working, predicates, consumed };
}

// ---------------------------------------------------------- career phrases

/**
 * Numeric career conditions: "300 games", "no premiership", "exactly two
 * clubs", "200+ games". A comparison-operator phrase governs the number
 * that follows it in the same clause; a bare number defaults to "at
 * least" (an unqualified count reads as a floor, the same convention
 * query-intent.ts's parsePlayerQuestion already uses); "no X" / "never X"
 * is an eq-0 condition regardless of any number present.
 */
const CAREER_STAT_WORDS: [RegExp, NlCareerColumn][] = [
  [/\bpremierships?\b|\bflags?\b/, 'premierships'],
  [/\bfinals?\b/, 'finals'],
  [/\bclubs?\b/, 'clubs_played'],
  [/\bgoals?\b/, 'goals'],
  [/\bgames?\b/, 'games'],
  [/\bwins?\b/, 'wins'],
  [/\blosses?\b/, 'losses'],
  // "drawn"/"drew" as well as "draw(s)": "played in at least 1 drawn
  // match" and "drew a game" name the same c.draws career total as "2
  // draws" does, but neither participle/past-tense form was recognised,
  // so the word was left for the entity scan to misread as a player
  // name. The trailing "match(es)" noun is folded into the SAME match
  // (not left for some other step to consume): an unconsumed "match" left
  // sitting in the text after "drawn" is claimed still reads as a
  // leftover, undeclined word and the whole question still declines even
  // though a real condition was found. "game(s)" is deliberately NOT
  // folded in here: the 'games' entry above already claims any "game(s)"
  // word (and, greedily, whatever count precedes it) before this entry
  // is even tried, so "drawn games" always reads as a games-count
  // condition regardless -- a pre-existing ambiguity this isn't trying
  // to resolve, not a new gap.
  [/\bdraws?\b|\bdrawn\b(?:\s+match(?:es)?)?|\bdrew\b(?:\s+an?\s+match)?/, 'draws'],
  [/\bbrownlow medals?\b/, 'brownlow_medals'],
  [/\bbrownlow votes?\b/, 'brownlow_votes'],
];

/**
 * The CAREER_STAT_WORDS columns with no meaningful single-game reading --
 * there is no "his best 1-game haul of premierships", and a player can't
 * win 'games' or 'wins' or 'brownlow_medals' inside one match. `goals`
 * and `brownlow_votes` are deliberately excluded: both are ALSO real
 * player_match_stats columns (METRIC_WORDS carries them too), so "dusty
 * most goals" asking for his best single-game haul is a real, intended
 * reading, not a bug.
 *
 * Used below to keep a named player's bare "most <career-only stat>"
 * out of the player_game default that everything else in this branch
 * gets: "Nick Dal Santo most games" was routing to player_game grain
 * with metric 'games', mode 'single' -- "his highest-games game", which
 * validatePlan correctly rejects (player_game has no `games` column at
 * all) with a message ("'games' is not a recognised statistic") that
 * reads like the site doesn't track games played, when the real total
 * (322) was sitting one grain over.
 */
const CAREER_ONLY_METRICS: ReadonlySet<string> = new Set(
  CAREER_STAT_WORDS.map(([, column]) => column).filter((column) => column !== 'goals' && column !== 'brownlow_votes'),
);

const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).join('|');
const BARE_MOST_NUMERIC_CAREER_CONDITION_RE = new RegExp(
  `\\bplayers?\\s+with\\b[^.]{0,60}?\\bmost\\s+(?:\\d{1,4}|${NUMBER_WORD_PATTERN})\\s+`
  + String.raw`(?:games?|goals?|finals?|clubs?|premierships?|flags?|wins?|losses?|draws?|brownlow\s+(?:medals?|votes?))\b`,
);

function hasBareMostNumericCareerCondition(text: string): boolean {
  const match = BARE_MOST_NUMERIC_CAREER_CONDITION_RE.exec(text);
  if (!match) return false;
  const mostAt = match[0].lastIndexOf('most');
  const beforeMost = match[0].slice(Math.max(0, mostAt - 3), mostAt);
  return !/\bat\s+$/.test(beforeMost);
}

function extractCareerConditions(text: string): {
  text: string; conditions: NlCareerCondition[]; predicates: GridAxisState[]; consumed: string[];
} {
  const conditions: NlCareerCondition[] = [];
  const predicates: GridAxisState[] = [];
  const consumed: string[] = [];
  let working = text;

  // "no <stat>" / "never <stat>" -- an explicit zero condition, checked
  // first so "no premiership" isn't later misread as an unqualified
  // "premiership" clause with no number. Bare "medal" (no "brownlow"
  // immediately before it) is read as brownlow_medals too: within this
  // site's vocabulary "the medal" said on its own, after a Brownlow
  // metric has already been named in the same question ("… with no
  // medal"), has no other plausible referent.
  const negativeTargets: [RegExp, NlCareerColumn][] = [
    ...CAREER_STAT_WORDS,
    // Bare "medal" / bare "brownlow" (no "votes" or "medal" attached):
    // within this site's vocabulary, said after a Brownlow metric has
    // already been named earlier in the same question ("most brownlow
    // votes without winning a brownlow"), neither has any other
    // plausible referent.
    [/\bmedals?\b/, 'brownlow_medals'],
    [/\bbrownlow\b(?! votes?)/, 'brownlow_medals'],
  ];
  // "no X" / "never <verb> X" / "without <verb-ing>? X" -- the trigger
  // word, then a short gap that absorbs whatever verb sits between it
  // and the stat ("kicking a", "winning a"), then the stat itself.
  //
  // re.source is wrapped in (?:...) here, NOT inlined bare. premierships'
  // own entry is /\bpremierships?\b|\bflags?\b/ -- a top-level alternation
  // -- and regex `|` has the lowest precedence there is, so splicing its
  // .source in unparenthesised turned this into two independent
  // alternatives: "(no|never|without) ... premierships" OR, completely
  // unconditionally, "flags" on its own. Every bare "flags" anywhere in a
  // question (not just "no flags") matched, pushing a false
  // premierships-equals-0 condition -- "most flags" produced a plan
  // asking for players with ZERO premierships. Silent, because the
  // resulting plan still validated; it just answered a different
  // question than it was asked. The group makes the prefix bind to
  // every alternative, the way it was always meant to.
  // "no" is a zero trigger ONLY when it is not the first word of a
  // comparator phrase: "no more than 4 goals" / "no fewer than 12 goals"
  // are COMPARE_OP_WORDS bounds (lte 4 / gte 12), and the broad span here
  // used to swallow them whole as { op:'eq', value:0 } before the numeric
  // loop below ever saw them. The lookahead excludes exactly the four
  // "no <comparative> than" comparator phrases and nothing else, so
  // genuine "no goals" / "never kicked a goal" / "without a goal" zero
  // conditions are untouched.
  for (const [re, column] of negativeTargets) {
    const negRe = new RegExp(`\\b(?:no(?!\\s+(?:more|fewer|less|greater)\\s+than\\b)|never|without)\\b[^.]{0,20}?(?:${re.source})`);
    const match = negRe.exec(working);
    if (match) {
      conditions.push({ kind: 'column', column, op: 'eq', value: 0 });
      consumed.push(match[0]);
      working = stripMatch(working, match[0]);
    }
  }

  // "exactly two clubs", "250 games", "200+ games", "at least 50 votes".
  for (const [re, column] of CAREER_STAT_WORDS) {
    const match = re.exec(working);
    if (!match) continue;
    // A window before the stat word carries the count and its operator.
    const idx = working.indexOf(match[0]);

    // "3 grand finals", "played in at least 1 preliminary final" -- the
    // bare /\bfinals?\b/ entry above reads ANY qualified final phrase as
    // the generic any-type career total (c.finals), leaving "grand" or
    // "preliminary"/"prelim" as an unconsumed word the entity scan then
    // misreads as an unresolved player name and declines on. GRID_BUILDERS
    // has a dedicated min-count builder for exactly these two final round
    // types (semi/qualifying/elimination finals have none), so a
    // qualifier immediately before "final(s)" answers through that
    // instead. Detected AHEAD of the 20-char lookback below, not after,
    // because that lookback is sized for a short stat word: "preliminary
    // " alone is 12 characters, which for "3 or more preliminary finals"
    // pushed the leading digit outside the window entirely -- the
    // condition silently vanished (`value` stayed null) rather than
    // falling back to the generic reading. Extending the lookback by the
    // qualifier's own length keeps the number search's effective budget
    // the same regardless of which qualifier, if any, preceded the word.
    let qualifierBuilder: 'grand_finals_played_min' | 'prelim_finals_played_min' | null = null;
    let qualifierSpan: { start: number; end: number; text: string } | null = null;
    if (column === 'finals') {
      const qualifierProbe = working.slice(Math.max(0, idx - 15), idx);
      const qualifierMatch = /\b(grand|preliminary|prelim)\b\s*$/i.exec(qualifierProbe);
      if (qualifierMatch) {
        qualifierBuilder = qualifierMatch[1].toLowerCase() === 'grand'
          ? 'grand_finals_played_min' : 'prelim_finals_played_min';
        const qualifierStart = Math.max(0, idx - 15) + qualifierMatch.index;
        qualifierSpan = { start: qualifierStart, end: qualifierStart + qualifierMatch[1].length, text: qualifierMatch[1] };
      }
    }
    const outerStart = Math.max(0, idx - 20 - (qualifierSpan ? idx - qualifierSpan.start : 0));
    // Clipped at the nearest preceding clause boundary (a comma, or "and")
    // so the window can never reach into a NEIGHBOURING numeric clause --
    // "players with more than 300 clubs and over 10 premierships" found
    // 250k-corpus rows where premierships (checked first: CAREER_STAT_WORDS
    // is in a fixed order, not the order the words appear in the
    // sentence) opened a 20-char window that reached back across "and"
    // into "300 clubs", read digit-boundary \b(\d{1,4})\b against the
    // slice "0 clubs and over 10" and matched the leftmost token -- the
    // truncated tail "0" left behind when the slice cut "300" in half, a
    // false number \b treats as complete because it evaluates against the
    // window substring, not the original text. That produced
    // premierships=0 (should be 10) AND, since the matched span included
    // that stray "0", deleted it from the middle of "300" for every
    // later clause too, leaving clubs_played to read "30". Clipping the
    // window at the clause boundary means a clause's number search can
    // never see a token that belongs to the clause before it.
    const priorText = working.slice(outerStart, idx);
    const lastAnd = priorText.toLowerCase().lastIndexOf(' and ');
    const lastComma = priorText.lastIndexOf(',');
    const boundaryEnd = Math.max(lastAnd >= 0 ? lastAnd + 5 : -1, lastComma >= 0 ? lastComma + 1 : -1);
    const windowStart = boundaryEnd >= 0 ? outerStart + boundaryEnd : outerStart;
    const window = working.slice(windowStart, idx + match[0].length);

    const plus = NUMBER_PLUS_RE.exec(window);
    let op: NlCompareOp = 'gte';
    let value: number | null = null;
    // Spans are recorded as absolute positions in `working` rather than as
    // text to search for again. "players with 3 games and exactly 3 clubs"
    // is why: both counts are the string "3", so removing the one this
    // clause used by first-occurrence deleted the OTHER clause's number
    // instead, leaving "games" with nothing to bind to and silently
    // dropping the condition.
    const spans: { start: number; end: number; text: string }[] = [
      { start: idx, end: idx + match[0].length, text: match[0] },
    ];
    const spanFrom = (m: RegExpExecArray, source = m[0]) => ({
      start: windowStart + m.index,
      end: windowStart + m.index + m[0].length,
      text: source,
    });

    if (plus) {
      value = Number(plus[1]);
      op = 'gte';
      spans.push(spanFrom(plus, plus[0].replace(/\+$/, '')));
    } else {
      for (const [opRe, opKind] of COMPARE_OP_WORDS) {
        const opMatch = opRe.exec(window);
        if (opMatch) { op = opKind; spans.push(spanFrom(opMatch)); break; }
      }
      const digits = /\b(\d{1,4})\b/.exec(window);
      if (digits) {
        value = Number(digits[1]);
        spans.push(spanFrom(digits, digits[1]));
      } else {
        for (const [word, n] of Object.entries(NUMBER_WORDS)) {
          const wordMatch = new RegExp(`\\b${word}\\b`).exec(window);
          if (wordMatch) { value = n; spans.push(spanFrom(wordMatch)); break; }
        }
      }
    }
    if (value === null) continue;

    // The `_min` builders only express a floor ("X+"/"at least"/a bare
    // number, which all default to 'gte' above); "fewer than 2 grand
    // finals" has nowhere to go there and falls back to the generic
    // any-type reading instead of declining outright.
    if (qualifierBuilder && op === 'gte') {
      predicates.push({ builder: qualifierBuilder, params: { times: String(value) } });
      if (qualifierSpan) spans.push(qualifierSpan);
    } else {
      conditions.push({ kind: 'column', column, op, value });
    }
    for (const span of spans) consumed.push(span.text);
    // Highest offset first, so removing one span cannot shift the
    // positions of the ones still to be removed.
    working = spans
      .sort((a, b) => b.start - a.start)
      .reduce((text, span) => `${text.slice(0, span.start)} ${text.slice(span.end)}`, working)
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { text: working, conditions, predicates, consumed };
}

// ---------------------------------------------------------- club-season

/**
 * Boolean club-season conditions: "fewest wins by a PREMIER", "worst team
 * to MAKE FINALS". Presence-only (no threshold/negation logic like
 * extractCareerConditions needs) -- each phrase already names exactly one
 * true/false club_seasons column, so a match is the condition.
 */
function extractClubSeasonConditions(text: string): { text: string; conditions: NlClubSeasonCondition[]; consumed: string[] } {
  const conditions: NlClubSeasonCondition[] = [];
  const consumed: string[] = [];
  let working = text;
  for (const [re, kind] of CLUB_SEASON_CONDITION_WORDS) {
    const match = re.exec(working);
    if (!match) continue;
    conditions.push({ kind });
    consumed.push(match[0]);
    working = stripMatch(working, match[0]);
  }
  return { text: working, conditions, consumed };
}

/**
 * club_season ranking metric ("most wins", "highest percentage"). Callers
 * only invoke this once a club-season cue already makes the grain
 * unambiguous -- see CLUB_SEASON_METRIC_WORDS's header comment on the
 * "wins"/player-career collision this gate avoids.
 */
function extractClubSeasonMetric(text: string): { text: string; metric?: string; consumed: string[] } {
  for (const [re, metric] of CLUB_SEASON_METRIC_WORDS) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), metric, consumed: [match[0]] };
  }
  return { text, consumed: [] };
}

// ------------------------------------------------------------------ rounds

function extractRound(text: string): { text: string; roundNumber?: number; consumed: string[] } {
  const roundRe = /\b(?:round|rd)\s+(\d{1,2})\b/i;
  const match = roundRe.exec(text);
  if (match) {
    const roundNumber = Number(match[1]);
    if (roundNumber >= 1 && roundNumber <= 25) {
      return { text: stripMatch(text, match[0]), roundNumber, consumed: [match[0]] };
    }
  }
  return { text, consumed: [] };
}

// -------------------------------------------------------------- boundary

const DEBUT_RE = /\b(?:first|debut(?:ed)?)\b/;
// Deliberately NOT "final" -- that word is the boundary's TARGET
// (grand_final/final, read from the already-extracted match type), and
// including it here would make any single-game-scoped question ("most
// disposals in a final") misread as a last-game boundary question too.
const LAST_GAME_RE = /\b(?:last|retired)\b/;

/**
 * Reads the boundary event/target from `text` plus the match type
 * extractMatchType already found -- NOT by re-scanning text for "grand
 * final"/"final" itself, which by this point extractMatchType has
 * already consumed. Only fires when the question actually named a
 * finals/grand-final target; "players whose first game was in 2020" is
 * not a boundary question this engine answers.
 */
function extractBoundary(
  text: string,
  matchType: string | undefined,
): { text: string; boundary?: NlBoundary; consumed: string[] } {
  if (matchType !== 'grand_final' && matchType !== 'finals') return { text, consumed: [] };
  const where: NlBoundary['where'] = matchType === 'grand_final' ? 'grand_final' : 'final';

  const debut = DEBUT_RE.exec(text);
  const last = !debut ? LAST_GAME_RE.exec(text) : null;
  const eventMatch = debut ?? last;
  if (!eventMatch) return { text, consumed: [] };

  let working = stripMatch(text, eventMatch[0]);
  const consumed = [eventMatch[0]];
  const gameWord = /\bgames?\b/.exec(working)?.[0];
  if (gameWord) {
    working = stripMatch(working, gameWord);
    consumed.push(gameWord);
  }
  const event: NlBoundary['event'] = debut ? 'debut' : 'last_game';
  return { text: working, boundary: { event, where }, consumed };
}

// ---------------------------------------------------------------- aggregation

/**
 * `polarity` is set when the aggregation came from a word whose direction
 * depends on the metric ("worst", "best") rather than on the word itself.
 * The caller resolves it once the metric is known -- see POLARITY_AGG_RE.
 */
function extractAggregation(text: string): {
  text: string; agg?: NlAggregation; consumed: string[]; polarity: boolean;
} {
  const topN = TOP_N_RE.exec(text);
  if (topN) {
    const n = /^\d+$/.test(topN[1]) ? Number(topN[1]) : readCount(topN[1]);
    // Only a real count makes a Top-N. TOP_N_RE's [a-z]+ arm matches
    // whatever word follows "top", so "top banana goals" used to land
    // here with readCount(...) null and a silent `?? 10` turned the
    // nonsense into a confident Top 10 -- and "top disposal games",
    // where the next word is the METRIC, got the same invented 10. An
    // unrecognised count falls through instead: AGG_WORDS reads the bare
    // "top" as the leader (max) and the following word stays in the
    // text, to be consumed as a metric if it is one and to block
    // execution as a leftover if it is not.
    if (n !== null) {
      return { text: stripMatch(text, topN[0]), agg: { kind: 'top_n', n }, consumed: [topN[0]], polarity: false };
    }
  }
  for (const [re, kind] of AGG_WORDS) {
    const match = re.exec(text);
    if (match) {
      const agg: NlAggregation = kind === 'top_n' ? { kind: 'top_n', n: 1 } : { kind };
      return {
        text: stripMatch(text, match[0]),
        agg,
        consumed: [match[0]],
        polarity: POLARITY_AGG_RE.test(match[0]),
      };
    }
  }
  return { text, consumed: [], polarity: false };
}

/**
 * Flip a polarity-word aggregation for a metric whose polarity is
 * inverted: a team's WORST loss is its BIGGEST one, not its narrowest.
 * Everything else keeps the direction AGG_WORDS gave it.
 */
function resolvePolarity(
  agg: NlAggregation | undefined,
  metric: string | null,
  polarity: boolean,
): NlAggregation | undefined {
  if (!agg || !polarity || !metric) return agg;
  if (!METRIC_HIGHER_IS_WORSE.has(metric)) return agg;
  if (agg.kind === 'min') return { kind: 'max' };
  if (agg.kind === 'max') return { kind: 'min' };
  return agg;
}

// --------------------------------------------------------------- metrics

function extractTeamMetric(text: string): { text: string; metric?: string; consumed: string[] } {
  for (const [re, metric] of TEAM_METRIC_WORDS) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), metric, consumed: [match[0]] };
  }
  return { text, consumed: [] };
}

function extractStreakDefinition(text: string): { text: string; streakDefinition?: { kind: 'win' | 'loss' | 'unbeaten' }; consumed: string[] } {
  for (const [re, kind] of STREAK_WORDS) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), streakDefinition: { kind }, consumed: [match[0]] };
  }
  return { text, consumed: [] };
}

function extractPeriodSplit(text: string): { text: string; periodSplit?: NlQueryPlan['periodSplit']; consumed: string[] } {
  for (const [re, split] of PERIOD_SPLIT_WORDS) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), periodSplit: split, consumed: [match[0]] };
  }
  return { text, consumed: [] };
}

function extractScoreCheckpoint(text: string): { text: string; scoreCheckpoint?: NlQueryPlan['scoreCheckpoint']; consumed: string[] } {
  const entries: [RegExp, NonNullable<NlQueryPlan['scoreCheckpoint']>][] = [
    [/\bat (?:3qt|three[- ]quarter)[- ]time\b|\b(?:3qt|three[- ]quarter)[- ]time\b/, '3QT'],
    [/\bat half[- ]time\b|\bhalf[- ]time\b/, 'HT'],
    [/\bat (?:q(?:uarter)?|qtr|quarter|quatre)[- ]time\b|\b(?:q(?:uarter)?|qtr|quarter|quatre)[- ]time\b/, 'QT'],
  ];
  for (const [re, checkpoint] of entries) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), scoreCheckpoint: checkpoint, consumed: [match[0]] };
  }
  return { text, consumed: [] };
}

function extractResultFilter(text: string): { text: string; resultFilter?: NlQueryPlan['resultFilter']; consumed: string[] } {
  const match = /\b(?:but|and|then|eventually|still|went on to)\s+won\b|\bwent on to win\b/.exec(text);
  if (!match) return { text, consumed: [] };
  return { text: stripMatch(text, match[0]), resultFilter: 'won', consumed: [match[0]] };
}

function extractHavingClause(text: string): {
  text: string;
  havingClause?: { metric: 'wins' | 'losses' | 'draws'; op: NlCompareOp; value: number };
  consumed: string[];
} {
  const words: [RegExp, 'wins' | 'losses' | 'draws'][] = [
    [/\bdraws?\b/, 'draws'],
    [/\bwins?\b/, 'wins'],
    [/\blosses?\b/, 'losses'],
    [/\b(?:lose|lost)\b/, 'losses'],
    [/\b(?:win|won)\b/, 'wins']
  ];
  let working = text;
  for (const [re, metric] of words) {
    const match = re.exec(working);
    if (match) {
      const idx = working.indexOf(match[0]);
      const windowStart = Math.max(0, idx - 20);
      const windowEnd = Math.min(working.length, idx + match[0].length + 20);
      const window = working.slice(windowStart, windowEnd);
      let op: NlCompareOp = 'gte';
      let value: number | null = null;
      let countStr = '';
      
      const twice = /\btwice\b/.exec(window);
      const thrice = /\b(?:thrice|3 times)\b/.exec(window);
      const times = /\b(\d{1,4})\s+times\b/.exec(window);
      if (twice) { value = 2; countStr = twice[0]; }
      else if (thrice) { value = 3; countStr = thrice[0]; }
      else if (times) { value = Number(times[1]); countStr = times[0]; }
      else {
        const digits = /\b(\d{1,4})\b/.exec(window);
        if (digits) { value = Number(digits[1]); countStr = digits[0]; }
        else {
          // The same number-word vocabulary the threshold extractors use
          // ("exactly three wins against Carlton") -- digits win when both
          // are present, mirroring readCount's rule.
          for (const [word, n] of Object.entries(NUMBER_WORDS)) {
            const wordMatch = new RegExp(`\\b${word}\\b`).exec(window);
            if (wordMatch) { value = n; countStr = wordMatch[0]; break; }
          }
        }
      }

      if (value !== null) {
        let matchedOperator: string | null = null;
        for (const [operatorPattern, parsedOp] of COMPARE_OP_WORDS) {
          const operatorMatch = operatorPattern.exec(window);
          if (!operatorMatch) continue;
          op = parsedOp;
          matchedOperator = operatorMatch[0];
          break;
        }

        const consumed = [match[0], countStr, ...(matchedOperator ? [matchedOperator] : [])];
        working = stripMatch(working, match[0]);
        working = stripMatch(working, countStr);
        if (matchedOperator) working = stripMatch(working, matchedOperator);
        return { text: working, havingClause: { metric, op, value }, consumed };
      }
    }
  }
  return { text: working, consumed: [] };
}

function extractMatchFilter(
  text: string,
  resultMetric: 'wins' | 'losses' | 'draws' | undefined,
): {
  text: string;
  matchFilter?: { metric: 'win_margin' | 'loss_margin'; op: NlCompareOp; value: number };
  consumed: string[];
} {
  const match = /\bby\s+(?:(more than|over|at least|at most|less than|exactly)\s+)?(\d{1,3})(\+)?\s+points?\b/.exec(text);
  if (!match || (resultMetric !== 'wins' && resultMetric !== 'losses')) return { text, consumed: [] };

  let op: NlCompareOp = 'gte';
  if (match[1] === 'more than' || match[1] === 'over') op = 'gt';
  else if (match[1] === 'at most') op = 'lte';
  else if (match[1] === 'less than') op = 'lt';
  else if (match[1] === 'exactly') op = 'eq';

  return {
    text: stripMatch(text, match[0]),
    matchFilter: { metric: resultMetric === 'wins' ? 'win_margin' : 'loss_margin', op, value: Number(match[2]) },
    consumed: [match[0]],
  };
}

function extractPlayerMetric(text: string): { text: string; metric?: string; consumed: string[] } {
  for (const [re, metric] of METRIC_WORDS) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), metric, consumed: [match[0]] };
  }
  return { text, consumed: [] };
}

/**
 * A comparator/number governing a METRIC_WORDS stat -- "at most 25
 * disposals", "more than 30 tackles", "40+ hitouts". Consumed ATOMICALLY:
 * metric word, operator phrase, and number leave the text together, so no
 * fragment ("most" out of "at most") can reach player-name resolution.
 *
 * The CAREER_STAT_WORDS stats (goals, games, ...) never reach this: their
 * thresholds are claimed one step earlier by extractCareerConditions, and
 * grain election decides whether that condition stays a career condition
 * or becomes a game/season metricCondition. This function covers the
 * player_match_stats vocabulary that has no career-condition path at all.
 *
 * Number lookback reuses extractCareerConditions' discipline: clipped at
 * the nearest preceding clause boundary (comma or "and") so one clause's
 * number search can never see a token that belongs to the clause before
 * it. No number in the window means no match at all -- the caller falls
 * through to plain metric extraction, and nothing here is half-consumed.
 */
function extractPlayerMetricThreshold(text: string): {
  text: string; metric?: string; condition?: NlMetricCondition; consumed: string[];
} {
  let found: { match: RegExpExecArray; metric: string } | null = null;
  for (const [re, metric] of METRIC_WORDS) {
    const match = re.exec(text);
    if (match) { found = { match, metric }; break; }
  }
  if (!found) return { text, consumed: [] };
  const { match, metric } = found;
  const idx = match.index;

  const outerStart = Math.max(0, idx - 24);
  const priorText = text.slice(outerStart, idx);
  const lastAnd = priorText.toLowerCase().lastIndexOf(' and ');
  const lastComma = priorText.lastIndexOf(',');
  const boundaryEnd = Math.max(lastAnd >= 0 ? lastAnd + 5 : -1, lastComma >= 0 ? lastComma + 1 : -1);
  const windowStart = boundaryEnd >= 0 ? outerStart + boundaryEnd : outerStart;
  const window = text.slice(windowStart, idx + match[0].length);

  let op: NlCompareOp = 'gte';
  let value: number | null = null;
  const spans: { start: number; end: number; text: string }[] = [
    { start: idx, end: idx + match[0].length, text: match[0] },
  ];
  const spanFrom = (m: RegExpExecArray, source = m[0]) => ({
    start: windowStart + m.index,
    end: windowStart + m.index + m[0].length,
    text: source,
  });

  const plus = NUMBER_PLUS_RE.exec(window);
  if (plus) {
    value = Number(plus[1]);
    spans.push(spanFrom(plus, plus[0].replace(/\+$/, '')));
  } else {
    for (const [opRe, opKind] of COMPARE_OP_WORDS) {
      const opMatch = opRe.exec(window);
      if (opMatch) { op = opKind; spans.push(spanFrom(opMatch)); break; }
    }
    const digits = /\b(\d{1,4})\b/.exec(window);
    if (digits) {
      value = Number(digits[1]);
      spans.push(spanFrom(digits, digits[1]));
    } else {
      for (const [word, n] of Object.entries(NUMBER_WORDS)) {
        const wordMatch = new RegExp(`\\b${word}\\b`).exec(window);
        if (wordMatch) { value = n; spans.push(spanFrom(wordMatch)); break; }
      }
    }
  }
  if (value === null) return { text, consumed: [] };

  const consumed = spans.map((span) => span.text);
  const stripped = spans
    .sort((a, b) => b.start - a.start)
    .reduce((t, span) => `${t.slice(0, span.start)} ${t.slice(span.end)}`, text)
    .replace(/\s+/g, ' ')
    .trim();
  return { text: stripped, metric, condition: { op, value }, consumed };
}

// ---------------------------------------------------------- player mention

/** "by a/an/the <words> player" names a generic player from a club, not a specific person -- must be read before candidate player-name scanning. */
const BY_CLUB_PLAYER_RE = /\bby (?:an?|the) ([a-z][a-z ]{1,30}?) player\b/;

function extractByClubPlayer(
  text: string,
  clubs: readonly NlClubDirectoryEntry[],
): { text: string; clubFor?: NlEntityMatch<NlClubDirectoryEntry>; consumed: string[] } {
  const match = BY_CLUB_PLAYER_RE.exec(text);
  if (!match) return { text, consumed: [] };
  const clubMatch = findClub(match[1], clubs);
  if (!clubMatch) return { text, consumed: [] };
  return { text: stripMatch(text, match[0]), clubFor: clubMatch, consumed: [match[0]] };
}

/**
 * The longest leftover run of meaningful alphabetic words -- what's left
 * once every other slot has been extracted, with stopwords/connectives
 * discarded, is the only thing left that could name a player. Returning
 * null when nothing meaningful remains matters: it is the difference
 * between "no player was mentioned" and "a player was mentioned but
 * could not be resolved", which score very differently.
 */
function candidatePlayerSpan(text: string): string | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  const alphaRun = tokens.filter((t) => /^[a-z]+$/.test(t) && !STOPWORDS.has(t));
  if (alphaRun.length === 0) return null;
  return alphaRun.slice(0, 4).join(' ');
}

/** Player suffix spelling is part of identity, but common variants are equivalent for lookup. */
function normalisePlayerSuffixes(name: string): string {
  return name
    .replace(/\b(?:jr|junior)\b/g, 'jnr')
    .replace(/\b(?:sr|senior)\b/g, 'snr');
}

/**
 * Every word a candidate can justify a mention token against: the words
 * of its canonical name plus, when the resolver matched a different form
 * (an alias), the words of that matched form. The alias is ADDITIONAL
 * evidence -- "Gary Ablett Jnr" matched through an alias still justifies
 * "gary" and "ablett" from the canonical name, and "jnr" only because the
 * alias carries it. A token that neither form contains stays unjustified
 * and is left in the text for the decline gate.
 */
function candidateNameWords(c: NlPlayerCandidate): string[] {
  const words = new Set(normalisePlayerSuffixes(c.ref.name.toLowerCase()).split(/\s+/));
  if (c.matchedName) {
    for (const w of normalisePlayerSuffixes(c.matchedName.toLowerCase()).split(/\s+/)) words.add(w);
  }
  return [...words];
}

// -------------------------------------------------------------- main entry

export async function parseNlQuestion(query: string, ctx: NlParseContext): Promise<NlParse> {
  const normalised = canonicalise(query);
  const report = emptyReport(normalised);
  let text = normalised;

  const totalTokens = meaningfulTokens(normalised);
  const consumedTokens: string[] = [];
  const notes: string[] = [];

  if (hasBareMostNumericCareerCondition(text)) {
    report.confidence = 1;
    report.notes.push('"most N games" is malformed; use "at most N games" for an upper bound or "most games" for a leaderboard.');
    return { status: 'none', reason: 'unrecognised', report };
  }

  // 1. Unanswerable-topic gate, before anything else consumes a token
  // that would otherwise make an absent-data question look partially
  // understood.
  for (const topic of UNANSWERABLE_TOPICS) {
    if (topic.re.test(text)) {
      report.confidence = 1;
      report.notes.push(topic.reason);
      return { status: 'unanswerable', topic: topic.topic, reason: topic.reason, report };
    }
  }

  // 1b. Marquee fixtures and named rivalries -- BEFORE venue extraction,
  // because "dreamtime at the 'g" contains the MCG alias "the g", and
  // BEFORE club extraction, because "sydney derby" and "western derby"
  // contain club-name words. Consumption into the token ledger is
  // deferred to plan assembly -- see extractMarqueeMatches.
  const marqueeResult = extractMarqueeMatches(text, ctx.clubs);
  text = marqueeResult.text;

  // 2. Venue extraction, BEFORE any club extraction.
  //
  // Five venue names contain a club name as a whole word -- "melbourne
  // cricket ground", "sydney cricket ground", "sydney showground",
  // "adelaide oval", "east melbourne" -- and no club name contains a
  // venue name, so the containment only runs one way. With clubs first,
  // "most goals at Melbourne Cricket Ground" had "melbourne" consumed as
  // a club, leaving "cricket ground", which matches no venue: the
  // question then resolved to neither the club nor the ground and
  // returned nothing at all. "the MCG" worked, so the full name of the
  // most-used ground in the sport was the broken spelling.
  //
  // Extracting venues first makes the longer, more specific phrase win,
  // which is the same rule findLongestMatch already applies WITHIN a
  // directory -- this just applies it across the two. Safe in the other
  // direction precisely because the containment is one-way: no club
  // mention can be swallowed by a venue name.
  const venueMatch = findVenue(text, ctx.venues);
  let venue: NlEntityMatch<NlVenueDirectoryEntry> | undefined;
  if (venueMatch) {
    venue = venueMatch;
    text = stripMatch(text, venueMatch.matchedText);
    consumedTokens.push(venueMatch.matchedText);
    report.entityResolution.push({ mention: venueMatch.matchedText, resolvedTo: venueMatch.entity.name, certainty: 1 });
  }

  // 3. "by a <club> player" -- must run before general club extraction,
  // since it also contains a club name that would otherwise be treated
  // as an ordinary clubFor/clubAgainst mention with no special meaning.
  const byClubPlayer = extractByClubPlayer(text, ctx.clubs);
  text = byClubPlayer.text;
  consumedTokens.push(...byClubPlayer.consumed);

  // 4. Club extraction (roles resolved by governing preposition).
  // Peek at a relationship cue first so the "to" inside "head to head"
  // cannot govern a later club as though the reader wrote "lost to".
  // The cue is committed only after two real clubs resolve.
  const headToHeadResult = extractHeadToHeadCue(text);
  const clubExtraction = extractClubs(headToHeadResult.cue ? headToHeadResult.text : text, ctx.clubs);
  text = clubExtraction.text;
  consumedTokens.push(...clubExtraction.consumed);
  let clubFor = byClubPlayer.clubFor ?? clubExtraction.clubFor;
  let clubAgainst = clubExtraction.clubAgainst;
  let matchup = byClubPlayer.clubFor ? undefined : clubExtraction.matchup;

  // Relationship-level language needs both real directory entities before
  // it can become a plan. Once the pair is proven, normalize role-based
  // extraction ("A record against B", "draws between A and B") to the same
  // unordered matchup scope used by a literal "A v B".
  let headToHead: NlQueryPlan['headToHead'];
  if (headToHeadResult.cue && (matchup || (clubFor && clubAgainst))) {
    if (!matchup && clubFor && clubAgainst) {
      matchup = { clubA: clubFor, clubB: clubAgainst };
    }
    clubFor = undefined;
    clubAgainst = undefined;
    headToHead = { kind: headToHeadResult.cue.kind };
    consumedTokens.push(...headToHeadResult.consumed);
  } else if (headToHeadResult.cue) {
    // One or zero clubs: restore the relationship words as meaningful
    // leftovers so the confidence gate declines instead of answering a
    // narrower question that silently discarded the missing participant.
    text = `${text} ${headToHeadResult.cue.matchedText}`.trim();
  }
  if (clubFor) report.entityResolution.push({ mention: clubFor.matchedText, resolvedTo: clubFor.entity.name, certainty: 1 });
  if (clubAgainst) report.entityResolution.push({ mention: clubAgainst.matchedText, resolvedTo: clubAgainst.entity.name, certainty: 1 });
  if (matchup) {
    report.entityResolution.push({ mention: matchup.clubA.matchedText, resolvedTo: matchup.clubA.entity.name, certainty: 1 });
    report.entityResolution.push({ mention: matchup.clubB.matchedText, resolvedTo: matchup.clubB.entity.name, certainty: 1 });
  }

  // 5. Seasons, match type, award.
  const seasons = extractSeasons(text);
  text = seasons.text;
  consumedTokens.push(...seasons.consumed);

  // A team-scoring word anywhere in the question means a bare "grand
  // final"/"finals" can only be scope, never the player_career metric --
  // see extractMatchType. Peeked before extraction so the decision is made
  // on the whole question rather than on whatever is left by this point.
  const matchTypeResult = extractMatchType(text, hasTeamMetricWord(text) || hasBareMatchTypeRecordCue(text));
  text = matchTypeResult.text;
  consumedTokens.push(...matchTypeResult.consumed);

  const roundResult = extractRound(text);
  text = roundResult.text;
  consumedTokens.push(...roundResult.consumed);

  const awardResult = extractAward(text);
  text = awardResult.text;
  consumedTokens.push(...awardResult.consumed);

  // 5a. The first-kick goal achievement. Runs here, ahead of every metric
  // and grain cue, because the phrase contains both "goal" and "kick" --
  // two METRIC_WORDS entries that would otherwise be read as the question's
  // ranking subject the moment this phrase was left in the text. Consuming
  // the whole span first is also what keeps "first" away from the boundary
  // logic further down. See FIRST_KICK_GOAL_RE for the phrases this
  // deliberately does NOT match ("first goal", "debut goal", ...).
  const achievementResult = extractFirstKickGoal(text);
  text = achievementResult.text;
  consumedTokens.push(...achievementResult.consumed);
  if (achievementResult.negatedAchievement) {
    // The phrase was understood but the question asks for the players who
    // did NOT do it -- see extractFirstKickGoal. No achievementKey means
    // no structure downstream, so this declines as unrecognised; the note
    // tells the reader (and the search log) why.
    notes.push('Questions about players who did not achieve this are not supported.');
  }

  // 5b. "N disposal games" idiom -- resolves the metric AND acts as a
  // single-game grain cue in one step, so "games" never lingers in the
  // text for the player-name scan to misread.
  let idiomMetric: string | undefined;
  for (const [re, metric] of STAT_GAMES_IDIOM_WORDS) {
    const match = re.exec(text);
    if (match) {
      idiomMetric = metric;
      consumedTokens.push(match[0]);
      text = stripMatch(text, match[0]);
      break;
    }
  }

  // 6. Grain cues. Checking matchTypeResult.matchType rather than
  // re-testing IN_A_FINAL/IN_A_GRAND_FINAL against `text` matters:
  // extractMatchType (step 5, above) has already stripped "grand
  // final"/"final" out of `text`, so those phrase regexes would never
  // fire here even when they were exactly what the reader typed. Any
  // match-type scope inherently means individual matches of that type,
  // which is the single-game reading by nature -- "most disposals in a
  // final" ranks individual final performances, not a sum across finals.
  const inOneGame = !!idiomMetric || IN_ONE_GAME.test(text) || !!matchTypeResult.matchType
    || roundResult.roundNumber !== undefined;
  const inOneSeason = IN_ONE_SEASON.test(text);
  const overCareer = OVER_CAREER.test(text);
  // "dusty TOTAL goals against Carlton" -- overrides the named-player
  // single-game default toward a scoped running total.
  const aggregateTotal = AGGREGATE_TOTAL_WORDS.test(text);
  // Every cue phrase the flags above just read is CONSUMED, not merely
  // stripped. These words were understood -- "career" in "dusty career
  // goals against Carlton" did exactly its job -- and leaving them out
  // of consumedTokens depressed tokenRatio to 0.75 on perfectly parsed
  // questions. That mattered little when the clarify band executed
  // anyway; now that a leftover meaningful token DECLINES in the band
  // (see the gate at the end of this function), an understood word that
  // still looked leftover would turn correct answers into declines.
  for (const cueRe of [IN_ONE_GAME, IN_A_FINAL, IN_A_GRAND_FINAL, IN_ONE_SEASON, OVER_CAREER, AGGREGATE_TOTAL_WORDS]) {
    const cueMatch = cueRe.exec(text);
    if (cueMatch) {
      consumedTokens.push(cueMatch[0]);
      text = text.replace(cueRe, ' ');
    }
  }

  const debutGameMatch = /\bon (?:their )?debut\b|\bdebut game\b/.exec(text);
  const debutGame = !!debutGameMatch;
  if (debutGameMatch) {
    consumedTokens.push(debutGameMatch[0]);
    text = stripMatch(text, debutGameMatch[0]);
  }

  const negated = NEGATION_WORDS.test(text);

  // 7. Boundary ("debuted in a grand final", "last game was a final").
  // Reads matchTypeResult, computed above at step 5, rather than
  // re-scanning `text` -- extractMatchType has already consumed the
  // "grand final"/"final" words this depends on.
  const boundaryResult = extractBoundary(text, matchTypeResult.matchType);
  text = boundaryResult.text;
  const boundary = boundaryResult.boundary;
  if (boundary) consumedTokens.push(...boundaryResult.consumed);

  // 8. Aggregation.
  const aggResult = extractAggregation(text);
  text = aggResult.text;
  consumedTokens.push(...aggResult.consumed);

  const streakResult = extractStreakDefinition(text);
  text = streakResult.text;
  consumedTokens.push(...streakResult.consumed);

  const havingResult = extractHavingClause(text);
  text = havingResult.text;
  consumedTokens.push(...havingResult.consumed);

  const matchFilterResult = extractMatchFilter(text, havingResult.havingClause?.metric);
  text = matchFilterResult.text;
  consumedTokens.push(...matchFilterResult.consumed);

  const resultFilterResult = extractResultFilter(text);
  text = resultFilterResult.text;
  consumedTokens.push(...resultFilterResult.consumed);

  const periodSplitResult = extractPeriodSplit(text);
  text = periodSplitResult.text;
  consumedTokens.push(...periodSplitResult.consumed);

  const scoreCheckpointResult = extractScoreCheckpoint(text);
  text = scoreCheckpointResult.text;
  consumedTokens.push(...scoreCheckpointResult.consumed);

  const teamMetricResult = extractTeamMetric(text);
  // Do NOT update text with teamMetricResult.text here.
  // The match is stripped at step 11 instead to allow career conditions
  // to see unstripped words if they overlap.

  const clubSubjectPresent = CLUB_SUBJECT_LEADING.test(text.trim());

  // 10. Career conditions (numeric thresholds/negatives on career columns).
  const careerResult = extractCareerConditions(text);
  text = careerResult.text;
  consumedTokens.push(...careerResult.consumed);

  // 10.2. "debuted in the 1990s" / "debuted between 2000 and 2009" -- the
  // season range extracted at step 5 IS the debut window when a debut
  // word governs it, so both become one grid-solver debuted_between
  // predicate (the career answer path ignores season scope, so leaving
  // the range in scope alone would silently answer for every era).
  // Boundary questions ("debuted in a grand final") have already claimed
  // their debut word, and extractFirstKickGoal has already consumed
  // "first kick" spans, so this reads only what is genuinely left. Runs
  // after extractCareerConditions so a threshold's "games" ("debuted in
  // the 1990s with 300 games") has been claimed before "first ... game"
  // is tried. Attachment is deferred to plan assembly, like the marquee
  // predicates.
  let debutPredicate: GridAxisState | null = null;
  let debutConsumed: string | null = null;
  if (!boundary && (seasons.seasonMin !== undefined || seasons.seasonMax !== undefined)) {
    const debutWord = /\bdebut(?:ed)?\b|\bfirst (?:career )?game\b/.exec(text);
    if (debutWord) {
      debutPredicate = {
        builder: 'debuted_between',
        params: {
          from: String(seasons.seasonMin ?? NL_LIMITS.minSeason),
          to: String(seasons.seasonMax ?? NL_LIMITS.maxSeason),
        },
      };
      debutConsumed = debutWord[0];
      text = stripMatch(text, debutWord[0]);
    }
  }

  // 10.5. Club-season conditions/metric. Conditions run first and are
  // themselves one of the cues that makes a question club-season in the
  // first place ("fewest wins BY A PREMIER" has no leading "teams" word
  // at all); the metric word ("wins"/"losses"/"draws") is only tried once
  // a cue already exists, since those words also name a player career
  // column -- see CLUB_SEASON_METRIC_WORDS's header comment.
  const clubSeasonConditionResult = extractClubSeasonConditions(text);
  text = clubSeasonConditionResult.text;
  consumedTokens.push(...clubSeasonConditionResult.consumed);

  // Deliberately NOT triggered by clubFor alone: a named club is just as
  // often a player_game/player_season scope ("richmond's most goals
  // against carlton"), so only an unambiguous club-season signal elects
  // this grain: a leading "teams"/"clubs" subject, one of the boolean
  // conditions above, or -- the case a bare clubFor CAN safely cue -- a
  // named club with one of the club-season-only metric words AND season
  // wording ("Richmond most wins in a season"). The metric word does the
  // disambiguating there: "wins"/"percentage" is not a player stat the
  // way "goals" is, so the player_game/player_season readings the
  // caution above protects do not exist for it. Probed without
  // consuming; the guarded extraction below still does the real work.
  const seasonWorded = inOneSeason || seasons.seasonMin !== undefined || seasons.seasonMax !== undefined;
  const clubSeasonMetricWordPresent = CLUB_SEASON_METRIC_WORDS.some(([re]) => re.test(text));
  const clubSeasonCuePresent = clubSubjectPresent
    || clubSeasonConditionResult.conditions.length > 0
    || (!!clubFor && !teamMetricResult.metric && clubSeasonMetricWordPresent && seasonWorded);

  let clubSeasonMetricResult: { text: string; metric?: string; consumed: string[] } = { text, consumed: [] };
  if (clubSeasonCuePresent && !teamMetricResult.metric) {
    clubSeasonMetricResult = extractClubSeasonMetric(text);
    text = clubSeasonMetricResult.text;
    consumedTokens.push(...clubSeasonMetricResult.consumed);
  }

  // 11. Player stat metric (only tried once team-metric words have had
  // first refusal, and only consumed from `text` if a team metric did
  // NOT already fire, so "goals" in "biggest win" scope never
  // double-reads as a player stat too).
  let playerMetricResult: { text: string; metric?: string; consumed: string[] };
  // Set when a comparator/number was consumed with the metric word; grain
  // election below decides which typed representation honours it.
  let pendingMetricCondition: NlMetricCondition | undefined;
  if (teamMetricResult.metric) {
    // Strip the matched word from the CURRENT text, not
    // teamMetricResult.text -- that snapshot was computed back at step 9,
    // before extractCareerConditions/extractClubSeasonConditions (steps
    // 10/10.5) had a chance to strip anything, so assigning it wholesale
    // would silently resurrect whatever those steps already removed
    // ("most losses by a premiership team" stripped "premiership team"
    // correctly, then had it reappear here, misread as a failed
    // player-name guess).
    text = stripMatch(text, teamMetricResult.consumed[0]);
    consumedTokens.push(...teamMetricResult.consumed);
    playerMetricResult = { text, consumed: [] };
  } else if (idiomMetric) {
    playerMetricResult = { text, metric: idiomMetric, consumed: [] };
  } else {
    // A comparator/number governing the metric is one atomic phrase --
    // extracted BEFORE the plain metric word so "at most 25 disposals"
    // can never strand "most"/"25" for later stages (the stranded "most"
    // was reaching player-name resolution and declining as
    // ambiguous_player). Whether the threshold survives as a typed
    // metricCondition, converts to a career condition, or fails closed is
    // grain election's decision below.
    const thresholdResult = extractPlayerMetricThreshold(text);
    if (thresholdResult.metric && thresholdResult.condition) {
      pendingMetricCondition = thresholdResult.condition;
      playerMetricResult = { text: thresholdResult.text, metric: thresholdResult.metric, consumed: thresholdResult.consumed };
      text = thresholdResult.text;
      consumedTokens.push(...thresholdResult.consumed);
    } else {
      playerMetricResult = extractPlayerMetric(text);
      text = playerMetricResult.text;
      consumedTokens.push(...playerMetricResult.consumed);
    }

    // "most games without kicking a goal", "most finals played without a
    // premiership" -- games/finals/premierships/... are ranked career
    // subjects, not in METRIC_WORDS (that vocabulary is
    // player_match_stats-grain stats). Only read as a metric when NOT
    // already claimed by extractCareerConditions as a threshold ("300
    // games", already stripped from `text` by this point) -- a bare,
    // still-present word is the leftover subject noun of the
    // superlative itself. Must run here, before the player-mention scan,
    // or the word is misread as an unresolved player name.
    //
    // Reuses CAREER_STAT_WORDS rather than a separate list: this used to
    // hand-list only games/goals/finals, so every OTHER career column it
    // already knows how to read as a THRESHOLD -- premierships, wins,
    // losses, draws, brownlow medals, clubs_played -- had no path to
    // being read as a bare RANKING subject at all. "most premierships"
    // matched none of the three and fell all the way through to the
    // player-name guess, declining as "no player named premierships".
    // The same list already carries the right NlCareerColumn for each
    // word; there was never a reason to keep a second, narrower copy.
    if (!playerMetricResult.metric && !teamMetricResult.metric) {
      for (const [re, key] of CAREER_STAT_WORDS) {
        const bare = re.exec(text);
        if (!bare) continue;
        playerMetricResult = { text: stripMatch(text, bare[0]), metric: key, consumed: [bare[0]] };
        text = playerMetricResult.text;
        consumedTokens.push(bare[0]);
        break;
      }
    }
  }

  // 12. Player mention -- the one async step. Whatever alpha tokens
  // remain, after nickname substitution, are tried against the real
  // player directory.
  let player: NlPlayerRef | undefined;
  let playerCertainty = 1;
  const candidateRaw = candidatePlayerSpan(text);
  let unresolvedPlayerMention: string | null = null;
  let ambiguousPlayerMention: string | null = null;
  // "Ablett most goals" -- set instead of ambiguousPlayerMention when the
  // resolver couldn't confidently pick ONE candidate but the mention
  // plausibly spells a small, real set of them. See NlMatchScope.playerIdIn.
  let ambiguousCandidateIds: number[] | undefined;
  if (candidateRaw && candidateRaw.length >= 3) {
    // `Object.hasOwn`, not a plain index: the key is reader-typed text, so
    // `constructor` and friends come back off the prototype chain as truthy
    // non-strings and get passed on as the name to resolve.
    const firstWord = candidateRaw.split(' ')[0];
    const nicknameKey = Object.hasOwn(PLAYER_NICKNAMES, candidateRaw)
      ? candidateRaw
      : Object.hasOwn(PLAYER_NICKNAMES, firstWord) ? firstWord : null;
    const lookupName = normalisePlayerSuffixes(
      nicknameKey !== null ? PLAYER_NICKNAMES[nicknameKey] : candidateRaw,
    );
    const candidates = await ctx.resolvePlayer(lookupName);
    const top = candidates[0];
    if (top && top.score >= PLAYER_ACCEPT_SCORE) {
      player = top.ref;

      // Only the tokens the resolution JUSTIFIES are consumed: the
      // nickname key's own tokens, plus any token that is (a prefix of)
      // a word of the resolved player's actual name. Consuming the whole
      // span let arbitrary noise vanish behind a valid name -- "dusty
      // banana most goals" resolved "dusty", then counted "banana" as
      // consumed too, and answered at full confidence as though the
      // nonsense had never been typed. Now "banana" stays in the text as
      // a leftover, and the gate at the end declines rather than guesses.
      const nameWords = candidateNameWords(top);
      const nicknameTokens = new Set(nicknameKey !== null ? nicknameKey.split(' ') : []);
      const spanTokens = candidateRaw.split(' ');
      const justified = spanTokens.filter(
        (t) => nicknameTokens.has(t) || nameWords.some((w) => w.startsWith(normalisePlayerSuffixes(t))),
      );
      const mention = justified.length > 0 ? justified.join(' ') : candidateRaw;

      // Surname-only ambiguity, independent of the resolver's score gap:
      // count the candidates whose name contains every mention word (as
      // a whole-word prefix). "Thomas" is both a surname and a first
      // name, so prominence ranking can put one Thomas 200+ points clear
      // and the gap rule alone reads a bare surname as certain -- but
      // two candidates both genuinely called Thomas means the reader has
      // not said which one, however lopsided their game counts are.
      // Nickname-resolved mentions skip this: "dusty" already names one
      // specific player by construction.
      const mentionTokens = justified.length > 0 ? justified : spanTokens;
      const nameMatches = nicknameKey !== null ? 1 : candidates.filter((c) => {
        const words = candidateNameWords(c);
        return mentionTokens.every((t) => words.some((w) => w.startsWith(normalisePlayerSuffixes(t))));
      }).length;

      const second = candidates[1];
      const gapCertain = !second || top.score - second.score > 200;
      playerCertainty = nameMatches >= 2 ? 0.7 : gapCertain ? 1 : 0.7;
      // playerId/matchedName are telemetry-only evidence (see
      // NlEntityResolution): the canonical display name cannot tell two
      // same-named players apart, and the matched alias preserves the
      // Jr/Snr form that justified the resolution. Nothing downstream of
      // the log reads them.
      report.entityResolution.push({
        mention,
        resolvedTo: top.ref.name,
        certainty: playerCertainty,
        playerId: top.ref.id,
        matchedName: top.matchedName ?? top.ref.name,
      });
      for (const token of justified.length > 0 ? justified : spanTokens) {
        consumedTokens.push(token);
        text = stripMatch(text, token);
      }
    } else {
      unresolvedPlayerMention = candidateRaw;
      // The resolver found SOMETHING, just nothing it would commit to --
      // "ablett" surfaces both Gary Abletts below accept strength. That
      // is an ambiguity, not an unknown word, and the decline message
      // and log should say so rather than "unsupported term: ablett".
      //
      // "Found something" is NOT the same test as "ambiguous", though,
      // and a bare `candidates.length > 0` conflated them: a misspelling
      // that surfaces ONE weak fuzzy match ("smoth" -> John Smith, 410)
      // is an unknown spelling, not a choice between players, and saying
      // it "matches more than one player" is simply false. Apply the same
      // whole-word-prefix equivalence the accepted branch uses for
      // nameMatches above, and require TWO genuine matches -- candidates
      // that do not even plausibly spell the mention are the resolver
      // casting a wide net, not competing readings of the question.
      const lookupTokens = lookupName.split(' ');
      const plausible = candidates.filter((c) => {
        const words = candidateNameWords(c);
        return lookupTokens.every((t) => words.some((w) => w.startsWith(t)));
      });
      if (plausible.length >= 2 && plausible.length <= NL_LIMITS.maxPlayerCandidates) {
        // Rank across every plausible candidate instead of declining --
        // "of everyone this mention could plausibly mean, here is the
        // actual answer" is a complete, correct response to a superlative
        // question even though the SURNAME alone was ambiguous, and it is
        // what the tie machinery every grain already has (rank() with no
        // PARTITION BY, describe.ts's tiedSubject/dedupeByIdentity) is
        // built to do: name the true winner outright, or name a genuine
        // tie between two of them as one, exactly as it already does for
        // an ordinary tied record.
        //
        // A bare surname justifies EVERY plausible candidate's own name
        // by construction -- `plausible` above already required the whole
        // mention to be a prefix-match against each of them -- so unlike
        // the accepted branch's per-name justification, the whole mention
        // span is always the right thing to consume here.
        ambiguousCandidateIds = plausible.map((c) => c.ref.id);
        // Set unconditionally at the top of this else-branch; this path
        // IS a resolution, not a failure to find one, so it must not
        // still carry the unresolved-mention confidence penalty below.
        unresolvedPlayerMention = null;
        const spanTokens = candidateRaw.split(' ');
        const mention = spanTokens.join(' ');
        report.entityResolution.push({
          mention,
          resolvedTo: plausible.map((c) => c.ref.name).join(', '),
          certainty: 1,
          playerIds: plausible.map((c) => c.ref.id),
        });
        for (const token of spanTokens) {
          consumedTokens.push(token);
          text = stripMatch(text, token);
        }
      } else if (plausible.length >= 2) {
        // More plausible candidates than the documented cap -- a generic
        // surname clash rather than a small, real family of same-named
        // footballers, so this stays a decline rather than a 12-way
        // ranking nobody asked for.
        ambiguousPlayerMention = candidateRaw;
      }
    }
  }

  // ---------------------------------------------------------- grain election

  let grain: NlQueryPlan['grain'];
  let metric: string | null = null;
  let mode: 'single' | 'sum' | undefined;
  const clubCareerGamesShorthand = (
    !player
    && !!clubFor
    && playerMetricResult.metric === 'games'
    && aggResult.agg?.kind === 'max'
    && !inOneGame
    && !inOneSeason
    && seasons.seasonMin === undefined
    && seasons.seasonMax === undefined
    && !venue
    && !clubAgainst
    && !matchup
    && !matchTypeResult.matchType
  );

  if (achievementResult.achievementKey && achievementResult.summaryKind) {
    // "which club has had the most players kick a goal with their first
    // kick" -- a group-and-count over the achievement, not a player list.
    // Checked first: the summary cue only exists because the achievement
    // phrase matched, so nothing else can be competing for this question.
    grain = 'achievement_summary';
  } else if (headToHead) {
    grain = 'head_to_head';
  } else if (achievementResult.achievementKey) {
    grain = 'player_career';
  } else if (streakResult.streakDefinition) {
    grain = 'team_streak';
  } else if (havingResult.havingClause || teamMetricResult.metric) {
    grain = 'team_match';
    metric = teamMetricResult.metric ?? null;
  } else if (clubSeasonCuePresent && !player) {
    grain = 'club_season';
    metric = clubSeasonMetricResult.metric ?? null;
  } else if (boundary) {
    grain = 'player_career';
  } else if (awardResult.awardKey) {
    grain = 'player_career';
    metric = 'all_australian_selections';
  } else if (playerMetricResult.metric) {
    // Whether ANY match-level scope was named -- player_career has no
    // opponent/venue/match-type scoping at all, so "career"/"ever"
    // alongside one of these must not route there (it used to: "dusty's
    // career goals against Carlton" silently dropped "against Carlton"
    // and answered his whole career total instead).
    const scoped = !!(venue || clubFor || clubAgainst || matchup || matchTypeResult.matchType);
    if (debutGame || (periodSplitResult.periodSplit && periodSplitResult.periodSplit !== 'FULL_MATCH')) {
      grain = 'player_game';
      mode = 'single';
      metric = playerMetricResult.metric;
    } else if (inOneSeason) {
      grain = 'player_season';
      metric = playerMetricResult.metric;
    } else if (
      (overCareer || clubCareerGamesShorthand)
      && clubFor && !venue && !clubAgainst && !matchup && !matchTypeResult.matchType
      && playerMetricResult.metric === 'games'
    ) {
      // A career games leader FOR one club counts appearances for that
      // organization lineage, not the player's whole-career total and not
      // a fictitious per-game "games" statistic.
      grain = 'player_career';
      metric = 'games';
    } else if (overCareer && !scoped) {
      grain = 'player_career';
      metric = playerMetricResult.metric;
    } else if (player && CAREER_ONLY_METRICS.has(playerMetricResult.metric)) {
      // "Nick Dal Santo most games", "Ablett most premierships" -- see
      // CAREER_ONLY_METRICS. Checked before the general named-player
      // branch below, which would otherwise send these to player_game
      // and metric-validate them straight into a decline.
      grain = 'player_career';
      metric = playerMetricResult.metric;
    } else if (player) {
      // A named player's per-game stat defaults to their single-game
      // peak, not a running total -- "dusty most disposals" asks for his
      // record game. An explicit aggregate cue ("total", "combined"), or
      // "career"/"ever" made scoped by a club/venue/match-type also
      // present, overrides that default toward a scoped running total --
      // "dusty total goals against Carlton" is a sum, not his one best
      // game against them.
      grain = 'player_game';
      mode = (aggregateTotal || overCareer) ? 'sum' : 'single';
      metric = playerMetricResult.metric;
    } else if (
      // No player named, a season WAS named, and the only other scope (if
      // any) is the club whose players are being ranked: that is a
      // season-leaderboard question -- "Richmond's leading goalkicker in
      // 2017", "most goals in 2025" -- and player_season is the grain
      // that says so. Checked BEFORE the scoped-sum branch below, which
      // previously swallowed every club-scoped one of these: a bare
      // clubFor made `scoped` true, so the question became a
      // player_game/sum over a pinned season. That reached the same
      // answer by summing match rows instead of reading season totals,
      // but described a different question, and it was the single
      // largest disagreement in the 12,000-question corpus.
      //
      // An opponent, venue or match-type scope still routes to the sum
      // below -- season aggregates cannot express any of those. So do an
      // explicit total/career cue and an explicit single-game cue, both
      // of which name a different reading outright.
      //
      // A season RANGE reads the same way as a single season, and the
      // attempt to split them is recorded here because it produced the
      // worst answer this engine has shipped. Routing a range to a summed
      // player_game turned "most tackles since 1900" -- whose verified
      // answer is Tom Atkins with 232, a SEASON record -- into "Scott
      // Pendlebury, 2022", his career total across the range, wearing a
      // number that reads exactly like a year. Both hand-verified corpora
      // rejected it, 996 rows between them; the only support for the split
      // came from generated plan expectations, in the same corpus already
      // known to carry 4,536 self-contradicting rows.
      //
      // So: any named season scope is a season leaderboard. A reader who
      // wants the total across a span says so ("total tackles since
      // 1900"), and aggregateTotal already routes that to the sum below.
      !inOneGame && !aggregateTotal && !overCareer
      && !venue && !clubAgainst && !matchup && !matchTypeResult.matchType
      && (seasons.seasonMin !== undefined || seasons.seasonMax !== undefined)
    ) {
      grain = 'player_season';
      metric = playerMetricResult.metric;
    } else if (scoped || inOneGame) {
      // No player named: a scoped or single-game-cued stat question
      // ranks every player's performance in that scope.
      grain = 'player_game';
      mode = inOneGame ? 'single' : 'sum';
      metric = playerMetricResult.metric;
    } else if (seasons.seasonMin !== undefined || seasons.seasonMax !== undefined) {
      // A season with a total/career cue but no other scope ("total
      // goals since 2000") -- the season must not silently drop, and
      // player_season is the only grain that keeps it.
      grain = 'player_season';
      metric = playerMetricResult.metric;
    } else if (['games', 'goals'].includes(playerMetricResult.metric) || careerResult.conditions.length > 0) {
      grain = 'player_career';
      metric = playerMetricResult.metric;
    } else {
      grain = 'player_career';
      metric = playerMetricResult.metric;
    }
  } else {
    // "most games without kicking a goal" -- "games" is the ranked
    // subject, not in METRIC_WORDS (that vocabulary is player_match_stats
    // stats; games is tracked separately). Only read as a metric when it
    // was NOT already claimed by extractCareerConditions as a threshold
    // ("300 games", already stripped from `text` by this point) -- a
    // bare, still-present "games"/"goals" is the leftover subject noun
    // of the superlative itself.
    grain = 'player_career';
    if (/\bgames?\b/.test(text)) {
      metric = 'games';
      consumedTokens.push('games');
    } else if (/\bgoals?\b/.test(text)) {
      metric = 'goals';
      consumedTokens.push('goals');
    }
  }

  if (grain === 'player_game' && mode === undefined) mode = inOneGame ? 'single' : 'sum';

  // --------------------------------------- typed metric-threshold routing
  //
  // AFLDB-ISSUE-110 workstream B. Two producers feed this:
  //
  //  1. extractCareerConditions claimed a goals/games threshold before
  //     grain election could see the explicit scope. When the question's
  //     own wording names a single game or an exact season, that scope
  //     controls the grain -- "players with more than 2 goals in 1989" is
  //     a season question, "players with fewer than 3 goals in a game" a
  //     single-game one -- and the claimed condition becomes the typed
  //     metricCondition of that grain. An explicit career cue keeps the
  //     existing career-condition path ("more than 500 career goals"),
  //     and anything wider than one clean convertible condition is left
  //     exactly as it was.
  //
  //  2. extractPlayerMetricThreshold consumed a comparator on a
  //     player_match_stats metric. If election lands on player_game or
  //     player_season the condition rides the plan as metricCondition; if
  //     it lands on player_career and the metric is a real career column
  //     the condition becomes an ordinary career condition; otherwise it
  //     STAYS on the plan so validatePlan refuses it honestly -- a parsed
  //     threshold must never silently disappear.
  let metricCondition = pendingMetricCondition;
  const soleCareerCondition = careerResult.conditions.length === 1 && careerResult.conditions[0].kind === 'column'
    ? careerResult.conditions[0]
    : null;
  // A retained generic "in a season" cue has no seasonMin/seasonMax field
  // to survive on its own, so it must take ownership before the older
  // game/scoped-total conversions below. A clean sole threshold on an
  // existing player_season metric is fully representable, including a
  // named player/candidate set and compatible clubFor scope. Any competing
  // career meaning or multi-condition shape is not representable as one
  // season metric: retain one parsed threshold as metricCondition on the
  // career plan so validation fails closed rather than accepting a plan
  // that consumed and discarded "in a season".
  if (
    grain === 'player_career' && metric === null && !metricCondition && inOneSeason
    && careerResult.conditions.length > 0
  ) {
    const seasonCondition = careerResult.conditions.find(
      (condition) => condition.kind === 'column' && isNlMetric('player_season', condition.column),
    );
    const fallbackCondition = careerResult.conditions.find((condition) => condition.kind === 'column');
    if (
      soleCareerCondition && !overCareer && careerResult.predicates.length === 0
      && !boundary && !achievementResult.achievementKey && !debutPredicate
      && isNlMetric('player_season', soleCareerCondition.column)
    ) {
      grain = 'player_season';
      metric = soleCareerCondition.column;
      metricCondition = { op: soleCareerCondition.op, value: soleCareerCondition.value };
    } else {
      const refusedCondition = seasonCondition?.kind === 'column' ? seasonCondition : fallbackCondition;
      if (refusedCondition?.kind === 'column') {
        metricCondition = { op: refusedCondition.op, value: refusedCondition.value };
      }
    }
  }
  if (
    grain === 'player_career' && metric === null && !metricCondition
    && !inOneSeason
    && soleCareerCondition && !overCareer && !player && !ambiguousCandidateIds
    && careerResult.predicates.length === 0 && !boundary && !achievementResult.achievementKey
    // A debut window ("debuted in the 1990s with 300 games") OWNS the
    // season range as its predicate parameter; the range must not be
    // re-read as a season-aggregate scope.
    && !debutPredicate
  ) {
    if (inOneGame && isNlMetric('player_game', soleCareerCondition.column)) {
      grain = 'player_game';
      mode = 'single';
      metric = soleCareerCondition.column;
      metricCondition = { op: soleCareerCondition.op, value: soleCareerCondition.value };
    } else if (
      !inOneGame
      && (seasons.seasonMin !== undefined || seasons.seasonMax !== undefined)
      && !venue && !clubAgainst && !matchup && !matchTypeResult.matchType
      && isNlMetric('player_season', soleCareerCondition.column)
    ) {
      grain = 'player_season';
      metric = soleCareerCondition.column;
      metricCondition = { op: soleCareerCondition.op, value: soleCareerCondition.value };
    } else if (
      // Explicit match-level scope beside a claimed career-vocabulary
      // threshold: "players with more than 2 goals against Carlton" is a
      // question about goals AGAINST CARLTON, and the career compiler
      // consumes no opponent/venue/matchup scope at all -- routing it
      // there answered whole-career goals and silently ignored the
      // opponent. The same scoped-total rule the ranked path already
      // follows ("dusty total goals against Carlton" -> player_game/sum)
      // applies: the threshold qualifies the scoped aggregate. A
      // match-type cue never reaches here -- it sets inOneGame, so the
      // single-performance branch above owns it.
      !inOneGame
      && (venue || clubAgainst || matchup)
      && isNlMetric('player_game', soleCareerCondition.column)
    ) {
      grain = 'player_game';
      mode = 'sum';
      metric = soleCareerCondition.column;
      metricCondition = { op: soleCareerCondition.op, value: soleCareerCondition.value };
    }
  }
  if (metricCondition && grain === 'player_career') {
    if (metric !== null && isNlCareerColumn(metric)) {
      careerResult.conditions.push({ kind: 'column', column: metric, op: metricCondition.op, value: metricCondition.value });
      metric = null;
      metricCondition = undefined;
    }
    // else: metricCondition stays on the plan and validatePlan fails it
    // closed -- there is no career column to compile this threshold into.
  }
  // Fail-closed for what could NOT convert: a single-game cue beside
  // career conditions that kept their career reading ("players with no
  // more than 4 goals in a game and no premierships", "players with 300
  // games in a game") has no representable home -- a game-grain condition
  // cannot ride a career plan and a career condition cannot ride a game
  // plan. The consumed "in a game" must not silently disappear, so the
  // cued condition is hoisted onto the plan as a metricCondition, which no
  // career grain can validate, and validatePlan refuses honestly. Runs
  // AFTER the career conversion above so a hoisted condition can never be
  // re-read as a threshold on an unrelated ranked career metric.
  // idiomMetric ("30 disposal games") is its own career idiom, and a
  // boundary/achievement plan owns its match-type words.
  if (
    grain === 'player_career' && inOneGame && !idiomMetric && !metricCondition
    && !boundary && !achievementResult.achievementKey
    && careerResult.conditions.length > 0
  ) {
    // The "in a game" cue governs the condition a game grain could have
    // represented (a real per-match statistic); fall back to any column
    // condition so the refusal cannot be dodged by wording order.
    const gameIndex = careerResult.conditions.findIndex(
      (c) => c.kind === 'column' && isNlMetric('player_game', c.column),
    );
    const hoistIndex = gameIndex >= 0
      ? gameIndex
      : careerResult.conditions.findIndex((c) => c.kind === 'column');
    if (hoistIndex >= 0) {
      const [hoisted] = careerResult.conditions.splice(hoistIndex, 1);
      if (hoisted.kind === 'column') {
        metricCondition = { op: hoisted.op, value: hoisted.value };
      }
    }
  }

  const scope: NlMatchScope = emptyScope();
  if (clubFor) scope.clubFor = { organizationId: clubFor.entity.organizationId, slug: clubFor.entity.slug, name: clubFor.entity.name };
  if (clubAgainst) scope.clubAgainst = { organizationId: clubAgainst.entity.organizationId, slug: clubAgainst.entity.slug, name: clubAgainst.entity.name };
  if (matchup) {
    scope.matchup = {
      clubA: { organizationId: matchup.clubA.entity.organizationId, slug: matchup.clubA.entity.slug, name: matchup.clubA.entity.name },
      clubB: { organizationId: matchup.clubB.entity.organizationId, slug: matchup.clubB.entity.slug, name: matchup.clubB.entity.name },
    };
  }
  if (venue) scope.venue = { id: venue.entity.id, slug: venue.entity.slug, name: venue.entity.name };
  if (seasons.seasonMin !== undefined) scope.seasonMin = seasons.seasonMin;
  if (seasons.seasonMax !== undefined) scope.seasonMax = seasons.seasonMax;
  if (ambiguousCandidateIds) scope.playerIdIn = ambiguousCandidateIds;
  // A boundary question has ALREADY absorbed the match type: extractBoundary
  // reads its target from exactly this value and stores it as
  // boundary.where, so repeating it in scope states the same fact twice in
  // two places that can disagree. "Players whose debut was a grand final"
  // is a career question about which players' FIRST game was a Grand Final,
  // not a question filtered to Grand Finals -- and the compilers, reading a
  // scope match type they were never given for this shape, cannot express
  // it. 3,364 questions in the qualification run.
  if (matchTypeResult.matchType && !boundary) {
    scope.matchType = matchTypeResult.matchType as NlMatchType;
  }
  if (roundResult.roundNumber !== undefined) {
    scope.roundNumber = roundResult.roundNumber;
    // "Round N" is the numbered home-and-away round unless the reader
    // explicitly named another match type.
    scope.matchType ??= 'home_and_away';
  }

  const careerConditions = grain === 'player_career' ? careerResult.conditions : [];

  // A career predicate reuses the grid solver's builder catalogue, which
  // is where every boolean/categorical career question already lives --
  // the compiler, the validator and the answer path all existed; until
  // now nothing in the parser had ever produced one.
  //
  // A club or season filter has to be expressed as a predicate too, not
  // left in scope: answerWithPredicates compiles the predicate list and
  // ignores scope entirely, so "Carlton players who kicked a goal with
  // their first kick" would otherwise silently answer for every club.
  //
  // Both use the achievement's OWN club and season rather than the
  // player's -- "Carlton players who kicked a goal with their first kick"
  // means players who did it FOR Carlton, not players who did it anywhere
  // and later happened to play there, and "in the 1940s" means the feat
  // happened then, which is not always the season they debuted.
  const careerPredicates: GridAxisState[] = grain === 'player_career' ? [...careerResult.predicates] : [];
  if (grain === 'player_career' && achievementResult.achievementKey) {
    if (clubFor) {
      careerPredicates.push({ builder: 'first_kick_goal_for_club', params: { club: String(clubFor.entity.organizationId) } });
    }
    if (seasons.seasonMin !== undefined || seasons.seasonMax !== undefined) {
      careerPredicates.push({
        builder: 'first_kick_goal_between',
        params: {
          from: String(seasons.seasonMin ?? NL_LIMITS.minSeason),
          to: String(seasons.seasonMax ?? NL_LIMITS.maxSeason),
        },
      });
    }
    // The bare achievement predicate is only needed when nothing scoped
    // it: each scoped builder already implies it.
    if (careerPredicates.length === 0) {
      careerPredicates.push({ builder: NL_ACHIEVEMENTS[achievementResult.achievementKey].builder, params: {} });
    }
  }

  // Marquee/rivalry predicates attach only when the plan can honour them:
  // career grain, and no season range named (neither builder has a season
  // parameter, and the predicate answer path ignores scope -- attaching
  // anyway would silently drop "since 2000"). When they cannot attach,
  // their words were stripped from `text` at step 1b but are deliberately
  // NOT counted as consumed here, so they surface as leftover tokens and
  // the question declines instead of answering something narrower.
  if (
    grain === 'player_career' && marqueeResult.predicates.length > 0
    && seasons.seasonMin === undefined && seasons.seasonMax === undefined
  ) {
    careerPredicates.push(...marqueeResult.predicates);
    consumedTokens.push(...marqueeResult.consumed);
  }
  // The debut-window predicate is the opposite case: the season range is
  // its parameter, so it is exactly the plan honouring the seasons.
  if (grain === 'player_career' && debutPredicate) {
    careerPredicates.push(debutPredicate);
    if (debutConsumed) consumedTokens.push(debutConsumed);
  }

  const clubSeasonConditions = grain === 'club_season' ? clubSeasonConditionResult.conditions : [];

  if (grain === 'player_career' && metric === 'all_australian_selections' && negated && isNlAwardKey('all_australian')) {
    // "without" scoped to the award itself would double-count; the
    // negation here governs the OTHER condition in the sentence
    // (typically premierships), which extractCareerConditions already
    // captured as an eq-0 condition. Nothing further to do.
  }

  // Aggregation default: a superlative reading ("most X") when nothing
  // else was said, a plain list when the question named only conditions
  // ("players with 200 games and no premiership", "teams that won the
  // wooden spoon").
  // resolvePolarity runs here, at plan assembly, because it is the first
  // point where BOTH halves of the decision are known: the aggregation
  // was extracted at step 8, the metric only settles at step 11.
  // careerPredicates counts as "the question named only conditions" for
  // this default, the same as careerConditions: without it a predicate-only
  // question ("players who kicked a goal with their first kick") fell
  // through to {kind:'max'}, which has no metric to maximise and is capped
  // at maxTiedRows(25) rather than maxListRows(100) -- a silently truncated
  // list where the reader asked for all of them.
  const resolvedAgg = resolvePolarity(aggResult.agg, metric, aggResult.polarity);
  const structureOnly = careerConditions.length > 0 || careerPredicates.length > 0
    || clubSeasonConditions.length > 0 || !!boundary || !!havingResult.havingClause || !!headToHead;
  // A max/min with NO metric and structure present is not a ranking at
  // all -- there is nothing to rank by, and the answer path already
  // degrades it to a list, only capped at maxTiedRows(25) instead of
  // maxListRows(100). "players WHO PLAYED on anzac day" is the shape:
  // AGG_WORDS reads "who played" as the "who played the most..." idiom,
  // but with no stat named the honest reading is the full list.
  const agg: NlAggregation = headToHead
    ? { kind: 'count' }
    : havingResult.havingClause
    ? { kind: 'list' }
    // A metric threshold answers with the qualifying set. "players with"
    // already reads as list; a generic max cue ("who kicked more than 5
    // goals in a game") coerces to the same list, since ranking one
    // leader is exactly the shape the threshold exists to prevent. A
    // min/top_n alongside a threshold is left alone for validatePlan to
    // refuse honestly.
    : metricCondition && (grain === 'player_game' || grain === 'player_season')
      && (!resolvedAgg || resolvedAgg.kind === 'max' || resolvedAgg.kind === 'list')
    ? { kind: 'list' }
    : resolvedAgg && (resolvedAgg.kind === 'max' || resolvedAgg.kind === 'min')
      && metric === null && structureOnly
    ? { kind: 'list' }
    : resolvedAgg ?? (structureOnly ? { kind: 'list' } : { kind: 'max' });

  const plan: NlQueryPlan = {
    v: 1,
    grain,
    metric,
    ...(grain === 'player_game' ? { mode } : {}),
    agg,
    ...(player ? { player } : {}),
    scope,
    ...(metricCondition ? { metricCondition } : {}),
    careerConditions,
    careerPredicates,
    clubSeasonConditions,
    ...(grain === 'achievement_summary' && achievementResult.achievementKey && achievementResult.summaryKind
      ? { achievementSummary: { achievementKey: achievementResult.achievementKey, kind: achievementResult.summaryKind } }
      : {}),
    ...(headToHead ? { headToHead } : {}),
    ...(streakResult.streakDefinition ? { streakDefinition: streakResult.streakDefinition } : {}),
    ...(periodSplitResult.periodSplit ? { periodSplit: periodSplitResult.periodSplit } : {}),
    ...(scoreCheckpointResult.scoreCheckpoint ? { scoreCheckpoint: scoreCheckpointResult.scoreCheckpoint } : {}),
    ...(resultFilterResult.resultFilter ? { resultFilter: resultFilterResult.resultFilter } : {}),
    ...(debutGame ? { debutGame: true } : {}),
    ...(havingResult.havingClause ? { havingClause: havingResult.havingClause } : {}),
    ...(matchFilterResult.matchFilter ? { matchFilter: matchFilterResult.matchFilter } : {}),
    ...(boundary ? { boundary } : {}),
    tiePolicy: 'all',
    limit: agg.kind === 'top_n' || agg.kind === 'list' ? 100 : 25,
  };

  // ------------------------------------------------------------ confidence

  const allConsumed = [
    ...consumedTokens,
    ...(clubExtraction.consumed), ...(venue ? [venue.matchedText] : []),
  ].join(' ');
  const consumedSet = new Set(meaningfulTokens(allConsumed));
  // careerPredicates is structure in exactly the way careerConditions is:
  // "players who kicked a goal with their first kick" names no metric, no
  // numeric condition and no boundary, and without this clause the plan --
  // correct in every other respect -- was declined as unrecognised.
  // An achievement_summary always carries its own descriptor, which
  // validatePlan requires, so reaching this point is itself the structure.
  const structuralOk = grain === 'head_to_head' ? !!headToHead && !!scope.matchup
    : grain === 'team_match' ? !!metric || !!havingResult.havingClause
    : grain === 'team_streak' ? !!streakResult.streakDefinition
    : grain === 'club_season' ? clubSeasonCuePresent
    : grain === 'achievement_summary' ? true
    : grain === 'player_career' ? (metric !== null || careerConditions.length > 0 || careerPredicates.length > 0 || boundary !== undefined)
    : metric !== null;

  const consumedCount = totalTokens.filter((t) => consumedSet.has(t) || t === candidateRaw?.split(' ')[0]).length;
  // An empty totalTokens means every word in the question was a stopword,
  // digit or operator -- there is no meaningful content left for the
  // parser to have failed on, so the fraction it explained is vacuously
  // complete (1), not zero. "0" was backwards: it read "nothing left to
  // explain" as "explained nothing", which is the opposite of what
  // happened. "players with at least 2 clubs" is exactly this shape --
  // every token is a STOPWORDS entry or a bare digit -- and
  // extractCareerConditions had already built a correct clubs_played
  // condition several steps earlier; the old 0 dragged confidence to 0
  // regardless and declined a plan that was already right.
  //
  // Safe against garbage: a query with real content still needs
  // `structuralOk` below (a real metric/condition/boundary) to pass at
  // all, so ratio 1 on an empty totalTokens can only ever help a
  // question where something upstream had already extracted something
  // real -- it cannot by itself accept "the a is of".
  const ratio = totalTokens.length === 0 ? 1 : consumedCount / totalTokens.length;

  // Meaningful tokens the parser could do nothing with -- excluding the
  // failed player mention's own tokens, which are reported separately
  // below rather than double-counted here. These feed both the
  // clarify-band gate (a leftover word is grounds to decline, not to
  // guess) and unsupportedTerms, so the log's vocabulary mining and the
  // reader's decline message name the exact words that stopped the
  // answer instead of only the failed name lookups.
  const mentionTokens = new Set(unresolvedPlayerMention ? unresolvedPlayerMention.split(' ') : []);
  const leftoverTokens = totalTokens.filter(
    (t) => !consumedSet.has(t) && !mentionTokens.has(t) && t !== candidateRaw?.split(' ')[0],
  );

  const structuralPenalty = structuralOk ? 1 : 0.3;
  const unresolvedPenalty = unresolvedPlayerMention ? 0.35 : 0;
  let confidence = ratio * playerCertainty * structuralPenalty - unresolvedPenalty;
  if (unresolvedPlayerMention) {
    if (ambiguousPlayerMention) {
      report.ambiguousPlayer = ambiguousPlayerMention;
      notes.push(`"${ambiguousPlayerMention}" matches more than one player.`);
    } else {
      report.unsupportedTerms.push(unresolvedPlayerMention);
      notes.push(`Could not find a player matching "${unresolvedPlayerMention}".`);
    }
  }
  report.unsupportedTerms.push(...leftoverTokens.filter((t) => !report.unsupportedTerms.includes(t)));
  if (playerCertainty < 1) notes.push(`"${candidateRaw}" matched more than one player; using the closest.`);
  confidence = Math.max(0, Math.min(1, confidence));

  report.confidence = confidence;
  report.components = { tokenRatio: ratio, playerCertainty, structuralPenalty, unresolvedPenalty };
  report.consumed = [...consumedSet];
  report.notes = notes;
  void PARSER_VERSION;

  if (!structuralOk) {
    return { status: 'none', reason: 'unrecognised', report };
  }

  if (confidence >= NL_CONFIDENCE.execute) {
    return { status: 'plan', plan, report };
  }
  if (confidence >= NL_CONFIDENCE.clarify) {
    // "Execute only if all entities and metrics resolved unambiguously" --
    // any sub-1.0 entity certainty, an unresolved player mention, OR a
    // meaningful word the parser could not consume means the reader must
    // be asked rather than guessed for. The leftover-token condition is
    // what stops "top banana goals" and "dusty banana most goals" from
    // executing: mid-band confidence with words left over is not partial
    // certainty about one question, it is certainty about part of the
    // question -- and answering the understood part as though it were
    // the whole is this engine's worst failure mode. There is no
    // interactive clarification surface yet (conversational refinement
    // is deferred), so this degrades to a decline rather than
    // fabricating an answer; the report still records exactly what was
    // ambiguous, for the search log and for a future clarification UI.
    const allCertain = report.entityResolution.every((e) => e.certainty >= 1)
      && !unresolvedPlayerMention
      && leftoverTokens.length === 0;
    if (allCertain) return { status: 'plan', plan, report };
    const reason: NlDeclineReason = 'ambiguous';
    return { status: 'none', reason, report };
  }
  return { status: 'none', reason: 'low_confidence', report };
}
