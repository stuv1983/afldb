import 'server-only';

import { cache } from 'react';

import { sql } from '@/db/client';
import { allOf, containsPattern, rangeConditions } from '@/db/queries/filters';
import type { FilterValues } from '@/search/table-filters';

export type ClubSummary = {
  id: number;
  slug: string;
  name: string;
  shortName: string;
  abbreviation: string;
  isCurrent: boolean;
  succession: string;
  firstSeason: number | null;
  lastSeason: number | null;
  homeState: string | null;
  currentIdentityId: number;
  currentIdentityName: string;
  currentIdentitySlug: string;
  /**
   * Where a merged or relocated organization went, from
   * club_organization_relations. Null for a club that simply carried on
   * or was renamed — that lineage is current_identity_id.
   */
  successorRelation: string | null;
  successorName: string | null;
  successorSlug: string | null;
  successorSeason: number | null;
  notes: string | null;
};

const CLUB_SUCCESSOR = sql`
  LEFT JOIN LATERAL (
    SELECT r.relation::text AS relation,
           t.name, t.slug,
           r.effective_season
      FROM club_organization_relations r
      LEFT JOIN club_organizations t ON t.id = r.to_organization_id
     WHERE r.from_organization_id = c.organization_id
     ORDER BY r.effective_season, r.relation
     LIMIT 1
  ) succ ON true
`;

/** Season columns the club index may be filtered on. */
export const CLUB_FILTER_COLUMNS: Record<string, string> = {
  first_season: 'c.first_season',
  last_season: 'c.last_season',
};

export type ClubFilters = {
  q?: string;
  state?: string;
  succession?: string;
  ranges?: FilterValues;
};

export async function listClubs(filters: ClubFilters = {}): Promise<ClubSummary[]> {
  const conditions: ReturnType<typeof sql>[] = filters.ranges
    ? rangeConditions(filters.ranges, CLUB_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`c.name ILIKE ${containsPattern(filters.q)}`);
  if (filters.state) conditions.push(sql`c.home_state = ${filters.state}`);
  // The enum is compared as text, so an unknown value simply matches
  // nothing instead of raising a cast error on a hand-edited URL.
  if (filters.succession) conditions.push(sql`c.succession::text = ${filters.succession}`);
  const where = allOf(conditions);

  return sql<ClubSummary[]>`
    SELECT c.id, c.slug, c.name, c.short_name AS "shortName",
           c.abbreviation, c.is_current_afl_club AS "isCurrent",
           c.succession::text, c.first_season AS "firstSeason",
           c.last_season AS "lastSeason", c.home_state AS "homeState",
           c.current_identity_id AS "currentIdentityId",
           ci.name AS "currentIdentityName", ci.slug AS "currentIdentitySlug",
           succ.relation AS "successorRelation",
           succ.name     AS "successorName",
           succ.slug     AS "successorSlug",
           succ.effective_season AS "successorSeason",
           c.notes
      FROM clubs c
      JOIN clubs ci ON ci.id = c.current_identity_id
      ${CLUB_SUCCESSOR}
     WHERE ${where}
     ORDER BY c.is_current_afl_club DESC, c.name
  `;
}

export async function getClubStates(): Promise<string[]> {
  const rows = await sql<{ state: string }[]>`
    SELECT DISTINCT home_state AS state FROM clubs
     WHERE home_state IS NOT NULL ORDER BY state
  `;
  return rows.map((r) => r.state);
}

async function fetchClub(slug: string): Promise<ClubSummary | null> {
  const [row] = await sql<ClubSummary[]>`
    SELECT c.id, c.slug, c.name, c.short_name AS "shortName",
           c.abbreviation, c.is_current_afl_club AS "isCurrent",
           c.succession::text, c.first_season AS "firstSeason",
           c.last_season AS "lastSeason", c.home_state AS "homeState",
           c.current_identity_id AS "currentIdentityId",
           ci.name AS "currentIdentityName", ci.slug AS "currentIdentitySlug",
           succ.relation AS "successorRelation",
           succ.name     AS "successorName",
           succ.slug     AS "successorSlug",
           succ.effective_season AS "successorSeason",
           c.notes
      FROM clubs c
      JOIN clubs ci ON ci.id = c.current_identity_id
      ${CLUB_SUCCESSOR}
     WHERE c.slug = ${slug}
  `;
  return row ?? null;
}

