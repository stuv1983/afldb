import 'server-only';

import postgres from 'postgres';
import { sql } from '@/db/client';
import { recordDataEdit } from '@/db/queries/audit-log';
import {
  clearPlayerClubMatchReferences,
  recomputeClubSeasons,
  recomputePlayerDerivedStats,
  recomputeSeasonBrownlowStatus,
  recomputeSeasonMetadata,
} from '@/db/queries/player-derived';
import { validateAdminMatchNumbers } from '@/lib/admin-match';

export type QuarterScoreInput = {
  goals?: number | null;
  behinds?: number | null;
  points?: number | null;
};

export type AdminMatchSummary = {
  id: number;
  season: number;
  roundType: string;
  roundNumber: number | null;
  roundCode: string;
  matchDate: Date;
  homeClubId: number;
  homeName: string;
  homeSlug: string;
  awayClubId: number;
  awayName: string;
  awaySlug: string;
  homeGoals: number | null;
  homeBehinds: number | null;
  homeScore: number;
  awayGoals: number | null;
  awayBehinds: number | null;
  awayScore: number;
  margin: number;
  result: string;
  venueName: string;
  attendance: number | null;
  playerCount: number;
};

/**
 * Super Admin: Search and browse matches with filters (season, club, round, query)
 * and player lineup counts (see changeLog.md).
 */
