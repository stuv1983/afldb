import 'server-only';

import type { Sql } from 'postgres';

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
   * the import role. Upserts by source record id, so re-promoting a
   * corrected file updates rather than duplicates.
   */
  promoteRow: (
    row: Record<string, string | null>,
    resolved: Record<string, number | string | null>,
    context: { sql: Sql; awardId: number; sourceId: number; batchId: number },
  ) => Promise<void>;
  /** The award this dataset feeds, resolved once per promotion. */
  awardSlug: string;
};

// ---------------------------------------------------------------------------
// Shared resolution helpers
// ---------------------------------------------------------------------------

function toIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

async function resolveSeason(sql: Sql, value: string | null): Promise<number | null> {
  const year = toIntOrNull(value);
  if (year === null) return null;
  const [row] = await sql<{ year: number }[]>`
    SELECT year FROM seasons WHERE year = ${year}
  `;
  return row?.year ?? null;
}

/** Club by any recorded alias, resolved to the identity of the season. */
async function resolveClub(
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
async function resolvePlayer(
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

// ---------------------------------------------------------------------------
// Dataset: Rising Star nominations
// ---------------------------------------------------------------------------

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
         ${row.ineligible_reason}, ${toIntOrNull(row.votes)},
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

// ---------------------------------------------------------------------------
// Dataset: All-Australian selections
// ---------------------------------------------------------------------------

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
         0, ${resolved.club_id}, ${row.club}, ${row.position},
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

export const DATASETS: Record<string, DatasetSpec> = {
  [risingStar.key]: risingStar,
  [allAustralian.key]: allAustralian,
};
