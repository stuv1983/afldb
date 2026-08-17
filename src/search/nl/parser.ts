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
  AGAINST_PREPOSITION, AGG_WORDS, AWARD_WORDS,
  BEFORE_RE, BETWEEN_RE, CLUB_SUBJECT_LEADING, COMPARE_OP_WORDS,
  IN_A_FINAL, IN_A_GRAND_FINAL, IN_ONE_GAME, IN_ONE_SEASON,
  MATCH_TYPE_WORDS, METRIC_WORDS, NEGATION_WORDS, NUMBER_PLUS_RE, NUMBER_WORDS, OVER_CAREER,
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
  return { confidence: 0, normalisedQuery, consumed: [], unsupportedTerms: [], notes: [], entityResolution: [] };
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

/**
 * Finds up to two club mentions and assigns each a role by the
 * preposition governing it: "against/versus/vs/v/to" -> the opponent,
 * "for/by/from" or no preposition at all -> the subject side. "richmond
 * biggest loss to carlton" and "biggest win for richmond against
 * carlton" both resolve the same way from this one rule.
 */
function extractClubs(text: string, clubs: readonly NlClubDirectoryEntry[]): ClubExtraction {
  let working = text;
  const consumed: string[] = [];
  let clubFor: NlEntityMatch<NlClubDirectoryEntry> | undefined;
  let clubAgainst: NlEntityMatch<NlClubDirectoryEntry> | undefined;

  for (let i = 0; i < 2; i++) {
    const match = findClub(working, clubs);
    if (!match) break;
    consumed.push(match.matchedText);

    // Look at a short window before the match for a governing preposition.
    const idx = working.toLowerCase().indexOf(match.matchedText);
    const before = idx >= 0 ? working.slice(Math.max(0, idx - 20), idx) : '';
    if (AGAINST_PREPOSITION.test(before)) {
      if (!clubAgainst) clubAgainst = match;
    } else if (!clubFor) {
      clubFor = match;
    } else if (!clubAgainst) {
      clubAgainst = match;
    }
    working = stripMatch(working, match.matchedText);
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

function extractMatchType(text: string): { text: string; matchType?: NlMatchType; consumed: string[] } {
  for (const [re, type] of MATCH_TYPE_WORDS) {
    const match = re.exec(text);
    if (!match) continue;
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (!SCOPE_GOVERNS_MATCH_TYPE.test(before)) continue;
    return { text: stripMatch(text, match[0]), matchType: type as NlMatchType, consumed: [match[0]] };
  }
  return { text, consumed: [] };
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
    let opPhrase: string | null = null;
    let value: number | null = null;
    // The literal text the count came from -- "2" or "two" -- so it can
    // be stripped exactly. Reconstructing a digit-only pattern from the
    // resolved numeric value would never match a number WORD.
    let valueSource: string | null = null;
    if (plus) {
      value = Number(plus[1]);
      op = 'gte';
      valueSource = plus[0].replace(/\+$/, '');
    } else {
      for (const [opRe, opKind] of COMPARE_OP_WORDS) {
        const opMatch = opRe.exec(window);
        if (opMatch) { op = opKind; opPhrase = opMatch[0]; break; }
      }
      const digits = /\b(\d{1,4})\b/.exec(window);
      if (digits) {
        value = Number(digits[1]);
        valueSource = digits[1];
      } else {
        for (const [word, n] of Object.entries(NUMBER_WORDS)) {
          if (new RegExp(`\\b${word}\\b`).test(window)) { value = n; valueSource = word; break; }
        }
      }
    }
    if (value === null) continue;

    conditions.push({ kind: 'column', column, op, value });
    consumed.push(match[0]);
    working = stripMatch(working, match[0]);
    if (valueSource) {
      working = stripMatch(working, valueSource);
      consumed.push(valueSource);
    }
    if (opPhrase) {
      working = stripMatch(working, opPhrase);
      consumed.push(opPhrase);
    }
  }

  return { text: working, conditions, consumed };
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

function extractAggregation(text: string): { text: string; agg?: NlAggregation; consumed: string[] } {
  const topN = TOP_N_RE.exec(text);
  if (topN) {
    const n = /^\d+$/.test(topN[1]) ? Number(topN[1]) : readCount(topN[1]) ?? 10;
    return { text: stripMatch(text, topN[0]), agg: { kind: 'top_n', n }, consumed: [topN[0]] };
  }
  for (const [re, kind] of AGG_WORDS) {
    const match = re.exec(text);
    if (match) {
      const agg: NlAggregation = kind === 'top_n' ? { kind: 'top_n', n: 1 } : { kind };
      return { text: stripMatch(text, match[0]), agg, consumed: [match[0]] };
    }
  }
  return { text, consumed: [] };
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

  const matchTypeResult = extractMatchType(text);
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
  text = text.replace(IN_ONE_GAME, ' ').replace(IN_A_FINAL, ' ').replace(IN_A_GRAND_FINAL, ' ')
    .replace(IN_ONE_SEASON, ' ').replace(OVER_CAREER, ' ');

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

  // 11. Player stat metric (only tried once team-metric words have had
  // first refusal, and only consumed from `text` if a team metric did
  // NOT already fire, so "goals" in "biggest win" scope never
  // double-reads as a player stat too).
  let playerMetricResult: { text: string; metric?: string; consumed: string[] };
  if (teamMetricResult.metric) {
    text = teamMetricResult.text;
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
  } else if (clubSubjectPresent && !player) {
    grain = 'club_season';
    metric = careerResult.conditions.length > 0 ? null : (playerMetricResult.metric ?? null);
  } else if (boundary) {
    grain = 'player_career';
  } else if (awardResult.awardKey) {
    grain = 'player_career';
    metric = 'all_australian_selections';
  } else if (playerMetricResult.metric) {
    if (inOneSeason) {
      grain = 'player_season';
      metric = playerMetricResult.metric;
    } else if (overCareer) {
      grain = 'player_career';
      metric = playerMetricResult.metric;
    } else if (player) {
      // A named player's per-game stat defaults to their single-game
      // peak, not a career running total -- "dusty most disposals" asks
      // for his record game, the natural reading of "most" applied to
      // one person's individual performances.
      grain = 'player_game';
      mode = 'single';
      metric = playerMetricResult.metric;
    } else if (venue || clubFor || clubAgainst || matchTypeResult.matchType || inOneGame) {
      // No player named: a scoped or single-game-cued stat question
      // ranks every player's performance in that scope.
      grain = 'player_game';
      mode = inOneGame ? 'single' : 'sum';
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

  if (grain === 'player_career' && metric === 'all_australian_selections' && negated && isNlAwardKey('all_australian')) {
    // "without" scoped to the award itself would double-count; the
    // negation here governs the OTHER condition in the sentence
    // (typically premierships), which extractCareerConditions already
    // captured as an eq-0 condition. Nothing further to do.
  }

  // Aggregation default: a superlative reading ("most X") when nothing
  // else was said, a plain list when the question named only conditions
  // ("players with 200 games and no premiership").
  const agg: NlAggregation = aggResult.agg ?? (careerConditions.length > 0 || boundary
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
    : grain === 'club_season' ? clubSubjectPresent || !!clubFor
    : grain === 'player_career' ? (metric !== null || careerConditions.length > 0 || boundary !== undefined)
    : metric !== null;

  const consumedCount = totalTokens.filter((t) => consumedSet.has(t) || t === candidateRaw?.split(' ')[0]).length;
  const ratio = totalTokens.length === 0 ? 0 : consumedCount / totalTokens.length;

  let confidence = ratio * playerCertainty;
  if (!structuralOk) confidence *= 0.3;
  if (unresolvedPlayerMention) {
    confidence -= 0.35;
    report.unsupportedTerms.push(unresolvedPlayerMention);
    notes.push(`Could not find a player matching "${unresolvedPlayerMention}".`);
  }
  if (playerCertainty < 1) notes.push(`"${candidateRaw}" matched more than one player; using the closest.`);
  confidence = Math.max(0, Math.min(1, confidence));

  report.confidence = confidence;
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
