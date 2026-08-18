/**
 * Query-intent recognition for the global search box.
 *
 * Free text like "brownlow winner richmond" or "most goals essendon" names
 * a specific filtered view, not a single entity — no player, club or venue
 * row is "the answer." This module recognises a small, growing set of such
 * phrasings and turns them into a direct link with the right table, filter
 * and section already applied.
 *
 * It does not re-rank entities itself: `resolveIntent` takes the caller's
 * own best-ranked record/award hit (from `searchRecords`/`searchAwards`,
 * run against the query with any club/year already stripped — see
 * `globalSearch` in `db/queries/search.ts`) rather than duplicating that
 * ranking logic here.
 *
 * Kept free of server-only imports, like `match-spec.ts` and
 * `advanced-spec.ts`, so it stays unit-testable without a database
 * connection.
 */

import {
  GRID_STATS,
  serializeBoardState,
  type GridAxisState,
  type GridBoardState,
  type GridStatKey,
} from '@/search/grid-solver-spec';

export type IntentClub = { slug: string; name: string };

export type IntentCandidate = { slug: string; title: string; score: number };

export type IntentMatch = {
  href: string;
  label: string;
  detail: string;
};

export type QuerySignals = {
  /** The query with any matched club name and year removed. */
  topicWords: string;
  club: IntentClub | null;
  year: number | null;
};

/** A record/award hit is trusted for intent purposes at prefix strength or better. */
const CONFIDENCE_THRESHOLD = 500;

const SEASON_MIN = 1897;
const SEASON_MAX = 2100;
const YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findYear(text: string): { year: number; matched: string } | null {
  const match = YEAR_RE.exec(text);
  if (!match) return null;
  const year = Number(match[0]);
  if (year < SEASON_MIN || year > SEASON_MAX) return null;
  return { year, matched: match[0] };
}

/**
 * The longest club name that appears as a whole word/phrase in the query.
 *
 * Longest match wins so a club whose name is a substring of another's
 * (unlikely today, but not guaranteed by the data) can't shadow the more
 * specific one.
 */
function findClub(
  text: string,
  clubs: readonly IntentClub[],
): { club: IntentClub; matched: string } | null {
  let best: { club: IntentClub; matched: string } | null = null;
  for (const club of clubs) {
    const name = club.name.toLowerCase();
    if (best && name.length <= best.matched.length) continue;
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    if (re.test(text)) best = { club, matched: name };
  }
  return best;
}

