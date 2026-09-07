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
 * Every match involving any identity in the club's lineage, oriented to
 * the club's own perspective — `club_score` / `opponent_score` /
 * `opponent_id` are the club's and the other side's regardless of which
 * of them was the home team, so a record can be read the same way whether
 * the club was home or away.
 *
 * Lineage-scoped by `organization_id` (see {@link LINEAGE_IDS}), exactly
 * like {@link getClubTotals} and {@link getClubPremierships}: a merger is
 * a different organisation and never enters this set, so nothing of
 * Fitzroy's counts towards Brisbane Lions. Two identities of one club
 * never met, so `home`/`away` in lineage is unambiguous.
 *
 * `attendanceRecorded` drops the ~1,650 matches with a null
 * `matches.attendance` — those are "not recorded", never a zero crowd —
 * and is used only by the crowd-record query.
 */
const CLUB_MATCHES_CTE = (clubId: number, attendanceRecorded = false) => sql`
  lineage AS (${LINEAGE_IDS(clubId)}),
  club_matches AS (
    SELECT m.id                    AS match_id,
           m.season,
           m.match_date,
           m.attendance,
           m.round_type::text      AS round_type,
           m.round_number,
           m.is_finals_series,
           CASE WHEN m.home_club_id IN (SELECT id FROM lineage)
                THEN m.home_score ELSE m.away_score END AS club_score,
           CASE WHEN m.home_club_id IN (SELECT id FROM lineage)
                THEN m.away_score ELSE m.home_score END AS opponent_score,
           CASE WHEN m.home_club_id IN (SELECT id FROM lineage)
                THEN m.away_club_id ELSE m.home_club_id END AS opponent_id,
           COALESCE(v.canonical_name, m.venue_raw) AS venue_name,
           v.slug AS venue_slug
      FROM matches m
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE (m.home_club_id IN (SELECT id FROM lineage)
         OR m.away_club_id IN (SELECT id FROM lineage))
       ${attendanceRecorded ? sql`AND m.attendance IS NOT NULL` : sql``}
  )
`;

/** Columns shared by the club-record and crowd-record result rows. */
const CLUB_MATCH_RECORD_COLUMNS = sql`
  cm.match_id     AS "matchId",
  cm.season,
  cm.match_date   AS "matchDate",
  cm.attendance   AS crowd,
  cm.round_type   AS "roundType",
  cm.round_number AS "roundNumber",
  cm.club_score       AS "clubScore",
  cm.opponent_score   AS "opponentScore",
  opp.id   AS "opponentId",
  opp.name AS "opponentName",
  opp.slug AS "opponentSlug",
  cm.venue_name AS "venueName",
  cm.venue_slug AS "venueSlug"
`;

export type ClubMatchRecordKind =
  | 'biggest_win'
  | 'biggest_loss'
  | 'highest_score'
  | 'lowest_score'
  | 'highest_scoring_match'
  | 'lowest_scoring_match';

export type ClubMatchRecordRow = {
  kind: ClubMatchRecordKind;
  /** Margin for win/loss; a single club score; a combined match score. */
  value: number;
  matchId: number;
  season: number;
  matchDate: Date | null;
  /** matches.attendance — null where the crowd was never recorded, never zero. */
  crowd: number | null;
  roundType: string;
  roundNumber: number | null;
  /** The club's own score, whichever side of the match it was. */
  clubScore: number;
  opponentScore: number;
  opponentId: number;
  opponentName: string;
  opponentSlug: string;
  venueName: string;
  venueSlug: string | null;
};

const MATCH_RECORD_ORDER: ClubMatchRecordKind[] = [
  'biggest_win', 'biggest_loss', 'highest_score', 'lowest_score',
  'highest_scoring_match', 'lowest_scoring_match',
];

/**
 * The club's headline match records, across every era of the club — one
 * deterministic row per record (AFLDB-ISSUE-149).
 *
 * - **biggest_win / biggest_loss** — largest winning / losing margin, from
 *   the club's perspective.
 * - **highest_score / lowest_score** — the club's own highest / lowest
 *   score in a match (NOT the combined total).
 * - **highest_scoring_match / lowest_scoring_match** — largest / smallest
 *   COMBINED score of both sides in a match involving the club (NOT the
 *   club's own score).
 *
 * `matches.home_score` / `away_score` are `NOT NULL` for every match, so
 * there is no "unrecorded score" case to exclude. Where several matches
 * share a record value, one is chosen deterministically — the most recent
 * (`match_date DESC, match_id DESC`) — rather than returning an unstable
 * or unbounded tie set. A club with no matches returns `[]`.
 */