export async function searchAdminMatches(options: {
  season?: number | null;
  clubId?: number | null;
  roundNumber?: number | null;
  query?: string | null;
  limit?: number;
}): Promise<{ rows: AdminMatchSummary[]; total: number }> {
  const limit = options.limit ?? 30;
  const whereClauses = [
    options.season ? sql`m.season = ${options.season}` : sql`true`,
    options.clubId ? sql`(m.home_club_id = ${options.clubId} OR m.away_club_id = ${options.clubId})` : sql`true`,
    options.roundNumber ? sql`m.round_number = ${options.roundNumber}` : sql`true`,
    options.query?.trim() ? sql`(h.name ILIKE ${'%' + options.query.trim() + '%'} OR a.name ILIKE ${'%' + options.query.trim() + '%'} OR COALESCE(v.canonical_name, m.venue_raw) ILIKE ${'%' + options.query.trim() + '%'})` : sql`true`,
  ];

  const combinedWhere = sql`${whereClauses.reduce((acc, clause) => sql`${acc} AND ${clause}`)}`;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
      FROM matches m
      JOIN clubs h ON h.id = m.home_club_id
      JOIN clubs a ON a.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE ${combinedWhere}
  `;

  const rows = await sql<AdminMatchSummary[]>`
    SELECT m.id, m.season, m.round_type AS "roundType",
           m.round_number AS "roundNumber", m.round_code AS "roundCode",
           m.match_date AS "matchDate",
           m.home_club_id AS "homeClubId", h.name AS "homeName", h.slug AS "homeSlug",
           m.away_club_id AS "awayClubId", a.name AS "awayName", a.slug AS "awaySlug",
           m.home_goals AS "homeGoals", m.home_behinds AS "homeBehinds", m.home_score AS "homeScore",
           m.away_goals AS "awayGoals", m.away_behinds AS "awayBehinds", m.away_score AS "awayScore",
           m.margin, m.result,
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           m.attendance,
           (SELECT count(*)::int FROM player_match_stats pms WHERE pms.match_id = m.id) AS "playerCount"
      FROM matches m
      JOIN clubs h ON h.id = m.home_club_id
      JOIN clubs a ON a.id = m.away_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE ${combinedWhere}
     ORDER BY m.match_date DESC, m.id DESC
     LIMIT ${limit}
  `;

  return { rows, total: countRow?.count ?? 0 };
}

export type CreateMatchInput = {
  season: number;
  roundType: 'home_and_away' | 'wildcard_final' | 'elimination_final' | 'qualifying_final' | 'semi_final' | 'preliminary_final' | 'grand_final';
  roundNumber?: number | null;
  roundCode?: string | null;
  matchDate: string; // YYYY-MM-DD
  matchTime?: string | null; // e.g. "19:40"
  venueId?: number | null;
  venueRaw?: string | null;
  homeClubId: number;
  awayClubId: number;
  homeGoals?: number | null;
  homeBehinds?: number | null;
  homeScore?: number | null;
  awayGoals?: number | null;
  awayBehinds?: number | null;
  awayScore?: number | null;
  attendance?: number | null;
  matchEvent?: string | null;
  notes?: string | null;
  homeQuarters?: Record<number, QuarterScoreInput> | null; // periods 1..4
  awayQuarters?: Record<number, QuarterScoreInput> | null; // periods 1..4
  adminUserId: number;
};

/**
 * Super Admin: Create a new match in the database (see changeLog.md).
 * Enables adding live/current season matches with venue, scores, quarter breakdowns,
 * followed by immediate lineup, player statistics and Brownlow votes entry in MatchSheetEditor.
 */
export async function createMatch(input: CreateMatchInput): Promise<{
  id: number;
  season: number;
}> {
  if (input.homeClubId === input.awayClubId) {
    throw new Error('Home club and away club must be different.');
  }
  const numericError = validateAdminMatchNumbers(input);
  if (numericError) throw new Error(numericError);

  const isFinal = input.roundType !== 'home_and_away';
  const roundNumber = isFinal ? null : (Number.isInteger(input.roundNumber) ? Number(input.roundNumber) : 1);

  let roundCode = (input.roundCode || '').trim().toUpperCase();
  if (!roundCode) {
    if (!isFinal) {
      roundCode = `R${roundNumber}`;
    } else {
      switch (input.roundType) {
        case 'grand_final': roundCode = 'GF'; break;
        case 'preliminary_final': roundCode = 'PF'; break;
        case 'semi_final': roundCode = 'SF'; break;
        case 'qualifying_final': roundCode = 'QF'; break;
        case 'elimination_final': roundCode = 'EF'; break;
        case 'wildcard_final': roundCode = 'WF'; break;
        default: roundCode = 'Final';
      }
    }
  }

  const homeGoals = input.homeGoals !== null && input.homeGoals !== undefined ? Number(input.homeGoals) : null;
  const homeBehinds = input.homeBehinds !== null && input.homeBehinds !== undefined ? Number(input.homeBehinds) : null;
  const homeScore = (homeGoals !== null && homeBehinds !== null)
    ? (homeGoals * 6 + homeBehinds)
    : Number(input.homeScore);

  const awayGoals = input.awayGoals !== null && input.awayGoals !== undefined ? Number(input.awayGoals) : null;
  const awayBehinds = input.awayBehinds !== null && input.awayBehinds !== undefined ? Number(input.awayBehinds) : null;
  const awayScore = (awayGoals !== null && awayBehinds !== null)
    ? (awayGoals * 6 + awayBehinds)
    : Number(input.awayScore);

  const margin = Math.abs(homeScore - awayScore);
  const result: 'home_win' | 'away_win' | 'draw' =
    homeScore > awayScore ? 'home_win' : (awayScore > homeScore ? 'away_win' : 'draw');
  const winnerClubId = result === 'home_win' ? input.homeClubId : (result === 'away_win' ? input.awayClubId : null);

  const attendance = (input.attendance !== null && input.attendance !== undefined && Number(input.attendance) >= 0)
    ? Number(input.attendance)
    : null;
  const attendanceStatus: 'complete' | 'not_collected' = attendance !== null ? 'complete' : 'not_collected';

  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const created = await importSql.begin(async (tx) => {
      // 1. Ensure season row exists
      const league = input.season >= 1990 ? 'AFL' : 'VFL';
      await tx`
        INSERT INTO seasons (year, league, status)
        VALUES (${input.season}, ${league}, 'in_progress'::season_status)
        ON CONFLICT (year) DO NOTHING
      `;

      const clubs = await tx<{ id: number; name: string; activeId: number | null }[]>`
        SELECT c.id, c.name,
               afldb_identity_for_season(c.organization_id, ${input.season}) AS "activeId"
          FROM clubs c
         WHERE c.id = ANY(${[input.homeClubId, input.awayClubId]})
      `;
      for (const clubId of [input.homeClubId, input.awayClubId]) {
        const club = clubs.find((candidate) => candidate.id === clubId);
        if (!club) throw new Error(`Club #${clubId} does not exist.`);
        if (club.activeId !== club.id) {
          throw new Error(`${club.name} is not the historical club identity active in ${input.season}.`);
        }
      }

      // 2. Resolve venue raw name
      let venueRaw = (input.venueRaw || '').trim();
      if (input.venueId) {
        const [v] = await tx<{ canonicalName: string }[]>`
          SELECT canonical_name AS "canonicalName" FROM venues WHERE id = ${input.venueId}
        `;
        if (v?.canonicalName) venueRaw = v.canonicalName;
      }
      if (!venueRaw) venueRaw = 'AFL Venue';

      // 3. Duplicate detection by canonical identity, not by match_key
      // string equality (AFLDB-ISSUE-182). match_key has three mutually
      // incompatible rendering schemes in this repository -- this admin
      // path renders club IDs, src/lib/ingest/datasets.ts renders club
      // NAMES, and src/lib/acquisition/canonical-apply.ts writes the
      // legacy/current-season bundle's own key verbatim (see that file's
      // header, ~L39-42 and ~L663-665: "createMatch() is deliberately not
      // reused ... a wrong rendering inserts a duplicate fixture instead of
      // conflicting"). A row for the SAME real match written under a
      // different scheme would not share this path's match_key, so
      // checking the string could silently admit a duplicate.
      //
      // round_code is not used either: it is free text with no DB-enforced
      // link back to round_number/round_type for `matches` (unlike
      // `fixtures`, which has fixtures_round_number_ck), and this
      // function's own blank-roundCode fallback below renders "R5" rather
      // than the decimal-string vocabulary every importer writes ("5") --
      // so two rows for the same real round can legitimately carry
      // different round_code text. round_type and round_number are both
      // DB-typed (an enum and a smallint, tied together for every writer by
      // matches_round_number_ck) and identical for the same real round
      // regardless of who wrote it, so they stand in for round_code here.
      //
      // Home/away order is compared exactly, not symmetrically: no
      // repository evidence supports treating a reversed pair as the same
      // match. admin-fixtures.ts's own read-time played resolution treats a
      // home/away swap as a distinct, surfaced condition
      // ("played_home_away_differs"), never as an equivalence to collapse.
      const matchKey = `${input.season}|${roundCode}|${input.matchDate}|${input.homeClubId}|${input.awayClubId}`;
      const [duplicate] = await tx<{ id: number }[]>`
        SELECT id FROM matches
         WHERE season = ${input.season}
           AND round_type = ${input.roundType}::round_type
           AND round_number IS NOT DISTINCT FROM ${roundNumber}
           AND match_date = ${input.matchDate}::date
           AND home_club_id = ${input.homeClubId}
           AND away_club_id = ${input.awayClubId}
      `;
      if (duplicate) {
        throw new Error(`Match #${duplicate.id} already exists for that season, round, date and clubs.`);
      }

      let attendanceSourceId: number | null = null;
      if (attendance !== null) {
        const [manualSource] = await tx<{ id: number }[]>`
          SELECT id FROM sources WHERE key = 'manual_admin_edit'
        `;
        if (!manualSource) {
          throw new Error('The manual_admin_edit provenance source is not configured.');
        }
        attendanceSourceId = manualSource.id;
      }

      // 4. Insert into matches
      const [matchRow] = await tx<{ id: number; season: number }[]>`
        INSERT INTO matches (
          match_key, season, round_code, round_number, round_type, is_final,
          match_date, match_time, venue_id, venue_raw,
          home_club_id, away_club_id,
          home_goals, home_behinds, home_score,
          away_goals, away_behinds, away_score,
          result, winner_club_id, margin,
          attendance, attendance_status, attendance_source_id, match_event, notes
        ) VALUES (
          ${matchKey}, ${input.season}, ${roundCode}, ${roundNumber}, ${input.roundType}::round_type, ${isFinal},
          ${input.matchDate}::date, ${input.matchTime || null}, ${input.venueId || null}, ${venueRaw},
          ${input.homeClubId}, ${input.awayClubId},
          ${homeGoals}, ${homeBehinds}, ${homeScore},
          ${awayGoals}, ${awayBehinds}, ${awayScore},
          ${result}::match_result, ${winnerClubId}, ${margin},
          ${attendance}, ${attendanceStatus}::coverage_status, ${attendanceSourceId},
          ${input.matchEvent?.trim() || null}, ${input.notes?.trim() || null}
        )
        RETURNING id, season
      `;

      // 5. Insert quarter scores if provided
      for (const [clubId, periods] of [[input.homeClubId, input.homeQuarters], [input.awayClubId, input.awayQuarters]] as const) {
        if (!periods) continue;
        for (let p = 1; p <= 4; p++) {
          const q = periods[p];
          if (q && [q.goals, q.behinds, q.points].some((value) => value !== null && value !== undefined)) {
            const qGoals = q.goals !== null && q.goals !== undefined ? Number(q.goals) : null;
            const qBehinds = q.behinds !== null && q.behinds !== undefined ? Number(q.behinds) : null;
            const qPoints = q.points !== null && q.points !== undefined
              ? Number(q.points)
              : (qGoals !== null && qBehinds !== null ? qGoals * 6 + qBehinds : null);

            await tx`
              INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points)
              VALUES (${matchRow.id}, ${clubId}, ${p}, ${qGoals}, ${qBehinds}, ${qPoints})
              ON CONFLICT (match_id, club_id, period) DO UPDATE SET
                goals = EXCLUDED.goals,
                behinds = EXCLUDED.behinds,
                points = EXCLUDED.points
            `;
          }
        }
      }

      await recomputeSeasonMetadata(tx, input.season);
      await recomputeClubSeasons(tx, input.season);
      await recomputeSeasonBrownlowStatus(tx, input.season);

      // 6. Required audit, same transaction: a failed insert rolls the
      // match creation back (AFLDB-ISSUE-027).
      await recordDataEdit(tx, {
        tableName: 'matches',
        rowId: matchRow.id,
        fieldGroup: 'match_creation',
        oldValues: {},
        newValues: {
          season: input.season,
          roundCode,
          matchDate: input.matchDate,
          homeClubId: input.homeClubId,
          awayClubId: input.awayClubId,
          homeScore,
          awayScore,
        },
        adminUserId: input.adminUserId,
        note: input.notes?.trim() || 'Created match via Data Editor',
      });

      return matchRow;
    });

    return created;
  } catch (error) {
    // A race between the canonical-identity pre-check above and this
    // function's own INSERT -- two concurrent submissions for the identical
    // season, round, date and clubs -- still resolves through the
    // matches_match_key_key UNIQUE constraint, since match_key is rendered
    // deterministically from those same inputs. That is a genuine
    // PostgreSQL-raised backstop for the race window, not the primary
    // duplicate check, so it is translated the same way AFLDB-ISSUE-181's
    // deleteMatch() 23503 fallback is: a useful message, not a raw
    // constraint name.
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505') {
      throw new Error('That match already exists for this season, round, date and clubs.');
    }
    throw error;
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

