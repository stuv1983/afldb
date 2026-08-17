/**
 * Synchronous entity matching against an in-memory directory: clubs and
 * venues by longest whole-phrase match, including aliases and nicknames.
 * Player matching is NOT here -- it is the parser's one async step,
 * because 13,361 names cannot reasonably live in a request-time
 * in-memory directory the way ~24 clubs and ~52 venues can.
 *
 * DB-free and pure, like plan.ts and vocab.ts: db/queries/nl/resolve.ts
 * builds the directories from the database (clubs+club_aliases merged
 * with CLUB_NICKNAMES, venues+venue_aliases merged with
 * VENUE_NICKNAMES); tests inject small fake directories instead.
 */

import type { NlClubRef, NlVenueRef } from '@/search/nl/plan';

export type NlClubDirectoryEntry = NlClubRef & { names: string[] };
export type NlVenueDirectoryEntry = NlVenueRef & { names: string[] };

export type NlEntityMatch<T> = { entity: T; matchedText: string };

/**
 * The longest name/alias from `directory` that appears as a whole
 * word/phrase in `text`, plus the exact substring it matched. Longest
 * wins so a name that is a substring of another's (a short abbreviation
 * inside a longer club name, for instance) cannot shadow the more
 * specific one -- the same rule query-intent.ts's findClub already uses,
 * generalised to multiple names per entity.
 */
function findLongestMatch<T extends { names: string[] }>(
  text: string,
  directory: readonly T[],
): NlEntityMatch<T> | null {
  let best: NlEntityMatch<T> | null = null;
  for (const entity of directory) {
    for (const name of entity.names) {
      if (best && name.length <= best.matchedText.length) continue;
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
      if (re.test(text)) best = { entity, matchedText: name };
    }
  }
  return best;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findClub(text: string, directory: readonly NlClubDirectoryEntry[]): NlEntityMatch<NlClubDirectoryEntry> | null {
  return findLongestMatch(text, directory);
}

export function findVenue(text: string, directory: readonly NlVenueDirectoryEntry[]): NlEntityMatch<NlVenueDirectoryEntry> | null {
  return findLongestMatch(text, directory);
}

/** Remove a matched phrase from the text, replacing it with a single space so surrounding tokens don't collide. */
export function stripMatch(text: string, matchedText: string): string {
  return text.replace(new RegExp(`\\b${escapeRegExp(matchedText)}\\b`), ' ').replace(/\s+/g, ' ').trim();
}
