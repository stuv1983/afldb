import 'server-only';

import { searchAflwClubs, searchAflwPlayers } from '@/db/queries/aflw';
import { sql } from '@/db/client';
import { RECORD_CATEGORIES } from '@/db/queries/records';

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
    WITH q AS (SELECT afldb_normalise_name(${query}) AS term)
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
    WITH q AS (SELECT afldb_normalise_name(${query}) AS term),
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
    WITH q AS (SELECT afldb_normalise_name(${query}) AS term),
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
    WITH q AS (SELECT afldb_normalise_name(${query}) AS term)
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
  total: number;
};

const EMPTY_RESULTS: GlobalSearchResults = {
  players: [], clubs: [], venues: [], seasons: [],
  rounds: [], awards: [], records: [],
  aflwPlayers: [], aflwClubs: [], total: 0,
};

export async function globalSearch(
  query: string,
  playerLimit = 25,
): Promise<GlobalSearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return EMPTY_RESULTS;

  const [players, clubs, venues, seasons, rounds, awards, aflw] = await Promise.all([
    searchPlayers(trimmed, playerLimit),
    searchClubs(trimmed),
    searchVenues(trimmed),
    searchSeasons(trimmed),
    searchRounds(trimmed),
    searchAwards(trimmed),
    aflwResults(trimmed, { players: 10, clubs: 4 }),
  ]);
  const records = searchRecords(trimmed);

  return {
    players, clubs, venues, seasons, rounds, awards, records,
    aflwPlayers: aflw.players,
    aflwClubs: aflw.clubs,
    total: players.length + clubs.length + venues.length + seasons.length
      + rounds.length + awards.length + records.length
      + aflw.players.length + aflw.clubs.length,
  };
}

/**
 * Autocomplete across every entity type.
 *
 * Players fill whatever the other types leave free, which in practice is
 * most of the list: a season, round or award match is close to exact
 * when it fires at all, while player matches are fuzzy and plentiful.
 */
export async function autocomplete(query: string, limit = 8): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  const capped = Math.min(limit, 10);

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
