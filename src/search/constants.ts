/**
 * Search constants shared by server queries and Client Components.
 *
 * Kept separate from the query modules, which are `server-only`: a
 * Client Component importing those would be a build error.
 */

/** Below this length a search issues no database query. */
export const MIN_QUERY_LENGTH = 2;

/** Autocomplete never returns more than this many suggestions. */
export const AUTOCOMPLETE_LIMIT = 8;

/**
 * Hard ceiling on any page size, regardless of what the URL requests.
 * Evaluates AFLDB_MAX_PAGE_SIZE from the environment if configured (see changeLog.md).
 */
const envMaxPageSize = typeof process !== 'undefined' && process.env?.AFLDB_MAX_PAGE_SIZE
  ? Number(process.env.AFLDB_MAX_PAGE_SIZE)
  : NaN;
export const MAX_PAGE_SIZE = Number.isSafeInteger(envMaxPageSize) && envMaxPageSize > 0
  ? envMaxPageSize
  : 100;

export const DEFAULT_PAGE_SIZE = 50;

export type SearchResultType =
  | 'player' | 'club' | 'venue' | 'season' | 'round' | 'match' | 'award' | 'record'
  | 'aflw_player' | 'aflw_club';

/**
 * Route a search result to its page.
 *
 * Shared by the results page and the autocomplete dropdown so a
 * suggestion can never navigate somewhere its section would not. Player
 * URLs carry the id because slugs are not unique — two Gary Abletts —
 * and the others are slugged directly.
 */
export function searchResultHref(result: {
  type: SearchResultType; slug: string; id: number;
}): string {
  // A slug that is already a path routes as-is — the Hall of Fame lives
  // at /hall-of-fame but surfaces among the award results.
  if (result.slug.startsWith('/')) return result.slug;
  switch (result.type) {
    case 'player': return `/players/${result.slug}-${result.id}`;
    case 'club': return `/clubs/${result.slug}`;
    case 'venue': return `/venues/${result.slug}`;
    case 'season': return `/seasons/${result.slug}`;
    // slug is "1989#round-5": the season page with the round anchored.
    case 'round': return `/seasons/${result.slug}`;
    case 'match': return `/matches/${result.id}`;
    case 'award': return `/awards/${result.slug}`;
    case 'record': return `/records/${result.slug}`;
    // AFLW keys are the source's own and may contain characters that must
    // not travel raw in a path, so they are encoded rather than
    // interpolated. A club is keyed by its code, a player by their slug.
    case 'aflw_player': return `/aflw/players/${encodeURIComponent(result.slug)}`;
    case 'aflw_club': return `/aflw/clubs/${encodeURIComponent(result.slug)}`;
  }
}

/** Human labels for grouping mixed suggestions in the dropdown. */
export const SEARCH_TYPE_LABELS: Record<SearchResultType, string> = {
  player: 'Player',
  club: 'Club',
  venue: 'Venue',
  season: 'Season',
  round: 'Round',
  match: 'Match',
  award: 'Award',
  record: 'Record',
  aflw_player: 'AFLW player',
  aflw_club: 'AFLW club',
};