export type ClubLineageRow = {
  id: number;
  name: string;
  slug: string;
  firstSeason: number | null;
  lastSeason: number | null;
  isSelf: boolean;
};

/**
 * The other names this club has traded under.
 *
 * Same organization only — this is a rename, so the seasons are
 * genuinely continuous and belong to one club's record.
 */
export async function getClubLineage(clubId: number): Promise<ClubLineageRow[]> {
  return sql<ClubLineageRow[]>`
    SELECT c.id, c.name, c.slug,
           c.first_season AS "firstSeason", c.last_season AS "lastSeason",
           (c.id = ${clubId}) AS "isSelf"
      FROM clubs c
     WHERE c.organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
     ORDER BY c.first_season
  `;
}

export type ClubRelationRow = {
  relation: string;
  direction: 'from' | 'to';
  name: string | null;
  slug: string | null;
  effectiveSeason: number | null;
  notes: string | null;
};

/**
 * Links to OTHER organizations — mergers, not renames.
 *
 * Kept separate from lineage on purpose. Fitzroy merged into Brisbane
 * Lions in 1997, but Fitzroy's 100 seasons remain Fitzroy's: the link is
 * navigable without the statistics being combined.
 */
export async function getClubRelations(clubId: number): Promise<ClubRelationRow[]> {
  return sql<ClubRelationRow[]>`
    WITH org AS (SELECT organization_id AS id FROM clubs WHERE id = ${clubId})
    SELECT r.relation::text, 'from' AS direction,
           t.name, t.slug,
           r.effective_season AS "effectiveSeason", r.notes
      FROM club_organization_relations r
      LEFT JOIN club_organizations t ON t.id = r.to_organization_id
     WHERE r.from_organization_id = (SELECT id FROM org)
    UNION ALL
    SELECT r.relation::text, 'to' AS direction,
           f.name, f.slug,
           r.effective_season AS "effectiveSeason", r.notes
      FROM club_organization_relations r
      JOIN club_organizations f ON f.id = r.from_organization_id
     WHERE r.to_organization_id = (SELECT id FROM org)
     ORDER BY 1, 3
  `;
}

export type ClubTotals = {
  seasons: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  premierships: number;
  woodenSpoons: number;
  finalsAppearances: number;
};

/**
 * Every identity in one club's lineage.
 *
 * A rename does not start a new club, so the club record spans the whole
 * organization: Footscray's 72 seasons and Western Bulldogs' 30 are one
 * club's 102. A merger is not a rename and never reaches this set —
 * Fitzroy and Brisbane Bears are their own organizations, so nothing of
 * theirs is counted towards Brisbane Lions.
 */
const LINEAGE_IDS = (clubId: number) => sql`
  SELECT id FROM clubs
   WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
`;

/**
 * The club's whole record, across every name it has traded under.
 *
 * Identical for every identity in a lineage: /clubs/footscray and
 * /clubs/western-bulldogs report the same club, so they report the same
 * totals. Era-scoped figures come from getClubSeasons.
 */
export async function getClubTotals(clubId: number): Promise<ClubTotals> {
  const [row] = await sql<ClubTotals[]>`
    SELECT count(*)::int                                   AS seasons,
           COALESCE(sum(played), 0)::int                   AS played,
           COALESCE(sum(wins), 0)::int                     AS wins,
           COALESCE(sum(draws), 0)::int                    AS draws,
           COALESCE(sum(losses), 0)::int                   AS losses,
           count(*) FILTER (WHERE is_premier)::int         AS premierships,
           count(*) FILTER (WHERE wooden_spoon)::int       AS "woodenSpoons",
           COALESCE(sum(finals_played), 0)::int            AS "finalsAppearances"
      FROM club_seasons
     WHERE club_id IN (${LINEAGE_IDS(clubId)})
  `;
  return row ?? {
    seasons: 0, played: 0, wins: 0, draws: 0, losses: 0,
    premierships: 0, woodenSpoons: 0, finalsAppearances: 0,
  };
}

