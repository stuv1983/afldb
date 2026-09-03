import 'server-only';

import type { Sql } from 'postgres';

import type { ImportBatchId } from '../import-batch-id';

/**
 * The dataset registry: what an administrator may upload, what it must
 * look like, and how a vetted file becomes rows in the statistical
 * tables.
 *
 * The pipeline is staged -> validated -> approved -> promoted.
 *
 *   staged     The file is stored byte-for-byte and parsed into rows.
 *   validated  Every row gets a verdict. Errors block approval;
 *              warnings (an unmatched player, a non-AFL club) do not,
 *              because "unlinked but preserved" is AFLDB's normal state
 *              for source names it cannot confidently identify.
 *   approved   A human read the report and said yes.
 *   promoted   Applied under the IMPORT role, in one transaction, as a
 *              tracked import batch — the same machinery as the bulk
 *              migration, so an upload is not a second, laxer path into
 *              the database.
 *
 * Adding a dataset means adding one spec here; the admin UI and the
 * pipeline are generic.
 */

export type RowVerdict = {
  verdict: 'ok' | 'warning' | 'error';
  reasons: string[];
  /** Enrichment carried to promotion (resolved ids), never shown as fact. */
  resolved?: Record<string, number | string | null>;
};

export type ValidationContext = {
  /** Read-only queries against reference data (players, clubs, seasons). */
  sql: Sql;
};

export type DatasetSpec = {
  key: string;
  title: string;
  description: string;
  /** Columns that must exist in the header. Extra columns are ignored. */
  requiredColumns: string[];
  /** Duplicate keys within one file are an error. */
  fileKey: (row: Record<string, string | null>) => string;
  validateRow: (
    row: Record<string, string | null>,
    context: ValidationContext,
  ) => Promise<RowVerdict>;
  /**
   * Apply one validated row. Runs inside the promotion transaction under
   * the import role. Upserts by a natural/source key, so re-promoting a
   * corrected file updates rather than duplicates.
   */
  promoteRow: (
    row: Record<string, string | null>,
    resolved: Record<string, number | string | null>,
    context: { sql: Sql; awardId: number | null; sourceId: number; batchId: ImportBatchId },
  ) => Promise<void>;
  /**
   * The award this dataset feeds, resolved once per promotion, for
   * award-shaped datasets only. Match/player-stat datasets feed the fact
   * tables directly and leave this unset; `awardId` is then null.
   */
  awardSlug?: string;
};

// --- Shared resolution helpers ---

function toIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export async function resolveSeason(sql: Sql, value: string | null): Promise<number | null> {
  const year = toIntOrNull(value);
  if (year === null) return null;
  const [row] = await sql<{ year: number }[]>`
    SELECT year FROM seasons WHERE year = ${year}
  `;
  return row?.year ?? null;
}

/** Club by any recorded alias, resolved to the identity of the season. */
export async function resolveClub(
  sql: Sql,
  name: string | null,
  season: number | null,
): Promise<{ id: number; name: string } | null> {
  if (!name) return null;
  const [row] = await sql<{ id: number; name: string }[]>`
    WITH candidate AS (
      SELECT c.id, c.organization_id
        FROM clubs c
       WHERE afldb_normalise_name(c.name) = afldb_normalise_name(${name})
      UNION
      SELECT c.id, c.organization_id
        FROM club_aliases a JOIN clubs c ON c.id = a.club_id
       WHERE afldb_normalise_name(a.alias) = afldb_normalise_name(${name})
    )
    SELECT c.id, c.name
      FROM candidate cand
      JOIN clubs c ON c.organization_id = cand.organization_id
     WHERE (${season}::int IS NULL)
        OR (c.first_season <= ${season} AND (c.last_season IS NULL OR c.last_season >= ${season}))
     ORDER BY c.first_season DESC NULLS LAST
     LIMIT 1
  `;
  return row ?? null;
}

/**
 * Player by name, season and club — the honest version.
 *
 * unique    exactly one player of that name played that season, or only
 *           one of them played for that club
 * ambiguous more than one candidate survives every filter
 * unmatched nobody of that name played that season
 *
 * The caller records the verdict; nothing here guesses.
 */
