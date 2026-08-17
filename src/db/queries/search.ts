import 'server-only';

import { getClubOptions } from '@/db/queries/advanced-search';
import { searchAflwClubs, searchAflwPlayers } from '@/db/queries/aflw';
import { sql } from '@/db/client';
import { RECORD_CATEGORIES } from '@/db/queries/records';
import { solveCellRows, type GridCellRow } from '@/db/queries/grid-solver';
import { normalisedSearchTerm } from '@/lib/like';
import {
  EVERY_PLAYER_AXIS,
  type ClubQuestionKind,
  type IntentMatch,
  extractQuerySignals,
  gridSolverHref,
  parseClubQuestion,
  parsePlayerQuestion,
  resolveIntent,
} from '@/search/query-intent';

/**
 * Global search across players, clubs, venues, seasons, rounds, awards
 * and record categories.
 *
 * Matching runs against normalised columns (lowercase, unaccented,
 * punctuation-stripped) so display names are never altered. Ranking
 * prefers exact matches, then prefix matches, then trigram similarity,
 * with career games breaking ties so prominent players surface first.
 */

export const MIN_QUERY_LENGTH = 2;

/**
 * Neutralise the LIKE metacharacters that survive normalisation.
 *
 * Every match below is a bound parameter, so this is not an injection
 * guard — it is a correctness and cost one. A search for "%" reached the
 * database as `LIKE '%' || '%' || '%'`, which matches every player, club,
 * venue and award and asks PostgreSQL to rank the entire corpus by
 * trigram similarity. See lib/like.ts for why `_` is left alone.
 */
const likeSafe = normalisedSearchTerm;

export type { SearchResultType } from '@/search/constants';
import type { SearchResultType } from '@/search/constants';

export type SearchResult = {
  type: SearchResultType;
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  rank: number;
};

export async function searchPlayers(query: string, limit = 20): Promise<SearchResult[]> {
  return sql<SearchResult[]>`
    WITH q AS (SELECT afldb_normalise_name(${likeSafe(query)}) AS term)
    SELECT 'player'::text AS type,
           p.id,
           p.slug,
           p.display_name AS title,
           CASE
             WHEN c.debut_season IS NULL THEN NULL
             ELSE (SELECT string_agg(DISTINCT cl.short_name, ', ')
                     FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
                    WHERE pc.player_id = p.id)
                  || ' · ' || c.debut_season || '–' || c.final_season
                  || ' · ' || c.games || ' games'
           END AS subtitle,
           (CASE WHEN p.search_name = q.term            THEN 1000
                 WHEN p.search_name LIKE q.term || '%'  THEN 500
                 WHEN p.search_name LIKE '%' || q.term || '%' THEN 250
                 ELSE 0 END
            + similarity(p.search_name, q.term) * 100
            + LEAST(COALESCE(p.search_rank, 0), 400) / 10.0)::float AS rank
      FROM players p
      JOIN player_career_stats c ON c.player_id = p.id
     CROSS JOIN q
     WHERE p.search_name LIKE '%' || q.term || '%'
        OR p.search_name % q.term
     ORDER BY rank DESC, c.games DESC, p.sort_name
     LIMIT ${limit}
  `;
}

/**
 * DISTINCT ON must sort by its own key first, so de-duplication and
 * relevance ordering cannot happen in one pass: applying LIMIT there
 * would take the lowest-numbered clubs and only then rank them. These
 * queries de-duplicate in a subquery and rank the whole candidate set.
 */
export async function searchClubs(query: string, limit = 6): Promise<SearchResult[]> {
  return sql<SearchResult[]>`
    WITH q AS (SELECT afldb_normalise_name(${likeSafe(query)}) AS term),
    matched AS (
      SELECT DISTINCT ON (c.id)
             'club'::text AS type,
             c.id,
             c.slug,
             c.name AS title,
             CASE WHEN c.is_current_afl_club THEN 'Current AFL club'
                  ELSE initcap(c.succession::text) || ' · '
                       || c.first_season || '–' || c.last_season END AS subtitle,
             (CASE WHEN afldb_normalise_name(c.name) = q.term THEN 1000
                   WHEN afldb_normalise_name(c.name) LIKE q.term || '%' THEN 500
                   ELSE 200 END
              + similarity(afldb_normalise_name(c.name), q.term) * 100)::float AS rank
        FROM clubs c
        LEFT JOIN club_aliases a ON a.club_id = c.id
       CROSS JOIN q
       WHERE afldb_normalise_name(c.name)  LIKE '%' || q.term || '%'
          OR afldb_normalise_name(a.alias) LIKE '%' || q.term || '%'
       ORDER BY c.id, rank DESC
    )
    SELECT type, id, slug, title, subtitle, rank
      FROM matched
     ORDER BY rank DESC, title
     LIMIT ${limit}
  `;
}