/** The same totals for one era only, used to caption a lineage page. */
export async function getClubEraTotals(clubId: number): Promise<ClubTotals> {
  const [row] = await sql<ClubTotals[]>`
    SELECT count(*)::int                                   AS seasons,
           COALESCE(sum(played), 0)::int                   AS played,
           COALESCE(sum(wins), 0)::int                     AS wins,
           COALESCE(sum(draws), 0)::int                    AS draws,
           COALESCE(sum(losses), 0)::int                   AS losses,
           count(*) FILTER (WHERE is_premier)::int         AS premierships,
           count(*) FILTER (WHERE wooden_spoon)::int       AS "woodenSpoons",
           COALESCE(sum(finals_played), 0)::int            AS "finalsAppearances"
      FROM club_seasons
     WHERE club_id = ${clubId}
  `;
  return row ?? {
    seasons: 0, played: 0, wins: 0, draws: 0, losses: 0,
    premierships: 0, woodenSpoons: 0, finalsAppearances: 0,
  };
}

export type ClubSeasonRow = {
  season: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  percentage: string | null;
  ladderRank: number | null;
  isPremier: boolean;
  woodenSpoon: boolean;
  finalsPlayed: number | null;
  /** 'in_progress' means every figure on this row is provisional. */
  seasonStatus: string;
  dataThroughDate: Date | null;
  /** The name the club traded under that season. */
  identityName: string;
  identitySlug: string;
};

/**
 * Season-by-season results.
 *
 * `scope: 'era'` covers only the identity asked for; `'lineage'` covers
 * every name the club has traded under. The era is the default because a
 * page titled "Footscray" listing 2016 would be wrong, but the whole
 * record is one link away and both agree with the headline totals.
 */
export async function getClubSeasons(
  clubId: number,
  scope: 'era' | 'lineage' = 'era',
): Promise<ClubSeasonRow[]> {
  return sql<ClubSeasonRow[]>`
    SELECT cs.season, cs.played, cs.wins, cs.draws, cs.losses,
           cs.points_for AS "pointsFor", cs.points_against AS "pointsAgainst",
           cs.percentage, cs.ladder_rank AS "ladderRank",
           cs.is_premier AS "isPremier", cs.wooden_spoon AS "woodenSpoon",
           cs.finals_played AS "finalsPlayed",
           se.status AS "seasonStatus",
           se.data_through_date AS "dataThroughDate",
           ci.name AS "identityName", ci.slug AS "identitySlug"
      FROM club_seasons cs
      JOIN seasons se ON se.year = cs.season
      JOIN clubs ci ON ci.id = cs.club_id
     WHERE cs.club_id ${scope === 'lineage'
        ? sql`IN (${LINEAGE_IDS(clubId)})`
        : sql`= ${clubId}`}
     ORDER BY cs.season DESC
  `;
}

/**
 * Games and goals leaders across the club's whole lineage.
 *
 * player_clubs is per identity, so Brad Johnson holds separate Footscray
 * and Western Bulldogs rows. Summing them by organization is what makes
 * him a 364-game one-club player rather than two part-careers ranked
 * below players who did less.
 */