export async function resolvePlayer(
  sql: Sql,
  name: string | null,
  season: number | null,
  clubId: number | null,
): Promise<{ status: 'unique' | 'ambiguous' | 'unmatched'; playerId: number | null; count: number }> {
  if (!name) return { status: 'unmatched', playerId: null, count: 0 };

  const candidates = await sql<{ id: number; forClub: boolean }[]>`
    SELECT p.id,
           EXISTS (
             SELECT 1 FROM player_clubs pc
              WHERE pc.player_id = p.id
                AND (${clubId}::int IS NULL OR pc.club_id = ${clubId})
                AND (${season}::int IS NULL
                     OR (pc.first_season <= ${season} AND pc.last_season >= ${season}))
           ) AS "forClub"
      FROM players p
     WHERE p.search_name = afldb_normalise_name(${name})
       AND (${season}::int IS NULL
            OR (p.debut_season <= ${season}
                AND COALESCE(p.final_season, 9999) >= ${season}))
  `;

  if (candidates.length === 0) return { status: 'unmatched', playerId: null, count: 0 };
  if (candidates.length === 1) {
    return { status: 'unique', playerId: candidates[0].id, count: 1 };
  }
  const forClub = candidates.filter((c) => c.forClub);
  if (forClub.length === 1) {
    return { status: 'unique', playerId: forClub[0].id, count: candidates.length };
  }
  return { status: 'ambiguous', playerId: null, count: candidates.length };
}

/** Venue by any recorded alias, same shape as resolveClub. */
async function resolveVenue(
  sql: Sql,
  name: string | null,
  season: number | null,
): Promise<{ id: number; name: string } | null> {
  if (!name) return null;
  const [row] = await sql<{ id: number; name: string }[]>`
    WITH candidate AS (
      SELECT v.id
        FROM venues v
       WHERE afldb_normalise_name(v.canonical_name) = afldb_normalise_name(${name})
          OR afldb_normalise_name(v.legacy_name) = afldb_normalise_name(${name})
      UNION
      SELECT a.venue_id
        FROM venue_aliases a
       WHERE afldb_normalise_name(a.alias) = afldb_normalise_name(${name})
    )
    SELECT v.id, v.canonical_name AS name
      FROM candidate cand
      JOIN venues v ON v.id = cand.id
     WHERE (${season}::int IS NULL)
        OR ((v.first_season IS NULL OR v.first_season <= ${season})
            AND (v.last_season IS NULL OR v.last_season >= ${season}))
     LIMIT 1
  `;
  return row ?? null;
}

/**
 * An existing match by its natural key — season, round and the two
 * clubs, order-independent (a CSV row might list either side first).
 *
 * unique     exactly one match fits
 * ambiguous  more than one match shares this season/round/pairing
 *            (a rare, genuinely re-played round is possible historically)
 * unmatched  no such match exists — the caller's standard advice is to
 *            upload the match-results file first
 */
async function resolveMatch(
  sql: Sql,
  season: number | null,
  roundCode: string | null,
  homeClubId: number | null,
  awayClubId: number | null,
): Promise<{ status: 'unique' | 'ambiguous' | 'unmatched'; matchId: number | null; count: number }> {
  if (season === null || !roundCode || homeClubId === null || awayClubId === null) {
    return { status: 'unmatched', matchId: null, count: 0 };
  }
  const candidates = await sql<{ id: number }[]>`
    SELECT id FROM matches
     WHERE season = ${season} AND round_code = ${roundCode}
       AND ((home_club_id = ${homeClubId} AND away_club_id = ${awayClubId})
         OR (home_club_id = ${awayClubId} AND away_club_id = ${homeClubId}))
  `;
  if (candidates.length === 0) return { status: 'unmatched', matchId: null, count: 0 };
  if (candidates.length === 1) return { status: 'unique', matchId: candidates[0].id, count: 1 };
  return { status: 'ambiguous', matchId: null, count: candidates.length };
}

// --- Dataset: Rising Star nominations ---