export async function searchVenues(query: string, limit = 6): Promise<SearchResult[]> {
  return sql<SearchResult[]>`
    WITH q AS (SELECT afldb_normalise_name(${likeSafe(query)}) AS term),
    matched AS (
      SELECT DISTINCT ON (v.id)
             'venue'::text AS type,
             v.id,
             v.slug,
             v.canonical_name AS title,
             (v.first_season || '–' || v.last_season) AS subtitle,
             (CASE WHEN afldb_normalise_name(v.canonical_name) = q.term THEN 1000
                   WHEN afldb_normalise_name(v.canonical_name) LIKE q.term || '%' THEN 500
                   ELSE 200 END
              + similarity(afldb_normalise_name(v.canonical_name), q.term) * 100)::float AS rank
        FROM venues v
        LEFT JOIN venue_aliases a ON a.venue_id = v.id
       CROSS JOIN q
       WHERE afldb_normalise_name(v.canonical_name) LIKE '%' || q.term || '%'
          OR afldb_normalise_name(a.alias)          LIKE '%' || q.term || '%'
       ORDER BY v.id, rank DESC
    )
    SELECT type, id, slug, title, subtitle, rank
      FROM matched
     ORDER BY rank DESC, title
     LIMIT ${limit}
  `;
}

export async function searchSeasons(query: string, limit = 4): Promise<SearchResult[]> {
  const year = Number(query.trim());
  if (!Number.isInteger(year) || year < 1897 || year > 2100) return [];
  return sql<SearchResult[]>`
    SELECT 'season'::text AS type, s.year AS id, s.year::text AS slug,
           s.year || ' ' || s.league || ' season' AS title,
           (s.match_count || ' matches · ' || s.club_count || ' clubs') AS subtitle,
           900::float AS rank
      FROM seasons s
     WHERE s.year = ${year}
     LIMIT ${limit}
  `;
}

/**
 * "round 5 1989", "1989 round 5", "r5 1989", "1989 grand final" — a
 * specific round of a specific season.
 *
 * Parsed here rather than in SQL because it is language, not data: the
 * database is only asked whether that season exists and how many rounds
 * it had.
 */
const ROUND_QUERY_RE =
  /^(?:(?:round|rnd|r)\s*(\d{1,2})\s+(\d{4})|(\d{4})\s+(?:round|rnd|r)\s*(\d{1,2}))$/i;
const FINALS_QUERY_RE =
  /^(?:(\d{4})\s+)?(grand final|preliminary final|semi final|qualifying final|elimination final)(?:\s+(\d{4}))?$/i;

export async function searchRounds(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim().toLowerCase();

  const roundMatch = ROUND_QUERY_RE.exec(trimmed);
  if (roundMatch) {
    const round = Number(roundMatch[1] ?? roundMatch[4]);
    const year = Number(roundMatch[2] ?? roundMatch[3]);
    const rows = await sql<{ year: number; matches: number }[]>`
      SELECT m.season AS year, count(*)::int AS matches
        FROM matches m
       WHERE m.season = ${year}
         AND m.round_type = 'home_and_away'
         AND m.round_number = ${round}
       GROUP BY m.season
    `;
    if (rows.length === 0) return [];
    return [{
      type: 'round',
      id: year * 100 + round,
      slug: `${year}#round-${round}`,
      title: `Round ${round}, ${year}`,
      subtitle: `${rows[0].matches} matches`,
      rank: 950,
    }];
  }

  const finalsMatch = FINALS_QUERY_RE.exec(trimmed);
  if (finalsMatch) {
    const year = Number(finalsMatch[1] ?? finalsMatch[3]);
    if (!Number.isInteger(year)) return [];
    const label = finalsMatch[2].toLowerCase();
    const roundType = label.replace(' ', '_');
    const rows = await sql<{ matches: number }[]>`
      SELECT count(*)::int AS matches
        FROM matches m
       WHERE m.season = ${year} AND m.round_type = ${roundType}::round_type
      HAVING count(*) > 0
    `;
    if (rows.length === 0) return [];
    const pretty = label.replace(/\b\w/g, (c) => c.toUpperCase());
    return [{
      type: 'round',
      id: year,
      slug: `${year}#${label.replace(' ', '-')}`,
      title: `${pretty}, ${year}`,
      subtitle: rows[0].matches > 1 ? `${rows[0].matches} matches` : null,
      rank: 950,
    }];
  }

  return [];
}

