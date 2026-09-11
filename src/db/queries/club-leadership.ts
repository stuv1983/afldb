import 'server-only';

import { sql } from '@/db/client';
import { FIRST_LIST_SEASON } from '@/db/queries/admin-season-lists';

/**
 * Public club leadership reads (AFLDB-ISSUE-163 §8, §20).
 *
 * Everything here runs on the PUBLIC client against `club_leadership`, which
 * migration 098 grants `afldb_app` SELECT on. Nothing here reads
 * `data_overrides`, calls an admin mutation, or writes anything.
 *
 * THE SEASON BOUNDARY IS THE WHOLE DESIGN (§3, §20.3, operator clarification
 * 2026-09-12). AFLDB holds two captaincy sources and they must never both
 * answer one season:
 *
 *     season <  FIRST_LEADERSHIP_SEASON   captaincies      (Wikipedia honours)
 *     season >= FIRST_LEADERSHIP_SEASON   club_leadership  (canonical registry)
 *
 * The boundary is built INTO the queries — each source is filtered by season
 * before the union — rather than applied afterwards as a de-duplication by
 * name. A name-based dedupe would be exactly the "names decide identity" rule
 * AFLDB forbids, and it would silently drop a real co-captain who happens to
 * share a season with a legacy row. `captaincies` is untouched by this issue
 * and `captaincies.py` is pinned at `MAX_SEASON = 2026` by a source-contract
 * test, so the CSV can never start answering a season this table owns.
 *
 * CURRENT IS A STATUS, NEVER A CLOCK (§8, D-4). The leadership season shown for
 * a club is `max(season)` over its ORGANISATION's non-void rows — data-derived,
 * with no `now()`, no reference-register lookup and no configuration value —
 * and the holders are that season's `active` rows. 2027 appointments entered in
 * the 2026 off-season therefore make 2027 the leadership season immediately,
 * which is the real-world truth ("Richmond's captain for 2027 is ..."); the
 * caller renders the season in the label, so it can never be mistaken for a
 * statement about a different one.
 *
 * ORGANISATION-SCOPED (§8). Every read spans `clubs.organization_id`, so a
 * rename inside a lineage never splits the answer and a historical era page and
 * the continuing identity agree about what the club's history was.
 *
 * VOID IS NOT HISTORY. A voided row never appears as leadership anywhere — not
 * as current, not in the history union, not in player honours. An ENDED row is
 * kept and shown as history, because it happened.
 */

/**
 * The first season canonical `club_leadership` answers — the ONE boundary both
 * public projections and the writer use.
 *
 * Derived from `FIRST_LIST_SEASON` rather than re-typed as a literal: an
 * appointment's precondition IS the season-list place (§9), so leadership can
 * never begin before the lists do, and one constant makes that structural
 * instead of a coincidence two files have to keep agreeing about. The import
 * is a single number — nothing here reaches into season-list mutation,
 * override or audit code (§20.4).
 */
export const FIRST_LEADERSHIP_SEASON = FIRST_LIST_SEASON;

export type ClubLeader = {
  playerId: number;
  playerSlug: string;
  displayName: string;
  /** The date the appointment took effect, when it is known. NULL = unknown. */
  startedOn: string | null;
};

export type ClubCurrentLeadership = {
  /** The season this leadership is FOR. Always rendered, never assumed. */
  season: number;
  /** Zero, one, or — for a co-captaincy — several. Alphabetical: the office has no precedence. */
  captains: ClubLeader[];
  viceCaptains: ClubLeader[];
};

/**
 * The club's current leadership, or `null` when there is none to state.
 *
 * `null` covers two genuinely different-looking situations that AFLDB cannot
 * tell apart and must not pretend to: the organisation has no appointment on
 * record at all, and its latest season's appointments have all ended with no
 * replacement yet. "Vacant" and "unknown" are indistinguishable here because
 * neither is stored, so the caller omits the block rather than inventing a
 * word for it (the club page's existing convention for empty captains, coaches
 * and best-and-fairest sections).
 *
 * A captain who has ended with vice-captains still active returns a result with
 * an EMPTY `captains` array — which is a true statement, and a different one
 * from `null`.
 */
export async function getClubCurrentLeadership(
  clubId: number,
): Promise<ClubCurrentLeadership | null> {
  const rows = await sql<{
    season: number; role: 'captain' | 'vice_captain';
    playerId: number; playerSlug: string; displayName: string; startedOn: string | null;
  }[]>`
    WITH lineage AS (
      SELECT id FROM clubs
       WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
    ),
    -- The leadership season: data-derived, never a clock. Void rows are
    -- excluded here too, so a season whose ONLY row was entered in error can
    -- never become the season the page reports.
    current_season AS (
      SELECT max(l.season)::int AS season
        FROM club_leadership l
       WHERE l.club_id IN (SELECT id FROM lineage) AND l.status <> 'void'
    )
    SELECT l.season::int AS season, l.role,
           l.player_id AS "playerId", p.slug AS "playerSlug", p.display_name AS "displayName",
           l.started_on::text AS "startedOn"
      FROM club_leadership l
      JOIN players p ON p.id = l.player_id
     WHERE l.club_id IN (SELECT id FROM lineage)
       AND l.season = (SELECT season FROM current_season)
       AND l.status = 'active'
     ORDER BY l.role, p.display_name
  `;
  if (rows.length === 0) return null;

  const toLeader = (row: (typeof rows)[number]): ClubLeader => ({
    playerId: row.playerId,
    playerSlug: row.playerSlug,
    displayName: row.displayName,
    startedOn: row.startedOn,
  });
  return {
    season: rows[0].season,
    captains: rows.filter((r) => r.role === 'captain').map(toLeader),
    viceCaptains: rows.filter((r) => r.role === 'vice_captain').map(toLeader),
  };
}

/*
 * PLAYER HONOURS (operator clarification 4, 2026-09-12). The canonical half of
 * a player's captaincy honours is NOT a separate function here: it lives inside
 * `getPlayerHonours()` in `src/db/queries/awards.ts`, as a UNION branch of the
 * same query, filtered by the same boundary.
 *
 * That is deliberate. The honours list is one list with one vocabulary, and the
 * only way to guarantee the two halves can never disagree about the boundary —
 * leaving a 2027+ hole, or double-counting a season — is for one query to own
 * both. A second copy of the canonical SELECT here would be a second place for
 * the boundary to drift.
 *
 * Stage 2 needs NO change for 2027+ captaincies to render: the player page
 * groups `honours.captaincies` by club slug and never reads `role`, so the
 * canonical rows (rendered with the same 'Captain' literal the legacy table
 * stores) appear exactly as legacy ones do.
 */