/**
 * Super Admin: Delete a match from the database (see changeLog.md).
 * Removes player_match_stats, match_period_scores, and matches record,
 * while automatically recalculating career & season statistics for all affected players.
 */
export async function deleteMatch(input: {
  matchId: number;
  adminUserId: number;
  reason?: string | null;
}): Promise<
  | { ok: true; deletedId: number; affectedPlayers: number }
  | { ok: false; error: string }
> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });

  try {
    const result = await importSql.begin<
      | { ok: true; deletedId: number; season: number; affectedPlayers: number }
      | { ok: false; error: string }
    >(async (tx) => {
      // 1. Fetch match info
      const [match] = await tx<{
        id: number;
        season: number;
        roundCode: string;
        matchDate: string;
        homeClubId: number;
        awayClubId: number;
        homeScore: number;
        awayScore: number;
      }[]>`
        SELECT id, season, round_code AS "roundCode", match_date::text AS "matchDate",
               home_club_id AS "homeClubId", away_club_id AS "awayClubId",
               home_score AS "homeScore", away_score AS "awayScore"
          FROM matches
         WHERE id = ${input.matchId}
           FOR UPDATE
      `;

      if (!match) {
        return { ok: false as const, error: `Match #${input.matchId} does not exist.` };
      }

      // AFLDB-ISSUE-155 §27.15: a match carrying a Brownlow workflow
      // decision is not deletable. The `ON DELETE RESTRICT` foreign key of
      // migration 094 §4 guarantees that at the storage layer, but a raised
      // foreign-key violation is not control flow a Data Editor user can act
      // on, so the refusal is deliberate and happens before anything
      // destructive runs. A match with no Brownlow decision is unaffected.
      const [brownlowEntry] = await tx<{ status: string }[]>`
        SELECT status FROM brownlow_vote_entry_state WHERE match_id = ${input.matchId}
      `;
      if (brownlowEntry) {
        return {
          ok: false as const,
          error:
            `Match #${input.matchId} carries a Brownlow vote entry (${brownlowEntry.status}) `
            + 'and cannot be deleted. Remove that decision in Brownlow administration '
            + `(/admin/brownlow/${match.season}/${match.roundCode}) first.`,
        };
      }

      // AFLDB-ISSUE-167 §8.3, the THIRD destruction path. Until Stage 6 this
      // function ran `DELETE FROM player_achievements WHERE match_id = $1` and
      // silently destroyed a curated first-kick-goal record -- a Phase E fact
      // with its own durable `data_overrides` decision and its own audit trail
      // -- as collateral of a match deletion. It is outside both importers, so
      // no reload-survival mechanism covered it: the row was simply gone, and
      // its override left naming nothing.
      //
      // `after_siren_kicks.match_id` was never deleted here at all. Migration
      // 089 declares it `integer REFERENCES matches(id)` with no ON DELETE
      // clause, so the default NO ACTION made the match delete raise a raw
      // foreign-key violation -- not control flow a Data Editor user can act
      // on, and exactly the opaque failure the Brownlow refusal above exists to
      // avoid. Both families are therefore refused explicitly, before anything
      // destructive runs, in the same shape.
      //
      // A SUPPRESSED record still refuses. Suppression says the record should
      // never have existed; it does not say the row may be destroyed, and the
      // row is precisely what keeps its `data_edits` history resolvable through
      // the next promotion's lineage remap.
      const collateral = await tx<{
        family: string; recordId: string | null; rowId: number; status: string;
      }[]>`
        SELECT 'first-kick-goal' AS family, source_record_id AS "recordId",
               id::int AS "rowId", status
          FROM player_achievements WHERE match_id = ${input.matchId}
        UNION ALL
        SELECT 'after-the-siren', source_record_id, id::int, status
          FROM after_siren_kicks WHERE match_id = ${input.matchId}
         ORDER BY 1, 3
      `;
      if (collateral.length > 0) {
        const named = collateral
          .map((r) => `${r.family} ${r.recordId ?? `#${r.rowId}`}`
            + (r.status === 'void' ? ' (already suppressed)' : ''))
          .join(', ');
        const families = [...new Set(collateral.map((r) => r.family))];
        return {
          ok: false as const,
          error:
            `Match #${input.matchId} carries ${collateral.length} curated special `
            + `record${collateral.length === 1 ? '' : 's'} (${named}) and cannot be deleted. `
            + 'Deleting the match would destroy or orphan a record that carries its own '
            + 'durable decision and audit trail. Suppress or reassign '
            + `${collateral.length === 1 ? 'it' : 'them'} in Special records (`
            + `${families.map((f) => `/admin/records/${f}`).join(', ')}) first.`,
        };
      }

      // AFLDB-ISSUE-177: a current-season staging/reconciliation row can
      // still point at this match (`staging.external_current_matches.
      // local_match_id`, migration 063). Nulling or detaching that link here
      // would discard reconciliation provenance the current-season importer
      // relies on to avoid re-resolving the same external game next run, so
      // the row is left untouched and the delete is refused instead -- same
      // shape as the Brownlow and collateral refusals above. The FK itself
      // (no ON DELETE clause, so NO ACTION) remains the final backstop if a
      // staging row is relinked between this check and the DELETE below; see
      // the catch around the transaction for that race.
      const stagingLinks = await tx<{ sourceKey: string; externalGameId: string }[]>`
        SELECT s.key AS "sourceKey", e.external_game_id AS "externalGameId"
          FROM staging.external_current_matches e
          JOIN sources s ON s.id = e.source_id
         WHERE e.local_match_id = ${input.matchId}
         ORDER BY s.key, e.external_game_id
      `;
      if (stagingLinks.length > 0) {
        const named = stagingLinks.map((r) => `${r.sourceKey} ${r.externalGameId}`).join(', ');
        return {
          ok: false as const,
          error:
            `Match #${input.matchId} is still linked by ${stagingLinks.length} `
            + `current-season staging record${stagingLinks.length === 1 ? '' : 's'} `
            + `(${named}) and cannot be deleted. Clear or re-resolve the staging link `
            + 'through the current-season import process first.',
        };
      }

      // AFLDB-ISSUE-180: `player_match_period_stats.match_id` (migration
      // 062) is `NOT NULL` with no `ON DELETE` clause. Quarter-by-quarter
      // player statistics are canonical per-period data, not detachable
      // metadata, so a match that still carries them is refused here, before
      // anything destructive runs -- the same shape as the Brownlow,
      // collateral and staging refusals above, rather than letting the raw
      // FK violation fall through to the generic 23503 fallback below.
      const [periodStats] = await tx<{ rowCount: number; playerCount: number }[]>`
        SELECT count(*)::int AS "rowCount", count(DISTINCT player_id)::int AS "playerCount"
          FROM player_match_period_stats
         WHERE match_id = ${input.matchId}
      `;
      if (periodStats.rowCount > 0) {
        return {
          ok: false as const,
          error:
            `Match #${input.matchId} still has ${periodStats.rowCount} player period `
            + `statistic${periodStats.rowCount === 1 ? '' : 's'} recorded across `
            + `${periodStats.playerCount} player${periodStats.playerCount === 1 ? '' : 's'} `
            + 'and cannot be deleted while that data exists.',
        };
      }

      // AFLDB-ISSUE-181: `staging.afl_api_lineup.match_id` (migration 077)
      // is nullable with no `ON DELETE` clause. A lineup row is the
      // provider's team-ANNOUNCEMENT for this fixture -- STAGING-ONLY
      // evidence, never canonical participation (migration 077's header is
      // explicit: "an announced player is NOT a player who played") -- but
      // it is still the source's own observation, carrying its own
      // provenance chain back through `staging.source_record_versions` and
      // `staging.source_payloads`. `lineup-store.ts` maintains the
      // projection by keyed upsert alone and owns an explicit invariant
      // that it never deletes or truncates a row; there is no importer path
      // that re-resolves a lineup row's `match_id` to a different match
      // once linked. Nulling or detaching it here would both violate that
      // ownership and discard the announcement-to-fixture link, so the
      // match is refused instead, before anything destructive runs -- same
      // shape as the Brownlow, collateral, staging and period-stats checks
      // above.
      const lineupLinks = await tx<{
        providerMatchId: string; season: number; rowCount: number;
      }[]>`
        SELECT provider_match_id AS "providerMatchId", season, count(*)::int AS "rowCount"
          FROM staging.afl_api_lineup
         WHERE match_id = ${input.matchId}
         GROUP BY provider_match_id, season
         ORDER BY season, provider_match_id
      `;
      if (lineupLinks.length > 0) {
        const totalRows = lineupLinks.reduce((sum, r) => sum + r.rowCount, 0);
        const named = lineupLinks
          .map((r) => `season ${r.season} game ${r.providerMatchId} `
            + `(${r.rowCount} row${r.rowCount === 1 ? '' : 's'})`)
          .join(', ');
        return {
          ok: false as const,
          error:
            `Match #${input.matchId} is still linked by ${totalRows} AFL API lineup `
            + `staging row${totalRows === 1 ? '' : 's'} (${named}) and cannot be deleted. `
            + 'Clear or re-resolve the lineup staging link through the AFL API lineup '
            + 'import process first.',
        };
      }

      // 2. Identify all affected players in this match
      const playerRows = await tx<{ playerId: number }[]>`
        SELECT DISTINCT player_id AS "playerId"
          FROM player_match_stats
         WHERE match_id = ${input.matchId}
      `;
      const affectedIds = playerRows.map((r) => r.playerId).filter(Boolean);

      // player_clubs points its first/last match foreign keys at matches.
      // Remove those derived rows before deleting the authoritative match;
      // the same transaction rebuilds them from what remains below.
      await clearPlayerClubMatchReferences(tx, affectedIds);

      // 3. Delete dependent rows. `player_achievements` is deliberately ABSENT
      // from this list since AFLDB-ISSUE-167 Stage 6: a match carrying one is
      // refused above rather than having its curated record destroyed here.
      await tx`DELETE FROM player_match_stats WHERE match_id = ${input.matchId}`;
      await tx`DELETE FROM match_period_scores WHERE match_id = ${input.matchId}`;
      await tx`DELETE FROM matches WHERE id = ${input.matchId}`;

      await recomputeSeasonMetadata(tx, match.season);
      await recomputeClubSeasons(tx, match.season);
      await recomputePlayerDerivedStats(tx, affectedIds, match.season);
      await recomputeSeasonBrownlowStatus(tx, match.season);

      // Required audit, same transaction: a failed insert rolls the
      // deletion back (AFLDB-ISSUE-027).
      await recordDataEdit(tx, {
        tableName: 'matches',
        rowId: input.matchId,
        fieldGroup: 'match_deletion',
        oldValues: { deletedMatchId: input.matchId, season: match.season },
        newValues: {},
        adminUserId: input.adminUserId,
        note: input.reason?.trim() || 'Deleted match via Data Editor',
      });

      return {
        ok: true as const,
        deletedId: input.matchId,
        season: match.season,
        affectedPlayers: affectedIds.length,
      };
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      deletedId: result.deletedId,
      affectedPlayers: result.affectedPlayers,
    };
  } catch (error) {
    // AFLDB-ISSUE-177 concurrency backstop, extended by AFLDB-ISSUE-180 and
    // AFLDB-ISSUE-181. The staging, period-stats and lineup pre-checks above
    // are each a point-in-time read, not a lock, so a concurrent write can
    // relink `local_match_id`, insert a period-stats row or insert a lineup
    // row between that check and `DELETE FROM matches` above. As of
    // AFLDB-ISSUE-181, every foreign key into `matches(id)` with default
    // `NO ACTION` that this function's own statements can violate is
    // pre-checked above (or, for `player_clubs.first_match_id`/
    // `last_match_id`, actively cleared before the delete by
    // `clearPlayerClubMatchReferences`) -- see the AFLDB-ISSUE-181 issue
    // entry for the full inventory. This catch therefore now guards only
    // that race window and any future dependency this function has not yet
    // learned about. Whatever FK actually fires, it raises a raw 23503
    // (foreign_key_violation) -- exactly the opaque database exception this
    // issue exists to keep out of the admin UI. It is mapped to the same
    // refusal shape without inspecting the constraint name (which FK fired
    // can't be known without that, and isn't needed for a useful message);
    // every other error still throws.
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23503') {
      return {
        ok: false,
        error:
          `Match #${input.matchId} could not be deleted: another record still depends on it `
          + '(for example, a current-season staging link created or changed while the '
          + 'deletion was running). Retry the deletion; if it keeps failing, check '
          + 'current-season staging and contact an administrator if the dependency does '
          + 'not clear.',
      };
    }
    throw error;
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