function clubLeaders(clubId: number, order: 'games' | 'goals', limit: number) {
  return sql<{
    id: number; slug: string; displayName: string;
    games: number; goals: number; firstSeason: number; lastSeason: number;
  }[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           sum(pc.games)::int AS games,
           sum(pc.goals)::int AS goals,
           min(pc.first_season)::int AS "firstSeason",
           max(pc.last_season)::int  AS "lastSeason"
      FROM player_clubs pc
      JOIN players p ON p.id = pc.player_id
     WHERE pc.club_id IN (${LINEAGE_IDS(clubId)})
     GROUP BY p.id, p.slug, p.display_name
     ORDER BY ${order === 'games'
        ? sql`sum(pc.games) DESC, sum(pc.goals) DESC`
        : sql`sum(pc.goals) DESC, sum(pc.games) DESC`}, p.display_name
     LIMIT ${limit}
  `;
}

export async function getClubLeaders(clubId: number, limit = 15) {
  return clubLeaders(clubId, 'games', limit);
}

export async function getClubGoalkickers(clubId: number, limit = 15) {
  return clubLeaders(clubId, 'goals', limit);
}

export type ClubPremiershipRow = {
  matchId: number;
  year: number;
  matchDate: Date | null;
  /** matches.attendance — null where the crowd was never recorded, never zero-filled. */
  crowd: number | null;
  /** The premiership club's Grand Final score. */
  clubScore: number;
  /** The beaten club's Grand Final score. */
  opponentScore: number;
  opponentId: number;
  opponentName: string;
  opponentSlug: string;
  venueId: number | null;
  /** Canonical venue name, or the raw match venue string when unlinked. */
  venueName: string;
  /** Non-null only when the venue resolves to a canonical /venues/[slug] page. */
  venueSlug: string | null;
};

/**
 * Every VFL/AFL premiership this club has won — one row per won Grand
 * Final, newest first (AFLDB-ISSUE-148).
 *
 * A premiership is a Grand Final that the club won:
 * `matches.round_type = 'grand_final'` (the canonical predicate
 * {@link getCoachCareer} and the Grid Solver's `grand_final_*` builders
 * use — NOT every final, and never a Wildcard Final, which is
 * `round_type = 'wildcard_final'`) with `winner_club_id` in the club's
 * lineage. A drawn Grand Final has a null `winner_club_id`, so it is
 * excluded here and the following week's replay — which has a winner — is
 * the premiership row.
 *
 * Lineage-scoped by `organization_id` via {@link LINEAGE_IDS}, exactly
 * like {@link getClubTotals} and {@link getClubLeaders}: /clubs/footscray
 * and /clubs/western-bulldogs are one club, so both list 1954 and 2016.
 * The rows are derived from canonical `matches` — there is no hand-kept
 * list of premiership years — and the count matches the `is_premier`
 * figure in the page's headline totals.
 *
 * Opponent, score, venue and crowd are read straight off the Grand Final
 * match: the opponent is whichever club was not the winner (home or
 * away), and the score is shown from the winner's perspective. A club
 * with no premierships returns `[]`.
 */
export async function getClubPremierships(clubId: number): Promise<ClubPremiershipRow[]> {
  return sql<ClubPremiershipRow[]>`
    SELECT m.id      AS "matchId",
           m.season  AS year,
           m.match_date AS "matchDate",
           m.attendance AS crowd,
           CASE WHEN m.home_club_id = m.winner_club_id THEN m.home_score ELSE m.away_score END AS "clubScore",
           CASE WHEN m.home_club_id = m.winner_club_id THEN m.away_score ELSE m.home_score END AS "opponentScore",
           opp.id   AS "opponentId",
           opp.name AS "opponentName",
           opp.slug AS "opponentSlug",
           m.venue_id AS "venueId",
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           v.slug   AS "venueSlug"
      FROM matches m
      JOIN clubs opp ON opp.id = CASE
             WHEN m.home_club_id = m.winner_club_id THEN m.away_club_id
             ELSE m.home_club_id
           END
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE m.round_type = 'grand_final'
       AND m.winner_club_id IN (${LINEAGE_IDS(clubId)})
     ORDER BY m.season DESC, m.match_date DESC
  `;
}

/**
 * Deduplicated per request.
 *
 * generateMetadata and the page body both need this row, and neither can
 * hand it to the other — Next calls them separately. Without React's
 * cache() that is two identical queries for every render of an entity
 * page, doubling the cost of the pages a crawler spends most of its time
 * on. Outside a request scope cache() calls straight through, so the
 * import tools and the test suite are unaffected.
 */
export const getClub = cache(fetchClub);
