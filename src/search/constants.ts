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

/** Hard ceiling on any page size, regardless of what the URL requests. */
export const MAX_PAGE_SIZE = 100;

export const DEFAULT_PAGE_SIZE = 50;
