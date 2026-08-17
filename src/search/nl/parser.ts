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
  NL_CONFIDENCE,
  PARSER_VERSION,
  type NlAggregation,
  type NlBoundary,
  type NlCareerColumn,
  type NlCareerCondition,
  type NlClubSeasonCondition,
  type NlCompareOp,
  type NlDeclineReason,
  type NlMatchScope,
  type NlMatchType,
  type NlParse,
  type NlParseReport,
  type NlPlayerRef,
  type NlQueryPlan,
} from '@/search/nl/plan';
import type { GridAxisState } from '@/search/grid-solver-spec';
import {
  findClub, findVenue, stripMatch,
  type NlClubDirectoryEntry, type NlEntityMatch, type NlVenueDirectoryEntry,
} from '@/search/nl/entities';
import {
  AGAINST_PREPOSITION, AGG_WORDS, AGGREGATE_TOTAL_WORDS, AWARD_WORDS,
  BARE_YEAR_RE, BEFORE_RE, BETWEEN_RE, CLUB_SEASON_CONDITION_WORDS, CLUB_SEASON_METRIC_WORDS,
  CLUB_SUBJECT_LEADING, COMPARE_OP_WORDS,
  IN_A_FINAL, IN_A_GRAND_FINAL, IN_ONE_GAME, IN_ONE_SEASON,
  MATCH_TYPE_WORDS, METRIC_HIGHER_IS_WORSE, METRIC_WORDS, NEGATION_WORDS, NUMBER_PLUS_RE,
  NUMBER_WORDS, OVER_CAREER, POLARITY_AGG_RE,
  PLAYER_NICKNAMES, SINCE_RE, STAT_GAMES_IDIOM_WORDS, STOPWORDS, TEAM_METRIC_WORDS, TOP_N_RE,
  UNANSWERABLE_TOPICS, canonicalise, readCount,
} from '@/search/nl/vocab';

export type NlPlayerCandidate = { ref: NlPlayerRef; score: number };

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
  consumed: string[];
};

/** Where a matched phrase sits in the original question, word-boundary anchored so "melbourne" does not report the position of "north melbourne". */
function phrasePosition(text: string, phrase: string): number {
  const at = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(text);
  return at ? at.index : Number.MAX_SAFE_INTEGER;
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
  const found: { match: NlEntityMatch<NlClubDirectoryEntry>; governedAgainst: boolean; at: number }[] = [];

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
    });
    working = stripMatch(working, match.matchedText);
  }

  let clubFor: NlEntityMatch<NlClubDirectoryEntry> | undefined;
  let clubAgainst: NlEntityMatch<NlClubDirectoryEntry> | undefined;

  for (const entry of found.filter((f) => f.governedAgainst)) {
    if (!clubAgainst) clubAgainst = entry.match;
  }
  for (const entry of found.filter((f) => !f.governedAgainst).sort((a, b) => a.at - b.at)) {
    if (!clubFor) clubFor = entry.match;
    else if (!clubAgainst) clubAgainst = entry.match;
  }

  return { text: working, clubFor, clubAgainst, consumed };
}

// ------------------------------------------------------------------ seasons

type SeasonExtraction = { text: string; seasonMin?: number; seasonMax?: number; consumed: string[] };

function extractSeasons(text: string): SeasonExtraction {
  const consumed: string[] = [];
  let working = text;

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
const SCOPE_GOVERNS_MATCH_TYPE = /\b(?:in|during|was|is|were)\s+(?:an?|any|the)?\s*$/;

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
    if (!allowBare && !SCOPE_GOVERNS_MATCH_TYPE.test(before)) continue;
    return { text: stripMatch(text, match[0]), matchType: type as NlMatchType, consumed: [match[0]] };
  }
  return { text, consumed: [] };
}

/** Does a team-scoring word appear anywhere? Peeked WITHOUT consuming -- extractTeamMetric still does the real extraction later, against the by-then-stripped text. */
function hasTeamMetricWord(text: string): boolean {
  return TEAM_METRIC_WORDS.some(([re]) => re.test(text));
}

// ----------------------------------------------------------------- awards

