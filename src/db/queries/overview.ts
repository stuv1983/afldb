import 'server-only';

import { cache } from 'react';

import { sql } from '@/db/client';

/**
 * The whole-record counts, in one round trip.
 *
 * Two callers with one requirement in common: the home page's statistics
 * strip and the hero of the published apex page must never quote different
 * numbers for the same thing. Sharing the query is what guarantees that —
 * the apex figures used to be a hand-typed snapshot, and docs/apex-coming-soon.md
 * carried a standing note to remember to refresh them.
 *
 * Read on the PUBLIC pool even when the caller is an admin action. These are
 * public counts off the statistical tables, which afldb_app selects from on
 * every home-page render; routing them through afldb_auth instead would mean
 * granting that role a reason to read player_match_stats that it does not
 * otherwise have.
 */
export type SiteTotals = {
  players: number;
  matches: number;
  playerGames: number;
  clubs: number;
  venues: number;
  seasons: number;
  firstSeason: number;
  lastSeason: number;
};

export const getSiteTotals = cache(async function getSiteTotals(): Promise<SiteTotals> {
  const [row] = await sql<SiteTotals[]>`
    SELECT (SELECT count(*) FROM players)::int             AS players,
           (SELECT count(*) FROM matches)::int             AS matches,
           (SELECT count(*) FROM player_match_stats)::int  AS "playerGames",
           (SELECT count(*) FROM clubs)::int               AS clubs,
           (SELECT count(*) FROM venues)::int              AS venues,
           (SELECT count(*) FROM seasons)::int             AS seasons,
           (SELECT min(year) FROM seasons)::int            AS "firstSeason",
           (SELECT max(year) FROM seasons)::int            AS "lastSeason"
  `;
  return row;
});