const risingStar: DatasetSpec = {
  key: 'rising_star',
  title: 'Rising Star nominations',
  description:
    'Round-by-round Rising Star nominations in the FootyWire export layout '
    + '(one season per file or many; keyed by source_key).',
  requiredColumns: ['source_key', 'season', 'round_number', 'player', 'club'],
  awardSlug: 'rising-star',
  fileKey: (row) => row.source_key ?? '',

  async validateRow(row, { sql }) {
    const reasons: string[] = [];
    let verdict: RowVerdict['verdict'] = 'ok';

    if (!row.source_key) {
      return { verdict: 'error', reasons: ['source_key is empty'] };
    }
    const season = await resolveSeason(sql, row.season);
    if (season === null) {
      return { verdict: 'error', reasons: [`season ${row.season ?? '(empty)'} does not exist`] };
    }
    if (!row.player) {
      return { verdict: 'error', reasons: ['player is empty'] };
    }
    const round = toIntOrNull(row.round_number);
    if (round === null || round < 0 || round > 30) {
      return { verdict: 'error', reasons: [`round_number ${row.round_number ?? '(empty)'} is not a round`] };
    }

    const club = await resolveClub(sql, row.club, season);
    if (!club) {
      verdict = 'warning';
      reasons.push(`club "${row.club}" is not an AFL club; kept as text`);
    }
    const opponent = await resolveClub(sql, row.opponent, season);

    const player = await resolvePlayer(sql, row.player, season, club?.id ?? null);
    if (player.status !== 'unique') {
      verdict = 'warning';
      reasons.push(
        player.status === 'unmatched'
          ? `player "${row.player}" not found for ${season}; will import unlinked`
          : `player "${row.player}" is ambiguous (${player.count} candidates); will import unlinked`,
      );
    }

    return {
      verdict,
      reasons,
      resolved: {
        season,
        club_id: club?.id ?? null,
        opponent_club_id: opponent?.id ?? null,
        player_id: player.playerId,
        link_status: player.status,
        round_number: round,
      },
    };
  },

  async promoteRow(row, resolved, { sql, awardId, sourceId, batchId }) {
    const stats: Record<string, number> = {};
    for (const key of ['kicks', 'handballs', 'disposals', 'marks', 'goals', 'behinds',
      'tackles', 'hitouts', 'frees_for', 'frees_against', 'supercoach', 'afl_fantasy']) {
      const value = toIntOrNull(row[key]);
      if (value !== null) stats[key] = value;
    }

    await sql`
      INSERT INTO award_nominations
        (award_id, season, round_number, player_id, player_name_raw,
         link_status_value, club_id, opponent_club_id, is_winner, is_ineligible,
         ineligible_reason, votes, stat_line, source_id, source_record_id,
         import_batch_id)
      VALUES
        (${awardId}, ${resolved.season}, ${resolved.round_number},
         ${resolved.player_id}, ${row.player},
         ${resolved.link_status === 'unique' ? 'unique' : resolved.link_status}::link_status,
         ${resolved.club_id}, ${resolved.opponent_club_id},
         ${row.is_season_winner === '1'}, ${row.ineligible === '1'},
         ${row.ineligible_reason ?? null}, ${toIntOrNull(row.votes)},
         ${Object.keys(stats).length ? sql.json(stats) : null},
         ${sourceId}, ${row.source_key}, ${batchId})
      ON CONFLICT (award_id, source_record_id) WHERE source_record_id IS NOT NULL
      DO UPDATE SET
         season = EXCLUDED.season,
         round_number = EXCLUDED.round_number,
         player_id = EXCLUDED.player_id,
         player_name_raw = EXCLUDED.player_name_raw,
         link_status_value = EXCLUDED.link_status_value,
         club_id = EXCLUDED.club_id,
         opponent_club_id = EXCLUDED.opponent_club_id,
         is_winner = EXCLUDED.is_winner,
         is_ineligible = EXCLUDED.is_ineligible,
         ineligible_reason = EXCLUDED.ineligible_reason,
         votes = EXCLUDED.votes,
         stat_line = EXCLUDED.stat_line,
         import_batch_id = EXCLUDED.import_batch_id
    `;
  },
};

// --- Dataset: All-Australian selections ---

const allAustralian: DatasetSpec = {
  key: 'all_australian',
  title: 'All-Australian selections',
  description:
    'All-Australian teams in the DraftGuru export layout '
    + '(Player, Club, Position, Captain, Year).',
  requiredColumns: ['player', 'year'],
  awardSlug: 'all-australian',
  fileKey: (row) => `${row.year}:${row.player}:${row.club ?? ''}`,

  async validateRow(row, { sql }) {
    const reasons: string[] = [];
    let verdict: RowVerdict['verdict'] = 'ok';

    if (!row.player) return { verdict: 'error', reasons: ['player is empty'] };
    const season = await resolveSeason(sql, row.year);
    if (season === null) {
      return { verdict: 'error', reasons: [`year ${row.year ?? '(empty)'} does not exist`] };
    }

    const club = await resolveClub(sql, row.club, season);
    if (row.club && !club) {
      verdict = 'warning';
      reasons.push(`club "${row.club}" is not an AFL club; kept as text`);
    }

    const player = await resolvePlayer(sql, row.player, season, club?.id ?? null);
    if (player.status !== 'unique') {
      verdict = 'warning';
      reasons.push(
        player.status === 'unmatched'
          ? `player "${row.player}" not found for ${season}; will import unlinked`
          : `player "${row.player}" is ambiguous (${player.count} candidates); will import unlinked`,
      );
    }

    return {
      verdict,
      reasons,
      resolved: {
        season,
        club_id: club?.id ?? null,
        player_id: player.playerId,
        link_status: player.status,
      },
    };
  },

  async promoteRow(row, resolved, { sql, awardId, sourceId, batchId }) {
    const recordId = `${resolved.season}:${row.player}:${row.club ?? ''}`;
    await sql`
      INSERT INTO award_winners
        (award_id, season, player_id, player_name_raw, link_status_value,
         candidate_count, club_id, club_name_raw, position,
         is_captain, is_vice_captain, source_id, source_record_id, import_batch_id)
      VALUES
        (${awardId}, ${resolved.season}, ${resolved.player_id}, ${row.player},
         ${resolved.link_status === 'unique' ? 'unique' : resolved.link_status}::link_status,
         0, ${resolved.club_id}, ${row.club ?? null}, ${row.position ?? null},
         ${(row.captain ?? '').toLowerCase() === 'c' || row.captain === '1'},
         ${(row.captain ?? '').toLowerCase() === 'vc'},
         ${sourceId}, ${recordId}, ${batchId})
      ON CONFLICT (award_id, source_record_id) WHERE source_record_id IS NOT NULL
      DO UPDATE SET
         season = EXCLUDED.season,
         player_id = EXCLUDED.player_id,
         player_name_raw = EXCLUDED.player_name_raw,
         link_status_value = EXCLUDED.link_status_value,
         club_id = EXCLUDED.club_id,
         club_name_raw = EXCLUDED.club_name_raw,
         position = EXCLUDED.position,
         is_captain = EXCLUDED.is_captain,
         is_vice_captain = EXCLUDED.is_vice_captain,
         import_batch_id = EXCLUDED.import_batch_id
    `;
  },
};

