import 'server-only';

import { sql } from '@/db/client';

/**
 * Global search across players, clubs, venues and seasons.
 *
 * Matching runs against normalised columns (lowercase, unaccented,
 * punctuation-stripped) so display names are never altered. Ranking
 * prefers exact matches, then prefix matches, then trigram similarity,
 * with career games breaking ties so prominent players surface first.
 */

export const MIN_QUERY_LENGTH = 2;

export type SearchResultType = 'player' | 'club' | 'venue' | 'season';

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

export async function searchClubs(query: string, limit = 6): Promise<SearchResult[]> {
  return sql<SearchResult[]>`
    WITH q AS (SELECT afldb_normalise_name(${query}) AS term)
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
     LIMIT ${limit}
  `;
}

export async function searchVenues(query: string, limit = 6): Promise<SearchResult[]> {
  return sql<SearchResult[]>`
    WITH q AS (SELECT afldb_normalise_name(${query}) AS term)
    SELECT DISTINCT ON (v.id)
           'venue'::text AS type,
           v.id,
           v.slug,
           v.canonical_name AS title,
           (v.first_season || '–' || v.last_season) AS subtitle,
           (CASE WHEN afldb_normalise_name(v.canonical_name) = q.term THEN 1000
                 WHEN afldb_normalise_name(v.canonical_name) LIKE q.term || '%' THEN 500
                 ELSE 200 END)::float AS rank
      FROM venues v
      LEFT JOIN venue_aliases a ON a.venue_id = v.id
     CROSS JOIN q
     WHERE afldb_normalise_name(v.canonical_name) LIKE '%' || q.term || '%'
        OR afldb_normalise_name(a.alias)          LIKE '%' || q.term || '%'
     ORDER BY v.id, rank DESC
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

export type GlobalSearchResults = {
  players: SearchResult[];
  clubs: SearchResult[];
  venues: SearchResult[];
  seasons: SearchResult[];
  total: number;
};

export async function globalSearch(
  query: string,
  playerLimit = 25,
): Promise<GlobalSearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { players: [], clubs: [], venues: [], seasons: [], total: 0 };
  }

  const [players, clubs, venues, seasons] = await Promise.all([
    searchPlayers(trimmed, playerLimit),
    searchClubs(trimmed),
    searchVenues(trimmed),
    searchSeasons(trimmed),
  ]);

  return {
    players,
    clubs,
    venues,
    seasons,
    total: players.length + clubs.length + venues.length + seasons.length,
  };
}

/** Autocomplete: players only, tightly limited. */
export async function autocomplete(query: string, limit = 8): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  return searchPlayers(trimmed, Math.min(limit, 10));
}
