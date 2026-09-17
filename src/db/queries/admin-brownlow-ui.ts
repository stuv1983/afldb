import 'server-only';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';

/**
 * AFLDB-ISSUE-155 Phase C2 — read-only helpers the Brownlow admin UI needs
 * on top of the C1 read model (`src/db/queries/admin-brownlow.ts`).
 *
 * C1's read model answers "what is the state of this season / round / match".
 * The UI additionally needs: the polled players of a season (to offer an
 * ineligibility multi-select), who last touched each season's authority row
 * (shown beside the season in the list), and one cheap number for the
 * dashboard badge. None of these change a fact; every statement here is a
 * SELECT, so the sole-writer contract in
 * `tests/admin-match-mutations.test.ts` is untouched.
 */

export type SeasonPolledPlayer = {
  playerId: number;
  playerName: string;
  votes: number;
  isIneligible: boolean;
};

/**
 * Every player who polled at least one vote in the season, highest first,
 * carrying the ineligibility flag their current season row holds (or
 * `false` when no season row exists yet). This is the exact set
 * `publishBrownlowSeason` validates `ineligiblePlayerIds` against, so the
 * multi-select can only ever offer a legal choice.
 */
export async function listSeasonPolledPlayers(season: number): Promise<SeasonPolledPlayer[]> {
  return sql<SeasonPolledPlayer[]>`
    SELECT brv.player_id                              AS "playerId",
           p.display_name                            AS "playerName",
           sum(brv.votes)::int                       AS votes,
           COALESCE(bool_or(bsv.is_ineligible), false) AS "isIneligible"
      FROM brownlow_round_votes brv
      JOIN players p ON p.id = brv.player_id
      LEFT JOIN brownlow_season_votes bsv
        ON bsv.season = brv.season AND bsv.player_id = brv.player_id
     WHERE brv.season = ${season} AND brv.votes > 0
     GROUP BY brv.player_id, p.display_name
     ORDER BY votes DESC, p.display_name
  `;
}

export type BrownlowSeasonAdminMeta = {
  season: number;
  updatedBy: number | null;
  updatedAt: Date | null;
  publishedBy: number | null;
  publishedAt: Date | null;
};

/** The `brownlow_season_authority` bookkeeping for a set of seasons, keyed by season. */
export async function getBrownlowSeasonAdminMeta(
  seasons: number[],
): Promise<Map<number, BrownlowSeasonAdminMeta>> {
  if (seasons.length === 0) return new Map();
  const rows = await sql<BrownlowSeasonAdminMeta[]>`
    SELECT season,
           updated_by   AS "updatedBy",
           updated_at   AS "updatedAt",
           published_by AS "publishedBy",
           published_at AS "publishedAt"
      FROM brownlow_season_authority
     WHERE season = ANY(${seasons})
  `;
  return new Map(rows.map((row) => [row.season, row]));
}

/**
 * Admin-account emails for a set of ids, on the auth pool (cross-database:
 * the authority table names auth-user ids, and only `authSql` can turn them
 * into an address). Mirrors the `/admin` dashboard's own email lookup.
 */
export async function resolveAdminEmails(ids: Array<number | null>): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((n): n is number => Number.isInteger(n) && (n as number) > 0))];
  if (unique.length === 0) return new Map();
  const rows = await authSql<Array<{ id: number; email: string }>>`
    SELECT id, email FROM auth_users WHERE id = ANY(${unique})
  `;
  return new Map(rows.map((row) => [row.id, row.email]));
}

export type BrownlowDashboardBadge = {
  season: number;
  expected: number;
  incomplete: number;
};

/**
 * The newest polled season's count of home-and-away matches still without a
 * finalise/void decision or a complete set of source votes (§27.9). One
 * season's worth of matches, so it is cheap enough for every dashboard load.
 * `null` when no polled season has home-and-away matches at all.
 */
export async function getBrownlowDashboardBadge(): Promise<BrownlowDashboardBadge | null> {
  const [row] = await sql<BrownlowDashboardBadge[]>`
    WITH target AS (
      SELECT max(m.season) AS season
        FROM matches m
        JOIN stat_availability av
          ON av.stat_key = 'brownlow_season_total'
         AND av.season = m.season
         AND av.coverage::text <> 'not_applicable'
       WHERE m.round_type = 'home_and_away'
    )
    SELECT t.season,
           count(*)::int AS expected,
           (count(*) - count(*) FILTER (
             WHERE es.status = 'void'
                OR (rv.total = 6 AND rv.positives = 3 AND rv.distinct_values = 3)
           ))::int AS incomplete
      FROM target t
      JOIN matches m ON m.season = t.season AND m.round_type = 'home_and_away'
      LEFT JOIN brownlow_vote_entry_state es ON es.match_id = m.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(brv.votes), 0)                            AS total,
               count(*) FILTER (WHERE brv.votes > 0)                  AS positives,
               count(DISTINCT brv.votes) FILTER (WHERE brv.votes > 0) AS distinct_values
          FROM brownlow_round_votes brv WHERE brv.match_id = m.id
      ) rv ON true
     WHERE t.season IS NOT NULL
     GROUP BY t.season
  `;
  return row ?? null;
}