// --- Dataset: Match results ---

/**
 * Round code -> canonical `round_type` for every round that is not home-and-away.
 * The name is historical: membership means "not a home-and-away premiership-points
 * round" (`matches.is_final`), not finals-series membership
 * (`matches.is_finals_series`). `WF` — the AFL Wildcard Round — belongs here and is
 * deliberately not collapsed into an existing finals type. See AFLDB-ISSUE-129 §8.4.
 * Kept in step with `FINALS_CODES` in `tools/migration/import_fitzroy_core.py`.
 */
const FINALS_ROUND_TYPES: Record<string, string> = {
  EF: 'elimination_final',
  QF: 'qualifying_final',
  SF: 'semi_final',
  PF: 'preliminary_final',
  GF: 'grand_final',
  WF: 'wildcard_final',
};

const matchResults: DatasetSpec = {
  key: 'match_results',
  title: 'Match results',
  description:
    'One row per match: season, round, date, venue, clubs and final score. '
    + 'Upserts by season/round/date/clubs, so re-uploading a corrected file (a fixed '
    + 'attendance figure, a corrected score) updates the same match rather than duplicating it.',
  requiredColumns: [
    'season', 'round_code', 'match_date', 'venue', 'home_club', 'away_club',
    'home_score', 'away_score',
  ],
  fileKey: (row) => `${row.season}|${row.round_code}|${row.match_date}|${row.home_club}|${row.away_club}`,

  async validateRow(row, { sql }) {
    const reasons: string[] = [];
    let verdict: RowVerdict['verdict'] = 'ok';

    const season = await resolveSeason(sql, row.season);
    if (season === null) {
      return { verdict: 'error', reasons: [`season ${row.season ?? '(empty)'} does not exist`] };
    }

    const roundCode = (row.round_code ?? '').trim();
    if (!roundCode) return { verdict: 'error', reasons: ['round_code is empty'] };
    const roundNumber = toIntOrNull(row.round_number);
    const finalsType = FINALS_ROUND_TYPES[roundCode.toUpperCase()];

    let roundType: string;
    if (finalsType) {
      if (roundNumber !== null) {
        return {
          verdict: 'error',
          reasons: [`round_code "${roundCode}" is a non-home-and-away round code; round_number must be empty`],
        };
      }
      roundType = finalsType;
    } else if (roundNumber !== null) {
      roundType = 'home_and_away';
    } else {
      return {
        verdict: 'error',
        reasons: [`round_code "${roundCode}" is not a recognised round code (EF/QF/SF/PF/GF/WF) `
          + 'and round_number is empty'],
      };
    }

    if (!row.match_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.match_date)) {
      return { verdict: 'error', reasons: [`match_date "${row.match_date ?? '(empty)'}" must be YYYY-MM-DD`] };
    }

    const home = await resolveClub(sql, row.home_club, season);
    if (!home) {
      return { verdict: 'error', reasons: [`home_club "${row.home_club}" is not a recognised club for ${season}`] };
    }
    const away = await resolveClub(sql, row.away_club, season);
    if (!away) {
      return { verdict: 'error', reasons: [`away_club "${row.away_club}" is not a recognised club for ${season}`] };
    }
    if (home.id === away.id) {
      return { verdict: 'error', reasons: ['home_club and away_club are the same club'] };
    }

    if (!row.venue) return { verdict: 'error', reasons: ['venue is empty'] };
    const venue = await resolveVenue(sql, row.venue, season);
    if (!venue) {
      verdict = 'warning';
      reasons.push(`venue "${row.venue}" is not recognised; kept as text`);
    }

    const homeScore = toIntOrNull(row.home_score);
    const awayScore = toIntOrNull(row.away_score);
    if (homeScore === null || homeScore < 0) {
      return { verdict: 'error', reasons: [`home_score "${row.home_score}" must be a non-negative whole number`] };
    }
    if (awayScore === null || awayScore < 0) {
      return { verdict: 'error', reasons: [`away_score "${row.away_score}" must be a non-negative whole number`] };
    }

    const homeGoals = toIntOrNull(row.home_goals);
    const homeBehinds = toIntOrNull(row.home_behinds);
    if (homeGoals !== null && homeBehinds !== null && homeGoals * 6 + homeBehinds !== homeScore) {
      return { verdict: 'error', reasons: ['home_goals and home_behinds do not add up to home_score'] };
    }
    const awayGoals = toIntOrNull(row.away_goals);
    const awayBehinds = toIntOrNull(row.away_behinds);
    if (awayGoals !== null && awayBehinds !== null && awayGoals * 6 + awayBehinds !== awayScore) {
      return { verdict: 'error', reasons: ['away_goals and away_behinds do not add up to away_score'] };
    }

    const attendance = toIntOrNull(row.attendance);
    if (row.attendance && (attendance === null || attendance < 0)) {
      return { verdict: 'error', reasons: [`attendance "${row.attendance}" must be a non-negative whole number`] };
    }
    // matches.attendance_status (migration 020) must agree with attendance
    // in both directions, and a genuine zero crowd requires a cited
    // source this CSV format has no column for -- refuse rather than
    // violate the constraint or silently invent a citation.
    if (attendance === 0) {
      return {
        verdict: 'error',
        reasons: ['attendance of exactly 0 needs a cited source; leave attendance blank if merely unknown'],
      };
    }
    const attendanceStatus = attendance !== null ? 'complete' : 'not_collected';

    const result = homeScore === awayScore ? 'draw' : homeScore > awayScore ? 'home_win' : 'away_win';
    const winnerClubId = result === 'draw' ? null : result === 'home_win' ? home.id : away.id;
    const margin = Math.abs(homeScore - awayScore);

    return {
      verdict,
      reasons,
      resolved: {
        season, round_number: roundNumber, round_type: roundType,
        home_club_id: home.id, home_club_name: home.name,
        away_club_id: away.id, away_club_name: away.name,
        venue_id: venue?.id ?? null,
        home_score: homeScore, home_goals: homeGoals, home_behinds: homeBehinds,
        away_score: awayScore, away_goals: awayGoals, away_behinds: awayBehinds,
        attendance, attendance_status: attendanceStatus,
        result, winner_club_id: winnerClubId, margin,
      },
    };
  },

  async promoteRow(row, resolved, { sql }) {
    // Reproduces the natural key documented on the matches table itself
    // (season|round|date|home|away, using the era-appropriate club
    // identity's name) so re-uploading a corrected file about an
    // existing historical match updates it rather than duplicating it.
    const matchKey = `${resolved.season}|${row.round_code}|${row.match_date}`
      + `|${resolved.home_club_name}|${resolved.away_club_name}`;

    await sql`
      INSERT INTO matches
        (match_key, season, round_code, round_number, round_type, is_final,
         match_date, venue_id, venue_raw, home_club_id, away_club_id,
         home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
         result, winner_club_id, margin, attendance, attendance_status)
      VALUES
        (${matchKey}, ${resolved.season}, ${row.round_code}, ${resolved.round_number},
         ${resolved.round_type}::round_type, ${resolved.round_type !== 'home_and_away'},
         ${row.match_date}, ${resolved.venue_id}, ${row.venue},
         ${resolved.home_club_id}, ${resolved.away_club_id},
         ${resolved.home_goals}, ${resolved.home_behinds}, ${resolved.home_score},
         ${resolved.away_goals}, ${resolved.away_behinds}, ${resolved.away_score},
         ${resolved.result}::match_result, ${resolved.winner_club_id}, ${resolved.margin},
         ${resolved.attendance}, ${resolved.attendance_status}::coverage_status)
      ON CONFLICT (match_key) DO UPDATE SET
         round_number = EXCLUDED.round_number,
         round_type   = EXCLUDED.round_type,
         is_final     = EXCLUDED.is_final,
         venue_id     = EXCLUDED.venue_id,
         venue_raw    = EXCLUDED.venue_raw,
         home_goals   = EXCLUDED.home_goals,
         home_behinds = EXCLUDED.home_behinds,
         home_score   = EXCLUDED.home_score,
         away_goals   = EXCLUDED.away_goals,
         away_behinds = EXCLUDED.away_behinds,
         away_score   = EXCLUDED.away_score,
         result            = EXCLUDED.result,
         winner_club_id    = EXCLUDED.winner_club_id,
         margin            = EXCLUDED.margin,
         attendance        = EXCLUDED.attendance,
         attendance_status = EXCLUDED.attendance_status
    `;
  },
};