function stripMatches(text: string, matched: readonly (string | undefined)[]): string {
  let result = text;
  for (const m of matched) {
    if (!m) continue;
    result = result.replace(new RegExp(`\\b${escapeRegExp(m)}\\b`), ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** Detect the club and year a query names, and what's left once they're removed. */
export function extractQuerySignals(
  query: string,
  clubs: readonly IntentClub[],
): QuerySignals {
  const lower = query.trim().toLowerCase();
  const yearMatch = findYear(lower);
  const clubMatch = findClub(lower, clubs);
  const topicWords = stripMatches(lower, [yearMatch?.matched, clubMatch?.matched]);
  return {
    topicWords,
    club: clubMatch?.club ?? null,
    year: yearMatch?.year ?? null,
  };
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildHref(
  path: string,
  params: Record<string, string | undefined>,
  hash?: string,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`;
}

// ------------------------------------------------------- player questions
// Free text like "drawn twice or more in one season" or "10 goals in a
// game" describes a QUESTION about players, not an entity. These parse a
// small vocabulary of such phrasings into a grid-solver builder and link
// to /grid-solver with that question prefilled in one cell. Everything
// stays in-process and DB-free: the builders themselves validate and
// solve, this only names one.

// Exported for src/search/nl/vocab.ts, which extends this vocabulary
// rather than duplicating it -- the "twice"/"multiple" reading of a count
// must stay one definition shared by both parsers.
export const NUMBER_WORDS: Record<string, number> = {
  once: 1, twice: 2, thrice: 3,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  // "multiple draws" / "several draws" — vaguer than a numeral, but the
  // question they name is unambiguous: more than one.
  multiple: 2, several: 2,
};

const IN_ONE_SEASON = /\bin (?:a|one|any|(?:a )?single|the same) season\b/;
const IN_ONE_GAME = /\bin (?:a|one|any|(?:a )?single|the same) (?:game|match)\b/;

/**
 * Stat vocabulary, checked in order. Multi-word stats come before any
 * single word they contain ("goal assists" before "goals"), and the
 * numeric-named stats are canonicalised first (see canonicalise) so
 * "inside 50s" can never be read as the number 50.
 */
const STAT_WORDS: [RegExp, GridStatKey][] = [
  [/\bgoal assists?\b/, 'goal_assists'],
  [/\bcontested marks?\b/, 'contested_marks'],
  [/\binside-fifties\b/, 'inside_50s'],
  [/\brebound-fifties\b/, 'rebounds'],
  [/\bgoals?\b/, 'goals'],
  [/\bbehinds?\b/, 'behinds'],
  [/\bkicks?\b/, 'kicks'],
  [/\bhandballs?\b/, 'handballs'],
  [/\bdisposals?\b/, 'disposals'],
  [/\bpossessions?\b/, 'disposals'],
  [/\bmarks?\b/, 'marks'],
  [/\btackles?\b/, 'tackles'],
  [/\bhit ?outs?\b/, 'hitouts'],
  [/\bclearances?\b/, 'clearances'],
  [/\bclangers?\b/, 'clangers'],
  [/\bbounces?\b/, 'bounces'],
];

// Exported for src/search/nl/vocab.ts -- the "inside 50s must never read
// as the number 50" protection has to run before either parser reads a count.
export function canonicalise(text: string): string {
  return text
    .replace(/\binside (?:fifty|50)s?\b/g, 'inside-fifties')
    .replace(/\brebound (?:fifty|50)s?\b/g, 'rebound-fifties');
}

/** The first number in the text, as digits ("300", "2+") or as a word ("twice"). */
function readCount(text: string): number | null {
  const digits = /\b(\d{1,4})\b/.exec(text);
  if (digits) return Number(digits[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return null;
}

/** Words that make a question about clubs rather than players. */
const CLUB_SUBJECT = /\b(?:teams?|clubs?|sides?)\b/;

/**
 * A club question, as a fixed kind plus a threshold.
 *
 * Unlike the player side, this does NOT go through the grid solver: that
 * catalogue is entirely player-grained, and the answer to "teams to draw
 * twice in one season" is a club-SEASON (Collingwood, 2011), not a club.
 * The kinds are a closed set the answering layer switches on, so nothing
 * a reader types ever reaches SQL as an identifier.
 */
export type ClubQuestionKind =
  | 'season_draws_min'
  | 'season_wins_min'
  | 'season_losses_min'
  | 'wooden_spoon'
  | 'premiers'
  | 'minor_premiers'
  | 'winless'
  | 'undefeated';

export type ClubQuestion = {
  kind: ClubQuestionKind;
  /** Threshold for the `_min` kinds; ignored by the others. */
  n: number;
  label: string;
};

/**
 * Parse a club question ("teams to draw twice in one season"), or null.
 *
 * Requires an explicit club subject — "teams", "clubs", "sides" — which is
 * what separates this from the player questions below: "drawn twice or
 * more" asks about players, "teams to draw twice" asks about clubs, and
 * the only difference in the text is that word.
 */
export function parseClubQuestion(raw: string): ClubQuestion | null {
  const text = canonicalise(raw);
  if (!CLUB_SUBJECT.test(text)) return null;

  const countText = text.replace(IN_ONE_SEASON, ' ').replace(IN_ONE_GAME, ' ');
  const n = readCount(countText);

  // Most specific first, as on the player side: "minor premiership" has
  // to be read before the "premiership" inside it, and both before the
  // bare "won" that a wins question would otherwise claim.
  if (/\bwooden spoons?\b/.test(text)) {
    return { kind: 'wooden_spoon', n: 0, label: 'a wooden spoon' };
  }
  if (/\bminor premier/.test(text) || /\bfinished (?:first|top)\b/.test(text)
    || /\btop of the ladder\b/.test(text) || /\bladder leaders?\b/.test(text)) {
    return { kind: 'minor_premiers', n: 0, label: 'a minor premiership (finished first)' };
  }
  if (/\bpremiers?\b|\bpremierships?\b|\bflags?\b/.test(text)) {
    return { kind: 'premiers', n: 0, label: 'a premiership' };
  }
  if (/\bundefeated\b|\bunbeaten\b|\bperfect seasons?\b/.test(text)) {
    return { kind: 'undefeated', n: 0, label: 'an undefeated season' };
  }
  if (/\bwinless\b|\bno wins\b|\bwithout a win\b/.test(text)) {
    return { kind: 'winless', n: 0, label: 'a winless season' };
  }

  if (/\bdraws?\b|\bdrawn\b|\bdrew\b/.test(text)) {
    const times = n ?? 1;
    return { kind: 'season_draws_min', n: times, label: `${times}+ draws in a season` };
  }
  if (n !== null && /\bwins?\b|\bwon\b|\bwinning\b/.test(text)) {
    return { kind: 'season_wins_min', n, label: `${n}+ wins in a season` };
  }
  if (n !== null && /\bloss(?:es)?\b|\blost\b|\blosing\b/.test(text)) {
    return { kind: 'season_losses_min', n, label: `${n}+ losses in a season` };
  }

  return null;
}

export type PlayerQuestion = { axis: GridAxisState; label: string };

function question(builder: string, params: Record<string, string>, label: string): PlayerQuestion {
  return { axis: { builder, params }, label };
}

/**
 * Parse one player question out of free text, or null when nothing in the
 * vocabulary matches.
 *
 * Ordered most-specific first, because the same verb serves several
 * questions: "won" appears in "won 3 premierships", "won 5 finals" and
 * "won 20 games in a season", which are three different builders, so the
 * narrower reading has to be tried before the broader one.
 *
 * The season phrase is OPTIONAL for the outcome questions (draws, wins,
 * losses). The catalogue only offers those at season grain, so "drawn
 * twice or more" and "two draws in a season" are the same question, and
 * demanding the literal "in one season" only made the feature look
 * broken for the shorter phrasing people actually type.
 */
export function parsePlayerQuestion(raw: string): PlayerQuestion | null {
  const text = canonicalise(raw);
  // "teams to draw twice in one season" is a club question and is
  // answered as one; declining it here rather than relying on the caller
  // trying parseClubQuestion first keeps each parser correct alone.
  if (CLUB_SUBJECT.test(text)) return null;
  // The season/game phrase is removed before reading the count so the
  // "one" in "in one season" can never be taken as the number.
  const countText = text.replace(IN_ONE_SEASON, ' ').replace(IN_ONE_GAME, ' ');
  const n = readCount(countText);

  const won = /\bwins?\b|\bwon\b|\bwinning\b/.test(text);
  const lost = /\bloss(?:es)?\b|\blost\b|\blosing\b/.test(text);
  const anyFinal = /\bfinals?\b/.test(text);
  const grandFinal = /\bgrand finals?\b|\bgrand-finals?\b/.test(text);
  const prelimFinal = /\bpreliminary finals?\b|\bprelim finals?\b|\bpreliminary-finals?\b/.test(text);

  // Premierships/flags, and "won a grand final", which means the same
  // thing. Ahead of the generic win handling below, which would
  // otherwise read the "won" and answer a season-wins question.
  if (/\bpremierships?\b|\bflags?\b/.test(text) || (grandFinal && won)) {
    const times = n ?? 1;
    return question('premierships_min', { times: String(times) }, `${times}+ premierships`);
  }
  if (grandFinal && lost) {
    const times = n ?? 1;
    return question('grand_finals_lost_min', { times: String(times) }, `${times}+ Grand Finals lost`);
  }
  if (grandFinal) {
    const times = n ?? 1;
    return question('grand_finals_played_min', { times: String(times) }, `${times}+ Grand Finals played`);
  }

  // Preliminary finals, ahead of the generic "finals" reading below for
  // the same reason grand finals are: "preliminary final" contains the
  // word "final", so the narrower question has to be tried first or it
  // is silently answered as a generic finals-games count instead.
  if (prelimFinal) {
    const times = n ?? 1;
    return question('prelim_finals_played_min', { times: String(times) }, `${times}+ Preliminary Finals played`);
  }

  // Finals, likewise ahead of the generic season-outcome handling.
  if (anyFinal && won) {
    const times = n ?? 1;
    return question('finals_wins_min', { x: String(times) }, `${times}+ finals wins`);
  }
  if (anyFinal && n !== null) {
    return question('finals_games_min', { games: String(n) }, `${n}+ finals games`);
  }

  // Season outcomes. Draws default to 1 when no count is given ("drew a
  // game"); wins and losses require an explicit count, since a bare
  // "won a final" is a finals question and is caught above, and a bare
  // "winners" is more likely an award query than a season-wins one.
  //
  // Draws split on grain: the catalogue's only long-standing draws
  // question is season-scoped ("X+ draws in one season"), which is what a
  // bare "drawn twice" or "two draws" has always meant here. But "played
  // in at least 1 drawn match" names a game, not a season, so once the
  // text says "match"/"game" without also saying "season" it means the
  // career-wide count instead -- these disagree for X > 1 (two draws
  // spread across two seasons is 2 career draws but 0 for either season's
  // X=2 count), so which one is meant is not just a wording preference.
  if (/\bdraws?\b|\bdrawn\b|\bdrew\b/.test(text)) {
    const times = n ?? 1;
    const namesAMatch = /\bmatch(?:es)?\b|\bgames?\b/.test(text);
    const namesASeason = /\bseasons?\b/.test(text);
    if (namesAMatch && !namesASeason) {
      return question('drawn_matches_min', { times: String(times) }, `${times}+ drawn matches`);
    }
    return question('season_draws_min', { times: String(times) }, `${times}+ draws in one season`);
  }
  if (n !== null && won) {
    return question('season_wins_min', { times: String(n) }, `${n}+ wins in one season`);
  }
  if (n !== null && lost) {
    return question('season_losses_min', { times: String(n) }, `${n}+ losses in one season`);
  }

  // Tested against countText, where the "in a game/season" phrases are
  // already blanked out — the "game" of "10 goals in a game" is part of
  // that phrase, not a games count.
  if (n !== null && /\bgames?\b/.test(countText)) {
    if (IN_ONE_SEASON.test(text)) {
      return question('games_in_season_min', { games: String(n) }, `${n}+ games in one season`);
    }
    return question('career_games_min', { games: String(n) }, `${n}+ career games`);
  }

  if (n !== null) {
    for (const [re, key] of STAT_WORDS) {
      if (!re.test(text)) continue;
      const statLabel = GRID_STATS[key].label.toLowerCase();
      if (IN_ONE_GAME.test(text)) {
        return question('single_game_stat_min', { stat: key, x: String(n) }, `${n}+ ${statLabel} in one game`);
      }
      if (IN_ONE_SEASON.test(text)) {
        return question('season_stat_total_min', { stat: key, x: String(n) }, `${n}+ ${statLabel} in one season`);
      }
      if (key === 'goals') {
        return question('career_goals_min', { goals: String(n) }, `${n}+ career goals`);
      }
      return question('career_stat_total_min', { stat: key, x: String(n) }, `${n}+ career ${statLabel}`);
    }
  }

  return null;
}

/**
 * The single "every player" axis a one-question search is solved against:
 * the parsed question on one side, and a threshold every player clears on
 * the other. Exported so the search layer can answer the question with the
 * same pair the shared board below is built from.
 */
export const EVERY_PLAYER_AXIS: GridAxisState = {
  builder: 'career_games_min',
  params: { games: '1' },
};

/**
 * A board with the parsed question in one solvable cell: the question as
 * row 1, "1+ career games" (i.e. every player) as column 1, and the
 * remaining axes left incomplete so no other cell solves. Most games
 * first, so the familiar names lead the answer.
 *
 * This is now only the "open this in the grid solver to refine it" link,
 * offered beside results that are already on screen -- never the way the
 * question gets answered, which must not depend on reaching that page.
 */
export function gridSolverHref(axis: GridAxisState): string {
  const filler = (): GridAxisState => ({ builder: 'career_games_min', params: {} });
  const board: GridBoardState = {
    rows: [axis, filler(), filler()],
    cols: [EVERY_PLAYER_AXIS, filler(), filler()],
    order: 'games_desc',
  };
  return `/grid-solver?g=${serializeBoardState(board)}`;
}

/**
 * Resolve a query and its extracted signals to a single best deep link.
 *
 * Checked in order, first match wins. Returns `null` when nothing in the
 * registry recognises the query — callers should keep showing the normal
 * entity results in that case, not an empty state.
 */
export function resolveIntent(
  query: string,
  signals: QuerySignals,
  ctx: { bestRecord?: IntentCandidate | null; bestAward?: IntentCandidate | null },
): IntentMatch | null {
  const lower = query.trim().toLowerCase();
  if (lower.length === 0) return null;

  const { club, year, topicWords } = signals;
  const yearStr = year !== null ? String(year) : undefined;

  // 1. Brownlow: a dedicated page (full vote history, career leaders),
  // distinct from the generic awards-table row of the same name.
  if (/\bbrownlow\b/.test(lower) || ctx.bestAward?.slug === '/brownlow') {
    if (club) {
      return {
        href: buildHref(
          '/brownlow',
          { club: club.slug, season_min: yearStr, season_max: yearStr },
          'brownlow-winners',
        ),
        label: `Brownlow winners — ${club.name}`,
        detail: 'Winners by season, filtered to this club.',
      };
    }
    if (/\bleaders?\b|\bcareer\b/.test(topicWords)) {
      return {
        href: buildHref('/brownlow', {}, 'brownlow-leaders'),
        label: 'Brownlow career vote leaders',
        detail: 'Most career Brownlow votes.',
      };
    }
    if (year !== null) {
      return {
        href: buildHref('/brownlow', { season_min: yearStr, season_max: yearStr }, 'brownlow-winners'),
        label: `Brownlow Medal, ${year}`,
        detail: 'Winners by season, filtered to this year.',
      };
    }
    return {
      href: '/brownlow',
      label: 'Brownlow Medal',
      detail: 'Every winner and the full vote history, from 1924.',
    };
  }

  // 2. Draft: the recruiting club ("drafted to") vs. the feeder club
  // ("drafted from") are different filters on the same page. The feeder
  // club is almost never an AFL club — it's a WAFL/SANFL/TAC Cup side
  // (Claremont, Oakleigh, ...) that the `clubs` table (and so `club`,
  // detected against AFL club names) knows nothing about. So "from"/"out
  // of" wording is read directly off the raw query rather than off the
  // shared club signal, taking whatever text follows it verbatim — which
  // is also why /draft's "Drafted from" filter is free text, not a select.
  if (/\bdraft(ed)?\b/.test(lower)) {
    const params: Record<string, string | undefined> = { year: yearStr };
    let detail = 'Draft picks';
    const fromMatch = /\b(?:from|out of)\s+(.+)$/.exec(lower);
    const origin = fromMatch ? fromMatch[1].replace(YEAR_RE, '').trim() : '';
    if (origin) {
      params.origin = titleCase(origin);
      detail = `Recruited from ${titleCase(origin)}`;
    } else if (club) {
      params.club = club.slug;
      detail = `Drafted to ${club.name}`;
    }
    if (year !== null) detail += ` in ${year}`;
    return {
      href: buildHref('/draft', params),
      label: 'Draft picks',
      detail,
    };
  }

  // 3. A record category, narrowed to a club. Left to the generic record
  // result when there's no club — this only adds value once one narrows it.
  if (club && ctx.bestRecord && ctx.bestRecord.score >= CONFIDENCE_THRESHOLD) {
    return {
      href: buildHref(`/records/${ctx.bestRecord.slug}`, { club: club.slug }),
      label: `${ctx.bestRecord.title} — ${club.name}`,
      detail: `${ctx.bestRecord.title}, filtered to ${club.name}.`,
    };
  }

  // 4. A non-Brownlow award, narrowed to a club (Brownlow is handled above).
  if (club && ctx.bestAward && ctx.bestAward.score >= CONFIDENCE_THRESHOLD) {
    return {
      href: buildHref(`/awards/${ctx.bestAward.slug}`, {
        club: club.slug, season_min: yearStr, season_max: yearStr,
      }),
      label: `${ctx.bestAward.title} — ${club.name}`,
      detail: `Every winner, filtered to ${club.name}.`,
    };
  }

  // A player question in plain words ("drawn twice or more") is
  // deliberately NOT handled here. An intent is a "go to this page" link,
  // and answering a question with a link to the grid solver made the
  // answer depend on reaching that page: at the default audience a reader
  // without access got no link and no answer, just "no results". The
  // search layer parses and answers it directly instead, on the page the
  // reader is already looking at -- see playerQuestion in
  // db/queries/search.ts.
  return null;
}
