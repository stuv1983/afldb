import 'server-only';

import { sql } from '@/db/client';

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

export async function listClubs(): Promise<ClubSummary[]> {
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
     ORDER BY c.is_current_afl_club DESC, c.name
  `;
}

export async function getClub(slug: string): Promise<ClubSummary | null> {
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
};

export async function getClubSeasons(clubId: number): Promise<ClubSeasonRow[]> {
  return sql<ClubSeasonRow[]>`
    SELECT cs.season, cs.played, cs.wins, cs.draws, cs.losses,
           cs.points_for AS "pointsFor", cs.points_against AS "pointsAgainst",
           cs.percentage, cs.ladder_rank AS "ladderRank",
           cs.is_premier AS "isPremier", cs.wooden_spoon AS "woodenSpoon",
           cs.finals_played AS "finalsPlayed",
           se.status AS "seasonStatus",
           se.data_through_date AS "dataThroughDate"
      FROM club_seasons cs
      JOIN seasons se ON se.year = cs.season
     WHERE cs.club_id = ${clubId}
     ORDER BY cs.season DESC
  `;
}

/** Games and goals leaders for a club. */
export async function getClubLeaders(clubId: number, limit = 15) {
  return sql<{
    id: number; slug: string; displayName: string;
    games: number; goals: number; firstSeason: number; lastSeason: number;
  }[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           pc.games, pc.goals,
           pc.first_season AS "firstSeason", pc.last_season AS "lastSeason"
      FROM player_clubs pc
      JOIN players p ON p.id = pc.player_id
     WHERE pc.club_id = ${clubId}
     ORDER BY pc.games DESC, pc.goals DESC
     LIMIT ${limit}
  `;
}

export async function getClubGoalkickers(clubId: number, limit = 15) {
  return sql<{
    id: number; slug: string; displayName: string;
    games: number; goals: number; firstSeason: number; lastSeason: number;
  }[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           pc.games, pc.goals,
           pc.first_season AS "firstSeason", pc.last_season AS "lastSeason"
      FROM player_clubs pc
      JOIN players p ON p.id = pc.player_id
     WHERE pc.club_id = ${clubId}
     ORDER BY pc.goals DESC, pc.games DESC
     LIMIT ${limit}
  `;
}