// --- Dataset: Player match stats ---

/** Every nullable statistic player_match_stats carries (migration 004). */
const STAT_COLUMNS = [
  'kicks', 'marks', 'handballs', 'disposals', 'goals', 'behinds', 'hitouts',
  'tackles', 'rebounds', 'inside_50s', 'clearances', 'clangers',
  'frees_for', 'frees_against', 'contested', 'uncontested', 'contested_marks',
  'marks_inside_50', 'one_percenters', 'bounces', 'goal_assists',
] as const;

const playerMatchStats: DatasetSpec = {
  key: 'player_match_stats',
  title: 'Player match stats',
  description:
    'One row per player per match: kicks, marks, disposals and the rest of the box score. '
    + 'The match itself must already exist -- upload match results first. Upserts by '
    + 'player + match, so re-uploading a corrected file updates rather than duplicates.',
  requiredColumns: ['season', 'round_code', 'home_club', 'away_club', 'player', 'club'],
  fileKey: (row) =>
    `${row.season}|${row.round_code}|${row.home_club}|${row.away_club}|${row.player}|${row.club}`,

  async validateRow(row, { sql }) {
    const season = await resolveSeason(sql, row.season);
    if (season === null) {
      return { verdict: 'error', reasons: [`season ${row.season ?? '(empty)'} does not exist`] };
    }
    const roundCode = (row.round_code ?? '').trim();
    if (!roundCode) return { verdict: 'error', reasons: ['round_code is empty'] };

    const home = await resolveClub(sql, row.home_club, season);
    if (!home) {
      return { verdict: 'error', reasons: [`home_club "${row.home_club}" is not a recognised club for ${season}`] };
    }
    const away = await resolveClub(sql, row.away_club, season);
    if (!away) {
      return { verdict: 'error', reasons: [`away_club "${row.away_club}" is not a recognised club for ${season}`] };
    }

    const match = await resolveMatch(sql, season, roundCode, home.id, away.id);
    if (match.status !== 'unique') {
      return {
        verdict: 'error',
        reasons: [match.status === 'unmatched'
          ? `no match found for ${season} round ${roundCode}, ${row.home_club} v ${row.away_club} `
            + '-- upload match results first'
          : `${match.count} matches fit ${season} round ${roundCode}, ${row.home_club} v ${row.away_club}`],
      };
    }

    const club = await resolveClub(sql, row.club, season);
    if (!club) {
      return { verdict: 'error', reasons: [`club "${row.club}" is not a recognised club for ${season}`] };
    }
    if (club.id !== home.id && club.id !== away.id) {
      return { verdict: 'error', reasons: [`club "${row.club}" did not play in this match`] };
    }

    // player_match_stats.player_id is NOT NULL -- unlike the award tables
    // above, there is no "unlinked" representation this table can hold,
    // so an unmatched or ambiguous player is an error here, not a warning.
    const player = await resolvePlayer(sql, row.player, season, club.id);
    if (player.status !== 'unique') {
      return {
        verdict: 'error',
        reasons: [player.status === 'unmatched'
          ? `player "${row.player}" not found for ${season}`
          : `player "${row.player}" is ambiguous (${player.count} candidates)`],
      };
    }

    const brownlowVotes = toIntOrNull(row.brownlow_votes);
    if (brownlowVotes !== null && (brownlowVotes < 0 || brownlowVotes > 3)) {
      return { verdict: 'error', reasons: [`brownlow_votes "${row.brownlow_votes}" must be 0-3`] };
    }

    const resolved: Record<string, number | string | null> = {
      match_id: match.matchId,
      player_id: player.playerId,
      club_id: club.id,
      career_game_no: toIntOrNull(row.career_game_no),
      // jumper_number is optional and pass-through text; coerced here
      // (not read from `row` directly in promoteRow) because an admin's
      // CSV is free to omit the column entirely, in which case `row.
      // jumper_number` is `undefined`, not `null` -- and postgres.js
      // refuses an undefined parameter outright rather than sending NULL.
      jumper_number: row.jumper_number ?? null,
      brownlow_votes: brownlowVotes,
    };
    for (const key of STAT_COLUMNS) resolved[key] = toIntOrNull(row[key]);

    return { verdict: 'ok', reasons: [], resolved };
  },

  async promoteRow(row, resolved, { sql, sourceId, batchId }) {
    const s = (key: (typeof STAT_COLUMNS)[number]) => resolved[key] ?? null;
    await sql`
      INSERT INTO player_match_stats
        (player_id, match_id, club_id, career_game_no, jumper_number,
         kicks, marks, handballs, disposals, goals, behinds, hitouts, tackles,
         rebounds, inside_50s, clearances, clangers, frees_for, frees_against,
         contested, uncontested, contested_marks, marks_inside_50, one_percenters,
         bounces, goal_assists, brownlow_votes, source_id, import_batch_id)
      VALUES
        (${resolved.player_id}, ${resolved.match_id}, ${resolved.club_id},
         ${resolved.career_game_no}, ${resolved.jumper_number},
         ${s('kicks')}, ${s('marks')}, ${s('handballs')}, ${s('disposals')}, ${s('goals')},
         ${s('behinds')}, ${s('hitouts')}, ${s('tackles')}, ${s('rebounds')}, ${s('inside_50s')},
         ${s('clearances')}, ${s('clangers')}, ${s('frees_for')}, ${s('frees_against')},
         ${s('contested')}, ${s('uncontested')}, ${s('contested_marks')}, ${s('marks_inside_50')},
         ${s('one_percenters')}, ${s('bounces')}, ${s('goal_assists')},
         ${resolved.brownlow_votes}, ${sourceId || null}, ${batchId})
      ON CONFLICT (player_id, match_id) DO UPDATE SET
         club_id          = EXCLUDED.club_id,
         career_game_no   = EXCLUDED.career_game_no,
         jumper_number    = EXCLUDED.jumper_number,
         kicks            = EXCLUDED.kicks,
         marks            = EXCLUDED.marks,
         handballs        = EXCLUDED.handballs,
         disposals        = EXCLUDED.disposals,
         goals            = EXCLUDED.goals,
         behinds          = EXCLUDED.behinds,
         hitouts          = EXCLUDED.hitouts,
         tackles          = EXCLUDED.tackles,
         rebounds         = EXCLUDED.rebounds,
         inside_50s       = EXCLUDED.inside_50s,
         clearances       = EXCLUDED.clearances,
         clangers         = EXCLUDED.clangers,
         frees_for        = EXCLUDED.frees_for,
         frees_against    = EXCLUDED.frees_against,
         contested        = EXCLUDED.contested,
         uncontested      = EXCLUDED.uncontested,
         contested_marks  = EXCLUDED.contested_marks,
         marks_inside_50  = EXCLUDED.marks_inside_50,
         one_percenters   = EXCLUDED.one_percenters,
         bounces          = EXCLUDED.bounces,
         goal_assists     = EXCLUDED.goal_assists,
         brownlow_votes   = EXCLUDED.brownlow_votes,
         import_batch_id  = EXCLUDED.import_batch_id
    `;
  },
};