/**
 * Awards, the Hall of Fame and the honour teams under their own names:
 * "brownlow", "rising star", "copeland", "hall of fame".
 */
export async function searchAwards(query: string, limit = 6): Promise<SearchResult[]> {
  const results = await sql<SearchResult[]>`
    WITH q AS (SELECT afldb_normalise_name(${likeSafe(query)}) AS term)
    SELECT 'award'::text AS type,
           a.id, a.slug,
           a.name AS title,
           (CASE WHEN a.competition IS NOT NULL THEN a.competition || ' · ' ELSE '' END
             || a.first_season || '–' || a.last_season) AS subtitle,
           (CASE WHEN afldb_normalise_name(a.name) = q.term THEN 1000
                 WHEN afldb_normalise_name(a.name) LIKE q.term || '%' THEN 500
                 ELSE 200 END
            + similarity(afldb_normalise_name(a.name), q.term) * 100)::float AS rank
      FROM awards a
     CROSS JOIN q
     WHERE afldb_normalise_name(a.name) LIKE '%' || q.term || '%'
        OR afldb_normalise_name(a.name) % q.term
     ORDER BY rank DESC, a.name
     LIMIT ${limit}
  `;

  // The Brownlow Medal has a dedicated, richer page (full vote history,
  // career leaders) at /brownlow, distinct from the generic awards-row
  // page this query would otherwise link to. Route search there instead
  // — same absolute-path trick as the Hall of Fame below.
  const brownlow = results.find((r) => r.slug === 'brownlow-medal');
  if (brownlow) brownlow.slug = '/brownlow';

  // The Hall of Fame is a page, not an awards row; surfaced by name
  // here. An absolute-path slug routes as-is.
  const term = query.trim().toLowerCase();
  if ('hall of fame'.includes(term) && term.length >= MIN_QUERY_LENGTH) {
    results.push({
      type: 'award',
      id: -1,
      slug: '/hall-of-fame',
      title: 'Australian Football Hall of Fame',
      subtitle: 'Inductees and Legends',
      rank: 'hall of fame'.startsWith(term) ? 600 : 300,
    });
    results.sort((a, b) => b.rank - a.rank);
  }
  return results;
}

/**
 * Record categories: "most goals", "most disposals in a match".
 *
 * A static list, so it is matched in process — the database has nothing
 * to add and a query would only round-trip constants.
 */
export function searchRecords(query: string, limit = 5): SearchResult[] {
  const term = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (term.length < MIN_QUERY_LENGTH) return [];

  const scored = Object.values(RECORD_CATEGORIES).map((category) => {
    const title = category.title.toLowerCase();
    const slugText = category.slug.replace(/-/g, ' ');
    let rank = 0;
    if (title === term || slugText === term) rank = 1000;
    else if (title.startsWith(term) || slugText.startsWith(term)) rank = 500;
    else if (title.includes(term) || slugText.includes(term)) rank = 250;
    // "records" alone should list the categories, faintly.
    else if ('records'.startsWith(term)) rank = 50;
    return { category, rank };
  }).filter((s) => s.rank > 0);

  scored.sort((a, b) => b.rank - a.rank || a.category.title.localeCompare(b.category.title));

  return scored.slice(0, limit).map((s, i) => ({
    type: 'record' as const,
    id: -(i + 1),
    slug: s.category.slug,
    title: s.category.title,
    subtitle: s.category.definition,
    rank: s.rank,
  }));
}