export async function getClubMatchRecords(clubId: number): Promise<ClubMatchRecordRow[]> {
  const rows = await sql<ClubMatchRecordRow[]>`
    WITH ${CLUB_MATCHES_CTE(clubId)},
    picks AS (
      (SELECT 'biggest_win'::text AS kind, match_id, (club_score - opponent_score) AS value
         FROM club_matches WHERE club_score > opponent_score
        ORDER BY (club_score - opponent_score) DESC, match_date DESC, match_id DESC LIMIT 1)
      UNION ALL
      (SELECT 'biggest_loss', match_id, (opponent_score - club_score)
         FROM club_matches WHERE opponent_score > club_score
        ORDER BY (opponent_score - club_score) DESC, match_date DESC, match_id DESC LIMIT 1)
      UNION ALL
      (SELECT 'highest_score', match_id, club_score
         FROM club_matches
        ORDER BY club_score DESC, match_date DESC, match_id DESC LIMIT 1)
      UNION ALL
      (SELECT 'lowest_score', match_id, club_score
         FROM club_matches
        ORDER BY club_score ASC, match_date DESC, match_id DESC LIMIT 1)
      UNION ALL
      (SELECT 'highest_scoring_match', match_id, (club_score + opponent_score)
         FROM club_matches
        ORDER BY (club_score + opponent_score) DESC, match_date DESC, match_id DESC LIMIT 1)
      UNION ALL
      (SELECT 'lowest_scoring_match', match_id, (club_score + opponent_score)
         FROM club_matches
        ORDER BY (club_score + opponent_score) ASC, match_date DESC, match_id DESC LIMIT 1)
    )
    SELECT p.kind, p.value::int AS value, ${CLUB_MATCH_RECORD_COLUMNS}
      FROM picks p
      JOIN club_matches cm ON cm.match_id = p.match_id
      JOIN clubs opp ON opp.id = cm.opponent_id
     ORDER BY array_position(
       ARRAY['biggest_win','biggest_loss','highest_score','lowest_score','highest_scoring_match','lowest_scoring_match']::text[],
       p.kind)
  `;
  // Keep a stable, known order even if a branch produced no row.
  return [...rows].sort(
    (a, b) => MATCH_RECORD_ORDER.indexOf(a.kind) - MATCH_RECORD_ORDER.indexOf(b.kind),
  );
}

export type ClubCrowdRecordKind =
  | 'record_home_and_away'
  | 'record_finals'
  | 'record_grand_final';

export type ClubCrowdRecordRow = {
  kind: ClubCrowdRecordKind | 'top';
  matchId: number;
  season: number;
  matchDate: Date | null;
  /** Always a real recorded figure here — null attendance is filtered out. */
  crowd: number;
  roundType: string;
  roundNumber: number | null;
  clubScore: number;
  opponentScore: number;
  opponentId: number;
  opponentName: string;
  opponentSlug: string;
  venueName: string;
  venueSlug: string | null;
};

const CROWD_RECORD_ORDER: ClubCrowdRecordKind[] = [
  'record_home_and_away', 'record_finals', 'record_grand_final',
];

/**
 * The club's attendance records, across every era of the club
 * (AFLDB-ISSUE-149).
 *
 * `records` holds one deterministic row each for the highest home-and-away
 * crowd (`round_type = 'home_and_away'`), the highest finals crowd
 * (`is_finals_series` — the canonical finals-series predicate, which
 * excludes a Wildcard Final) and the highest Grand Final crowd
 * (`round_type = 'grand_final'`, the same predicate {@link getClubPremierships}
 * uses). `top` holds the five largest crowds at any match involving the
 * club. Both are ordered `attendance DESC, match_date DESC, match_id DESC`,
 * so ties resolve deterministically.
 *
 * Matches with a null `matches.attendance` are excluded everywhere here —
 * a crowd that was never recorded is not a small crowd. A club that has
 * never played a match of a given kind simply has no row for it.
 */