// --- Player biography updates (dob, height, weight) ---
// Keyed by AFLDB player id, because these files are produced FROM the
// gap-audit worklists, which carry the id — no name matching, no
// ambiguity. Only the provided fields change; a blank cell leaves the
// current value alone rather than clearing it.
const playerBio: DatasetSpec = {
  key: 'player_bio',
  title: 'Player biography updates',
  description:
    'dob / height_cm / weight_kg keyed by AFLDB player_id. Blank cells leave the '
    + 'current value untouched; at least one of the three must be present per row. '
    + 'A dob set here is recorded as sourced.',
  requiredColumns: ['player_id'],
  fileKey: (row) => row.player_id ?? '',
  async validateRow(row, { sql }) {
    const reasons: string[] = [];
    const playerId = Number(row.player_id);
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return { verdict: 'error', reasons: ['player_id must be a positive integer'] };
    }
    const [player] = await sql<{ id: number; name: string }[]>`
      SELECT id, display_name AS name FROM players WHERE id = ${playerId}
    `;
    if (!player) return { verdict: 'error', reasons: [`no player with id ${playerId}`] };

    const dob = (row.dob ?? '').trim();
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      reasons.push('dob must be YYYY-MM-DD');
    }
    const height = (row.height_cm ?? '').trim();
    if (height && !(Number.isInteger(Number(height)) && Number(height) >= 120 && Number(height) <= 230)) {
      reasons.push('height_cm must be a whole number between 120 and 230');
    }
    const weight = (row.weight_kg ?? '').trim();
    if (weight && !(Number.isInteger(Number(weight)) && Number(weight) >= 40 && Number(weight) <= 160)) {
      reasons.push('weight_kg must be a whole number between 40 and 160');
    }
    if (!dob && !height && !weight) {
      reasons.push('row provides none of dob, height_cm, weight_kg');
    }
    if (reasons.length > 0) return { verdict: 'error', reasons };
    return {
      verdict: 'ok',
      reasons: [`updates ${player.name}`],
      resolved: { player_id: playerId },
    };
  },
  async promoteRow(row, resolved, { sql }) {
    const dob = (row.dob ?? '').trim() || null;
    const height = (row.height_cm ?? '').trim() || null;
    const weight = (row.weight_kg ?? '').trim() || null;
    // COALESCE keeps the current value wherever the file is silent, so a
    // partial file can never blank a figure it did not mention.
    await sql`
      UPDATE players
         SET dob = COALESCE(${dob}::date, dob),
             dob_confidence = CASE WHEN ${dob}::date IS NOT NULL
                                   THEN 'sourced'::value_confidence
                                   ELSE dob_confidence END,
             height_cm = COALESCE(${height}::smallint, height_cm),
             weight_kg = COALESCE(${weight}::smallint, weight_kg)
       WHERE id = ${resolved.player_id}
    `;
  },
};