/**
 * AFLW results, kept in their own groups.
 *
 * AFLW is a separate competition with its own clubs and its own players,
 * and nothing links the two sides of the database. Merging the two into
 * one "Players" list would imply a shared record that does not exist, so
 * the results are grouped separately and labelled.
 *
 * AFLW is keyed by slug rather than by a numeric id, so — as with record
 * categories — the position in the list stands in for one, negative to
 * keep it clear of any real row id.
 *
 * A failure here degrades to no AFLW results rather than failing the
 * search: the read model lives behind its own migration, so an app
 * deployed ahead of it must still answer every other kind of query.
 */
async function aflwResults(
  query: string,
  limits: { players: number; clubs: number },
): Promise<{ players: SearchResult[]; clubs: SearchResult[] }> {
  const [players, clubs] = await Promise.all([
    searchAflwPlayers(query, limits.players).catch(aflwUnavailable),
    searchAflwClubs(query, limits.clubs).catch(aflwUnavailable),
  ]);
  return {
    players: players.map((row, i) => ({
      type: 'aflw_player' as const,
      id: -(i + 1),
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      rank: row.rank,
    })),
    clubs: clubs.map((row, i) => ({
      type: 'aflw_club' as const,
      id: -(i + 1),
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      rank: row.rank,
    })),
  };
}

function aflwUnavailable(error: unknown): [] {
  console.error('AFLW search unavailable', error);
  return [];
}

/**
 * A question asked in plain words ("drawn twice or more", "10 goals in a
 * game"), ANSWERED — not linked to.
 *
 * The rows are the answer itself, rendered on the search page, so this
 * works for every reader regardless of who may reach /grid-solver.
 * `refineHref` is the optional extra: the same question opened in that
 * page for someone who can use it, and null for everyone else.
 */
export type PlayerQuestionAnswer = {
  /** Human-readable restatement, e.g. "2+ draws in one season". */
  label: string;
  rows: GridCellRow[];
  total: number;
  refineHref: string | null;
};

export type GlobalSearchResults = {
  players: SearchResult[];
  clubs: SearchResult[];
  venues: SearchResult[];
  seasons: SearchResult[];
  rounds: SearchResult[];
  awards: SearchResult[];
  records: SearchResult[];
  aflwPlayers: SearchResult[];
  aflwClubs: SearchResult[];
  /** A recognised intent, e.g. "brownlow winner richmond" -> filtered deep link. */
  intent: IntentMatch | null;
  /** A plain-words player question, already answered. */
  playerQuestion: PlayerQuestionAnswer | null;
  /** A plain-words club question ("teams to draw twice"), already answered. */
  clubQuestion: ClubQuestionAnswer | null;
  total: number;
};

/**
 * One answered club question: the club-SEASONS that satisfy it.
 *
 * A club-season is the right grain -- "teams to draw twice in one season"
 * is answered by "Collingwood, 2011", not by "Collingwood" -- so each row
 * carries the season and that season's record.
 */
export type ClubSeasonRow = {
  clubId: number;
  clubSlug: string;
  clubName: string;
  season: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  ladderRank: number | null;
};

export type ClubQuestionAnswer = {
  label: string;
  rows: ClubSeasonRow[];
  total: number;
};

/** How many answer rows a search page shows before "refine" takes over. */
const PLAYER_QUESTION_ROWS = 10;

/**
 * The WHERE and ORDER BY for each club question kind.
 *
 * Both are fixed SQL written here, chosen by a closed union -- never a
 * request-supplied column or direction, the same discipline the grid
 * solver's builders follow. Only the threshold is a bound parameter.
 */
function clubQuestionSql(kind: ClubQuestionKind, n: number): {
  where: ReturnType<typeof sql>;
  orderBy: ReturnType<typeof sql>;
} {
  // Ordering puts the most extreme season first (five draws before two),
  // then the most recent, so the head of the list is the interesting end
  // rather than an arbitrary slice.
  switch (kind) {
    case 'season_draws_min':
      return { where: sql`cs.draws >= ${n}`, orderBy: sql`cs.draws DESC, cs.season DESC` };
    case 'season_wins_min':
      return { where: sql`cs.wins >= ${n}`, orderBy: sql`cs.wins DESC, cs.season DESC` };
    case 'season_losses_min':
      return { where: sql`cs.losses >= ${n}`, orderBy: sql`cs.losses DESC, cs.season DESC` };
    case 'wooden_spoon':
      return { where: sql`cs.wooden_spoon`, orderBy: sql`cs.season DESC` };
    case 'premiers':
      return { where: sql`cs.is_premier`, orderBy: sql`cs.season DESC` };
    case 'minor_premiers':
      return { where: sql`cs.ladder_rank = 1`, orderBy: sql`cs.season DESC` };
    // `played > 0` keeps a season with no recorded matches out of both:
    // "won none of nothing" is not a winless season.
    case 'winless':
      return { where: sql`cs.wins = 0 AND cs.played > 0`, orderBy: sql`cs.played DESC, cs.season DESC` };
    case 'undefeated':
      return { where: sql`cs.losses = 0 AND cs.played > 0`, orderBy: sql`cs.played DESC, cs.season DESC` };
  }
}