export async function getClubCrowdRecords(clubId: number): Promise<{
  records: ClubCrowdRecordRow[];
  top: ClubCrowdRecordRow[];
}> {
  const [records, top] = await Promise.all([
    sql<ClubCrowdRecordRow[]>`
      WITH ${CLUB_MATCHES_CTE(clubId, true)},
      picks AS (
        (SELECT 'record_home_and_away'::text AS kind, match_id
           FROM club_matches WHERE round_type = 'home_and_away'
          ORDER BY attendance DESC, match_date DESC, match_id DESC LIMIT 1)
        UNION ALL
        (SELECT 'record_finals', match_id
           FROM club_matches WHERE is_finals_series IS TRUE
          ORDER BY attendance DESC, match_date DESC, match_id DESC LIMIT 1)
        UNION ALL
        (SELECT 'record_grand_final', match_id
           FROM club_matches WHERE round_type = 'grand_final'
          ORDER BY attendance DESC, match_date DESC, match_id DESC LIMIT 1)
      )
      SELECT p.kind, ${CLUB_MATCH_RECORD_COLUMNS}
        FROM picks p
        JOIN club_matches cm ON cm.match_id = p.match_id
        JOIN clubs opp ON opp.id = cm.opponent_id
    `,
    sql<ClubCrowdRecordRow[]>`
      WITH ${CLUB_MATCHES_CTE(clubId, true)}
      SELECT 'top'::text AS kind, ${CLUB_MATCH_RECORD_COLUMNS}
        FROM club_matches cm
        JOIN clubs opp ON opp.id = cm.opponent_id
       ORDER BY cm.attendance DESC, cm.match_date DESC, cm.match_id DESC
       LIMIT 5
    `,
  ]);
  return {
    records: [...records].sort(
      (a, b) => CROWD_RECORD_ORDER.indexOf(a.kind as ClubCrowdRecordKind)
        - CROWD_RECORD_ORDER.indexOf(b.kind as ClubCrowdRecordKind),
    ),
    top,
  };
}

export type ClubPlayerRow = {
  id: number;
  slug: string;
  displayName: string;
  /** Games for THIS club's lineage only — never a whole-career total. */
  games: number;
  goals: number;
  firstSeason: number;
  lastSeason: number;
};

/**
 * Every player who has represented the club, across every era of it —
 * the complete historical list, not a Top-N leaderboard
 * (AFLDB-ISSUE-149).
 *
 * Read straight from the canonical `player_clubs` aggregate (one row per
 * player per club identity), summed by `organization_id` so a player who
 * served under two names of one club — Brad Johnson at Footscray and the
 * Western Bulldogs — is one row with the combined total, exactly like
 * {@link getClubLeaders}. `games` / `goals` are this club's only; the
 * same player on another club's page shows that club's figures. A player
 * who played for a different organisation contributes nothing here.
 *
 * Ordered games then goals then name then id, so the default view is
 * deterministic; the page lets the reader re-sort it.
 */
export async function getClubPlayers(clubId: number): Promise<ClubPlayerRow[]> {
  return sql<ClubPlayerRow[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           sum(pc.games)::int AS games,
           sum(pc.goals)::int AS goals,
           min(pc.first_season)::int AS "firstSeason",
           max(pc.last_season)::int  AS "lastSeason"
      FROM player_clubs pc
      JOIN players p ON p.id = pc.player_id
     WHERE pc.club_id IN (${LINEAGE_IDS(clubId)})
     GROUP BY p.id, p.slug, p.display_name
     ORDER BY sum(pc.games) DESC, sum(pc.goals) DESC, p.display_name, p.id
  `;
}

export type ClubPremiershipPlayerRow = {
  season: number;
  playerId: number;
  playerSlug: string;
  playerName: string;
  games: number;
  finals: number;
  /** player_club_season_stats.goals — nullable in a season with no goal data. */
  goals: number | null;
  /** The name the club traded under that premiership season. */
  identityName: string;
};

/**
 * The club's premiership players, grouped by premiership season, newest
 * first (AFLDB-ISSUE-149).
 *
 * Canonical attribution: `player_club_season_stats.is_premier` — a
 * per-player-per-club-per-season flag — filtered to the club's lineage.
 * A player who won flags in more than one season appears once per season.
 * `player_club_season_stats.player_id` is `NOT NULL`, so every row links
 * to a real player.
 *
 * The set of premiership SEASONS this returns is expected to agree with
 * {@link getClubPremierships} (won Grand Finals) for every era both
 * datasets cover; `tests/integration/club-premiership-players.test.ts`
 * asserts that and would surface any divergence rather than hiding it.
 */
export async function getClubPremiershipPlayers(
  clubId: number,
): Promise<ClubPremiershipPlayerRow[]> {
  return sql<ClubPremiershipPlayerRow[]>`
    SELECT s.season,
           s.player_id AS "playerId",
           p.slug      AS "playerSlug",
           p.display_name AS "playerName",
           s.games, s.finals, s.goals,
           ci.name AS "identityName"
      FROM player_club_season_stats s
      JOIN players p ON p.id = s.player_id
      JOIN clubs ci ON ci.id = s.club_id
     WHERE s.is_premier = true
       AND s.club_id IN (${LINEAGE_IDS(clubId)})
     ORDER BY s.season DESC, s.games DESC, p.display_name, s.player_id
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