// --- Match attendance updates ---
// Keyed by AFLDB match id (from the match URL or an exported worklist).
// Honours migration 020's contract: the figure and its status agree,
// and a genuine zero cites the manual-edit source.
const matchAttendance: DatasetSpec = {
  key: 'match_attendance',
  title: 'Match attendance updates',
  description:
    'attendance keyed by AFLDB match_id. A 0 is accepted as a confirmed zero-crowd '
    + 'figure and cited to the manual-edit source; use it only when a source supports it.',
  requiredColumns: ['match_id', 'attendance'],
  fileKey: (row) => row.match_id ?? '',
  async validateRow(row, { sql }) {
    const matchId = Number(row.match_id);
    if (!Number.isInteger(matchId) || matchId <= 0) {
      return { verdict: 'error', reasons: ['match_id must be a positive integer'] };
    }
    const [match] = await sql<{ id: number; label: string }[]>`
      SELECT m.id,
             hc.name || ' v ' || ac.name || ' · ' || m.season || ' ' || m.round_code AS label
        FROM matches m
        JOIN clubs hc ON hc.id = m.home_club_id
        JOIN clubs ac ON ac.id = m.away_club_id
       WHERE m.id = ${matchId}
    `;
    if (!match) return { verdict: 'error', reasons: [`no match with id ${matchId}`] };
    const attendance = Number((row.attendance ?? '').trim());
    if (!Number.isInteger(attendance) || attendance < 0 || attendance > 200000) {
      return { verdict: 'error', reasons: ['attendance must be a whole number from 0 to 200000'] };
    }
    return {
      verdict: 'ok',
      reasons: [`sets ${match.label} to ${attendance}`],
      resolved: { match_id: matchId, attendance },
    };
  },
  async promoteRow(_row, resolved, { sql }) {
    await sql`
      UPDATE matches
         SET attendance = ${resolved.attendance},
             attendance_status = 'complete'::coverage_status,
             attendance_source_id = (SELECT id FROM sources WHERE key = 'manual_admin_edit')
       WHERE id = ${resolved.match_id}
    `;
  },
};

export const DATASETS: Record<string, DatasetSpec> = {
  [risingStar.key]: risingStar,
  [allAustralian.key]: allAustralian,
  [matchResults.key]: matchResults,
  [playerMatchStats.key]: playerMatchStats,
  [playerBio.key]: playerBio,
  [matchAttendance.key]: matchAttendance,
};

/**
 * The spec for a dataset key, or null when there is none.
 *
 * `Object.hasOwn`, not `DATASETS[key]` plus a truthiness check: the dataset
 * key arrives from a request (an upload form field, an emailed subject line),
 * and a plain index also finds inherited properties -- "constructor" returns a
 * function, which is truthy, so the "unknown dataset" guard passes it through
 * and the next line reads .requiredColumns off Object's constructor. Same
 * discipline the search specs already apply to their own catalogue lookups
 * (isGridStatKey, isPlayerSort).
 */
export function getDataset(key: string): DatasetSpec | null {
  return Object.hasOwn(DATASETS, key) ? DATASETS[key] : null;
}