/**
 * Parse and answer a club question, or null.
 *
 * Degrades to "no question recognised" on error, like its player
 * counterpart: the reader still gets their ordinary search results.
 */
async function answerClubQuestion(query: string): Promise<ClubQuestionAnswer | null> {
  const parsed = parseClubQuestion(query);
  if (!parsed) return null;

  try {
    const { where, orderBy } = clubQuestionSql(parsed.kind, parsed.n);
    const rows = await sql<(ClubSeasonRow & { total: string })[]>`
      SELECT cs.club_id AS "clubId", c.slug AS "clubSlug", c.name AS "clubName",
             cs.season, cs.played, cs.wins, cs.draws, cs.losses,
             cs.ladder_rank AS "ladderRank",
             count(*) OVER () AS total
        FROM club_seasons cs
        JOIN clubs c ON c.id = cs.club_id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ${PLAYER_QUESTION_ROWS}
    `;
    if (rows.length === 0) return null;
    return {
      label: parsed.label,
      rows: rows.map(({ total: _total, ...rest }) => rest),
      total: Number(rows[0].total),
    };
  } catch (error) {
    console.error('club question could not be answered', error);
    return null;
  }
}

/**
 * Parse and answer a plain-words player question, or null.
 *
 * Runs one grid-solver shape (the question against "every player"), which
 * is the same bounded, parameterised SQL the grid solver itself compiles
 * -- no request-chosen column or operator -- under the same statement
 * timeout as every other query on the site.
 *
 * A failure degrades to "no question recognised" rather than failing the
 * whole search: the reader still gets their player and club results.
 */
async function answerPlayerQuestion(
  query: string,
  canReachGridSolver: boolean,
): Promise<PlayerQuestionAnswer | null> {
  const parsed = parsePlayerQuestion(query);
  if (!parsed) return null;

  try {
    const { rows, total } = await solveCellRows(
      parsed.axis, EVERY_PLAYER_AXIS, 'games_desc',
      { limit: PLAYER_QUESTION_ROWS, offset: 0 },
    );
    if (total === 0) return null;
    return {
      label: parsed.label,
      rows,
      total,
      refineHref: canReachGridSolver ? gridSolverHref(parsed.axis) : null,
    };
  } catch (error) {
    console.error('player question could not be answered', error);
    return null;
  }
}

const EMPTY_RESULTS: GlobalSearchResults = {
  players: [], clubs: [], venues: [], seasons: [],
  rounds: [], awards: [], records: [],
  aflwPlayers: [], aflwClubs: [], intent: null,
  playerQuestion: null, clubQuestion: null, total: 0,
};

