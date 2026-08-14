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
  notes: string | null;
};

export async function listClubs(): Promise<ClubSummary[]> {
  return sql<ClubSummary[]>`
    SELECT c.id, c.slug, c.name, c.short_name AS "shortName",
           c.abbreviation, c.is_current_afl_club AS "isCurrent",
           c.succession::text, c.first_season AS "firstSeason",
           c.last_season AS "lastSeason", c.home_state AS "homeState",
           c.current_identity_id AS "currentIdentityId",
           ci.name AS "currentIdentityName", ci.slug AS "currentIdentitySlug",
           c.notes
      FROM clubs c
      JOIN clubs ci ON ci.id = c.current_identity_id
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
           c.notes
      FROM clubs c
      JOIN clubs ci ON ci.id = c.current_identity_id
     WHERE c.slug = ${slug}
  `;
  return row ?? null;
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