function extractAward(text: string): { text: string; awardKey?: 'all_australian'; consumed: string[] } {
  for (const [re, key] of AWARD_WORDS) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), awardKey: key, consumed: [match[0]] };
  }
  return { text, consumed: [] };
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
  [/\bdraws?\b/, 'draws'],
  [/\bbrownlow medals?\b/, 'brownlow_medals'],
  [/\bbrownlow votes?\b/, 'brownlow_votes'],
];

function extractCareerConditions(text: string): { text: string; conditions: NlCareerCondition[]; consumed: string[] } {
  const conditions: NlCareerCondition[] = [];
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
  for (const [re, column] of negativeTargets) {
    const negRe = new RegExp(`\\b(?:no|never|without)\\b[^.]{0,20}?${re.source}`);
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
    const windowStart = Math.max(0, idx - 20);
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

    conditions.push({ kind: 'column', column, op, value });
    for (const span of spans) consumed.push(span.text);
    // Highest offset first, so removing one span cannot shift the
    // positions of the ones still to be removed.
    working = spans
      .sort((a, b) => b.start - a.start)
      .reduce((text, span) => `${text.slice(0, span.start)} ${text.slice(span.end)}`, working)
      .replace(/\s+/g, ' ')
      .trim();
  }

  return { text: working, conditions, consumed };
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
    const n = /^\d+$/.test(topN[1]) ? Number(topN[1]) : readCount(topN[1]) ?? 10;
    return { text: stripMatch(text, topN[0]), agg: { kind: 'top_n', n }, consumed: [topN[0]], polarity: false };
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

function extractPlayerMetric(text: string): { text: string; metric?: string; consumed: string[] } {
  for (const [re, metric] of METRIC_WORDS) {
    const match = re.exec(text);
    if (match) return { text: stripMatch(text, match[0]), metric, consumed: [match[0]] };
  }
  return { text, consumed: [] };
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

// -------------------------------------------------------------- main entry

export async function parseNlQuestion(query: string, ctx: NlParseContext): Promise<NlParse> {
  const normalised = canonicalise(query);
  const report = emptyReport(normalised);
  let text = normalised;

  const totalTokens = meaningfulTokens(normalised);
  const consumedTokens: string[] = [];
  const notes: string[] = [];

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

  // 2. "by a <club> player" -- must run before general club extraction,
  // since it also contains a club name that would otherwise be treated
  // as an ordinary clubFor/clubAgainst mention with no special meaning.
  const byClubPlayer = extractByClubPlayer(text, ctx.clubs);
  text = byClubPlayer.text;
  consumedTokens.push(...byClubPlayer.consumed);

  // 3. Club extraction (roles resolved by governing preposition).
  const clubExtraction = extractClubs(text, ctx.clubs);
  text = clubExtraction.text;
  consumedTokens.push(...clubExtraction.consumed);
  const clubFor = byClubPlayer.clubFor ?? clubExtraction.clubFor;
  const clubAgainst = clubExtraction.clubAgainst;
  if (clubFor) report.entityResolution.push({ mention: clubFor.matchedText, resolvedTo: clubFor.entity.name, certainty: 1 });
  if (clubAgainst) report.entityResolution.push({ mention: clubAgainst.matchedText, resolvedTo: clubAgainst.entity.name, certainty: 1 });

  // 4. Venue extraction.
  const venueMatch = findVenue(text, ctx.venues);
  let venue: NlEntityMatch<NlVenueDirectoryEntry> | undefined;
  if (venueMatch) {
    venue = venueMatch;
    text = stripMatch(text, venueMatch.matchedText);
    consumedTokens.push(venueMatch.matchedText);
    report.entityResolution.push({ mention: venueMatch.matchedText, resolvedTo: venueMatch.entity.name, certainty: 1 });
  }

  // 5. Seasons, match type, award.
  const seasons = extractSeasons(text);
  text = seasons.text;
  consumedTokens.push(...seasons.consumed);

  // A team-scoring word anywhere in the question means a bare "grand
  // final"/"finals" can only be scope, never the player_career metric --
  // see extractMatchType. Peeked before extraction so the decision is made
  // on the whole question rather than on whatever is left by this point.
  const matchTypeResult = extractMatchType(text, hasTeamMetricWord(text));
  text = matchTypeResult.text;
  consumedTokens.push(...matchTypeResult.consumed);

  const awardResult = extractAward(text);
  text = awardResult.text;
  consumedTokens.push(...awardResult.consumed);

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
  const inOneGame = !!idiomMetric || IN_ONE_GAME.test(text) || !!matchTypeResult.matchType;
  const inOneSeason = IN_ONE_SEASON.test(text);
  const overCareer = OVER_CAREER.test(text);
  // "dusty TOTAL goals against Carlton" -- overrides the named-player
  // single-game default toward a scoped running total. Tracked separately
  // from overCareer: pushed to consumedTokens (below) so the cue never
  // silently costs confidence the way OVER_CAREER's own words already do.
  const aggregateTotalMatch = AGGREGATE_TOTAL_WORDS.exec(text);
  const aggregateTotal = !!aggregateTotalMatch;
  if (aggregateTotalMatch) consumedTokens.push(aggregateTotalMatch[0]);
  text = text.replace(IN_ONE_GAME, ' ').replace(IN_A_FINAL, ' ').replace(IN_A_GRAND_FINAL, ' ')
    .replace(IN_ONE_SEASON, ' ').replace(OVER_CAREER, ' ').replace(AGGREGATE_TOTAL_WORDS, ' ');

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

  // 9. Team metric (checked before player metric: "richmond's biggest
  // win" must never be read as a player-stat question).
  const teamMetricResult = extractTeamMetric(text);
  const clubSubjectPresent = CLUB_SUBJECT_LEADING.test(text.trim());

  // 10. Career conditions (numeric thresholds/negatives on career columns).
  const careerResult = extractCareerConditions(text);
  text = careerResult.text;
  consumedTokens.push(...careerResult.consumed);

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
  // against carlton"), so only an unambiguous club-season signal --
  // a leading "teams"/"clubs" subject, or one of the boolean conditions
  // above -- elects this grain.
  const clubSeasonCuePresent = clubSubjectPresent || clubSeasonConditionResult.conditions.length > 0;

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
    playerMetricResult = extractPlayerMetric(text);
    text = playerMetricResult.text;
    consumedTokens.push(...playerMetricResult.consumed);

    // "most games without kicking a goal", "most finals played without a
    // premiership" -- games/finals are ranked career subjects, not in
    // METRIC_WORDS (that vocabulary is player_match_stats-grain stats).
    // Only read as a metric when NOT already claimed by
    // extractCareerConditions as a threshold ("300 games", already
    // stripped from `text` by this point) -- a bare, still-present word
    // is the leftover subject noun of the superlative itself. Must run
    // here, before the player-mention scan, or the word is misread as an
    // unresolved player name.
    if (!playerMetricResult.metric && !teamMetricResult.metric) {
      const bareMetricWords: [RegExp, 'games' | 'goals' | 'finals'][] = [
        [/\bgames?\b/, 'games'], [/\bgoals?\b/, 'goals'], [/\bfinals?\b/, 'finals'],
      ];
      for (const [re, key] of bareMetricWords) {
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
  if (candidateRaw && candidateRaw.length >= 3) {
    const nickname = PLAYER_NICKNAMES[candidateRaw] ?? PLAYER_NICKNAMES[candidateRaw.split(' ')[0]];
    const lookupName = nickname ?? candidateRaw;
    const candidates = await ctx.resolvePlayer(lookupName);
    const top = candidates[0];
    if (top && top.score >= PLAYER_ACCEPT_SCORE) {
      player = top.ref;
      const second = candidates[1];
      playerCertainty = !second || top.score - second.score > 200 ? 1 : 0.7;
      report.entityResolution.push({ mention: candidateRaw, resolvedTo: top.ref.name, certainty: playerCertainty });
      consumedTokens.push(candidateRaw);
      text = stripMatch(text, candidateRaw);
    } else {
      unresolvedPlayerMention = candidateRaw;
    }
  }

  // ---------------------------------------------------------- grain election

  let grain: NlQueryPlan['grain'];
  let metric: string | null = null;
  let mode: 'single' | 'sum' | undefined;

  if (teamMetricResult.metric) {
    grain = 'team_match';
    metric = teamMetricResult.metric;
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
    const scoped = !!(venue || clubFor || clubAgainst || matchTypeResult.matchType);
    if (inOneSeason) {
      grain = 'player_season';
      metric = playerMetricResult.metric;
    } else if (overCareer && !scoped) {
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
    } else if (scoped || inOneGame) {
      // No player named: a scoped or single-game-cued stat question
      // ranks every player's performance in that scope.
      grain = 'player_game';
      mode = inOneGame ? 'single' : 'sum';
      metric = playerMetricResult.metric;
    } else if (seasons.seasonMin !== undefined || seasons.seasonMax !== undefined) {
      // No player, venue, club or match-type cue, but a season WAS named
      // ("most goals in 2025") -- ranks player_season_stats within that
      // range. Without this branch the year fell through to the plain
      // career-total default below with the season silently dropped.
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

  const scope: NlMatchScope = emptyScope();
  if (clubFor) scope.clubFor = { organizationId: clubFor.entity.organizationId, slug: clubFor.entity.slug, name: clubFor.entity.name };
  if (clubAgainst) scope.clubAgainst = { organizationId: clubAgainst.entity.organizationId, slug: clubAgainst.entity.slug, name: clubAgainst.entity.name };
  if (venue) scope.venue = { id: venue.entity.id, slug: venue.entity.slug, name: venue.entity.name };
  if (seasons.seasonMin !== undefined) scope.seasonMin = seasons.seasonMin;
  if (seasons.seasonMax !== undefined) scope.seasonMax = seasons.seasonMax;
  if (matchTypeResult.matchType) scope.matchType = matchTypeResult.matchType as NlMatchType;

  const careerConditions = grain === 'player_career' ? careerResult.conditions : [];
  const careerPredicates: GridAxisState[] = [];
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
  const agg: NlAggregation = resolvePolarity(aggResult.agg, metric, aggResult.polarity)
    ?? (careerConditions.length > 0 || clubSeasonConditions.length > 0 || boundary
      ? { kind: 'list' }
      : { kind: 'max' });

  const plan: NlQueryPlan = {
    v: 1,
    grain,
    metric,
    ...(grain === 'player_game' ? { mode } : {}),
    agg,
    ...(player ? { player } : {}),
    scope,
    careerConditions,
    careerPredicates,
    clubSeasonConditions,
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
  const structuralOk = grain === 'team_match' ? !!metric
    : grain === 'club_season' ? clubSeasonCuePresent
    : grain === 'player_career' ? (metric !== null || careerConditions.length > 0 || boundary !== undefined)
    : metric !== null;

  const consumedCount = totalTokens.filter((t) => consumedSet.has(t) || t === candidateRaw?.split(' ')[0]).length;
  const ratio = totalTokens.length === 0 ? 0 : consumedCount / totalTokens.length;

  const structuralPenalty = structuralOk ? 1 : 0.3;
  const unresolvedPenalty = unresolvedPlayerMention ? 0.35 : 0;
  let confidence = ratio * playerCertainty * structuralPenalty - unresolvedPenalty;
  if (unresolvedPlayerMention) {
    report.unsupportedTerms.push(unresolvedPlayerMention);
    notes.push(`Could not find a player matching "${unresolvedPlayerMention}".`);
  }
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
    // any sub-1.0 entity certainty, or an unresolved player mention,
    // means the reader must be asked rather than guessed for. There is
    // no interactive clarification surface yet (conversational
    // refinement is deferred), so this degrades to a decline rather than
    // fabricating an answer; the report still records exactly what was
    // ambiguous, for the search log and for a future clarification UI.
    const allCertain = report.entityResolution.every((e) => e.certainty >= 1) && !unresolvedPlayerMention;
    if (allCertain) return { status: 'plan', plan, report };
    const reason: NlDeclineReason = 'ambiguous';
    return { status: 'none', reason, report };
  }
  return { status: 'none', reason: 'low_confidence', report };
}