export async function globalSearch(
  query: string,
  playerLimit = 25,
  options: {
    /**
     * Whether the visitor may reach /grid-solver. Only decides whether the
     * answer carries a "refine there" link -- the answer itself is
     * computed and shown either way.
     */
    canReachGridSolver?: boolean;
  } = {},
): Promise<GlobalSearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return EMPTY_RESULTS;

  // A query naming a club or a season often also names a record category
  // or an award ("most goals richmond", "coleman medal 1989"), but the
  // full phrase never matches a category or award name outright — only
  // the words left once the club/year are stripped do. That stripped
  // form is used only to find a stronger record/award hit for the intent
  // link below; every other entity is still searched on the full query.
  const clubDirectory = await getClubOptions();
  const signals = extractQuerySignals(trimmed, clubDirectory);
  const topicText = (signals.club || signals.year !== null) ? signals.topicWords : '';
  const runTopicSearch = topicText.length >= MIN_QUERY_LENGTH && topicText !== trimmed;

  const [
    players, clubs, venues, seasons, rounds, awards, aflw, topicAwards,
    playerQuestion, clubQuestion,
  ] = await Promise.all([
    searchPlayers(trimmed, playerLimit),
    searchClubs(trimmed),
    searchVenues(trimmed),
    searchSeasons(trimmed),
    searchRounds(trimmed),
    searchAwards(trimmed),
    aflwResults(trimmed, { players: 10, clubs: 4 }),
    runTopicSearch ? searchAwards(topicText, 3) : Promise.resolve([] as SearchResult[]),
    answerPlayerQuestion(trimmed, options.canReachGridSolver ?? false),
    answerClubQuestion(trimmed),
  ]);
  const records = searchRecords(trimmed);
  const topicRecords = runTopicSearch ? searchRecords(topicText, 3) : [];

  const bestAward = topicAwards[0] ?? awards[0] ?? null;
  const bestRecord = topicRecords[0] ?? records[0] ?? null;
  const intent = resolveIntent(trimmed, signals, {
    bestRecord: bestRecord && { slug: bestRecord.slug, title: bestRecord.title, score: bestRecord.rank },
    bestAward: bestAward && { slug: bestAward.slug, title: bestAward.title, score: bestAward.rank },
  });

  return {
    players, clubs, venues, seasons, rounds, awards, records,
    aflwPlayers: aflw.players,
    aflwClubs: aflw.clubs,
    intent,
    playerQuestion,
    clubQuestion,
    // An answered question is a result: without this, a phrase that only
    // the question parser understands still renders the "no results"
    // empty state despite having an answer on screen.
    total: players.length + clubs.length + venues.length + seasons.length
      + rounds.length + awards.length + records.length
      + aflw.players.length + aflw.clubs.length
      + (playerQuestion ? 1 : 0) + (clubQuestion ? 1 : 0),
  };
}

/**
 * AFLW-only search, for the scoped box on /aflw.
 *
 * A thin wrapper around `aflwResults`: AFLW has no rounds, awards or
 * record categories of its own yet, so players and clubs are the whole
 * result set rather than a subset of a larger one.
 */
export type AflwSearchResults = {
  players: SearchResult[];
  clubs: SearchResult[];
  total: number;
};

export async function aflwOnlySearch(
  query: string,
  limits: { players: number; clubs: number } = { players: 20, clubs: 6 },
): Promise<AflwSearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return { players: [], clubs: [], total: 0 };

  const { players, clubs } = await aflwResults(trimmed, limits);
  return { players, clubs, total: players.length + clubs.length };
}

export type SearchScope = 'aflw' | 'players';

/**
 * Autocomplete across every entity type, or scoped: `'aflw'` for just AFLW
 * players and clubs (the box on /aflw), `'players'` for AFL/VFL players
 * only (the PlayerPicker used by /players/compare and the grid solver's
 * Teammates category) -- a straight pass-through to searchPlayers rather
 * than the mixed fan-out below, since a picker filling one slot has no use
 * for a season or venue suggestion mixed in.
 *
 * Players fill whatever the other types leave free, which in practice is
 * most of the list: a season, round or award match is close to exact
 * when it fires at all, while player matches are fuzzy and plentiful.
 */
export async function autocomplete(
  query: string,
  limit = 8,
  scope?: SearchScope,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  const capped = Math.min(limit, 10);

  if (scope === 'players') {
    return searchPlayers(trimmed, capped);
  }

  if (scope === 'aflw') {
    const aflw = await aflwResults(trimmed, { players: capped, clubs: 2 });
    return [...aflw.clubs, ...aflw.players]
      .sort((a, b) => b.rank - a.rank)
      .slice(0, capped);
  }

  const [players, clubs, venues, seasons, rounds, awards, aflw] = await Promise.all([
    searchPlayers(trimmed, capped),
    searchClubs(trimmed, 2),
    searchVenues(trimmed, 2),
    searchSeasons(trimmed, 1),
    searchRounds(trimmed),
    searchAwards(trimmed, 2),
    aflwResults(trimmed, { players: 2, clubs: 1 }),
  ]);
  const records = searchRecords(trimmed, 2);

  const others = [
    ...rounds, ...seasons, ...awards, ...records, ...clubs, ...venues,
    ...aflw.clubs, ...aflw.players,
  ]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, Math.max(2, capped - Math.min(players.length, capped - 2)));

  return [...others, ...players]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, capped);
}
