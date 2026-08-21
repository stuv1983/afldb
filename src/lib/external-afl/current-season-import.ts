import postgres from 'postgres';

import {
  fetchKaliCurrentMatches,
  fetchSquiggleCurrentMatches,
  type ExternalCurrentMatch,
  type ExternalSource,
} from './current-matches';

export type CurrentSeasonSourceArg = ExternalSource | 'all';

export type CurrentSeasonRunOptions = {
  year: number;
  sources: ExternalSource[];
  apply: boolean;
  insertMissingMatches: boolean;
  updateMatches: boolean;
};

export type CurrentSeasonRunResult = {
  fetched: number;
  sourceCounts: Record<ExternalSource, number>;
  complete: number;
  withScores: number;
  staged: number;
  inserted: number;
  resolved: number;
  updated: number;
  unresolved: number;
  incompleteFixtures: number;
  applied: boolean;
};

export type CurrentSeasonReportRow = {
  source: string;
  staged: number;
  resolved: number;
  complete: number;
  withScores: number;
  unresolvedTeams: number;
};

export type CurrentSeasonUnresolvedSample = {
  source: string;
  externalGameId: string;
  matchDate: string | null;
  round: number | null;
  home: string | null;
  away: string | null;
  homeClubId: number | null;
  awayClubId: number | null;
};

export type CurrentSeasonReport = {
  year: number;
  rows: CurrentSeasonReportRow[];
  incompleteSamples: CurrentSeasonUnresolvedSample[];
  unresolvedMatchSamples: CurrentSeasonUnresolvedSample[];
  unresolvedTeamSamples: CurrentSeasonUnresolvedSample[];
};

type Db = postgres.Sql | postgres.TransactionSql;

const EXTERNAL_CLUB_NAME_ALIASES = new Map<string, string>([
  ['brisbane', 'Brisbane Lions'],
]);

export function parseCurrentSeasonSources(value: string): ExternalSource[] {
  const sourceArg = value.trim() || 'kali';
  const sources = sourceArg === 'all'
    ? ['squiggle', 'kali'] as ExternalSource[]
    : sourceArg.split(',').map((s) => s.trim()).filter(Boolean) as ExternalSource[];
  for (const source of sources) {
    if (source !== 'squiggle' && source !== 'kali') {
      throw new Error(`Unknown source "${source}". Use squiggle, kali, or all.`);
    }
  }
  return [...new Set(sources)];
}

export function validateCurrentSeasonYear(value: number): number {
  if (!Number.isInteger(value) || value < 2000 || value > 2100) {
    throw new Error('Year must be a whole season year from 2000 to 2100.');
  }
  return value;
}

export async function fetchCurrentSeasonMatches(
  source: ExternalSource,
  year: number,
): Promise<ExternalCurrentMatch[]> {
  if (source === 'squiggle') return fetchSquiggleCurrentMatches(year);
  return fetchKaliCurrentMatches(year);
}

export async function runCurrentSeasonRefresh(options: CurrentSeasonRunOptions): Promise<CurrentSeasonRunResult> {
  validateCurrentSeasonYear(options.year);
  const bySource: ExternalCurrentMatch[][] = [];
  for (const source of options.sources) bySource.push(await fetchCurrentSeasonMatches(source, options.year));
  const matches = bySource.flat();
  const sourceCounts = {
    squiggle: matches.filter((m) => m.source === 'squiggle').length,
    kali: matches.filter((m) => m.source === 'kali').length,
  };
  const fetched = matches.length;
  const complete = matches.filter((m) => m.completePercent === 100).length;
  const withScores = matches.filter((m) => m.homeScore !== null && m.awayScore !== null).length;

  if (!options.apply || matches.length === 0) {
    if (matches.length === 0) {
      return {
        fetched,
        sourceCounts,
        complete,
        withScores,
        staged: 0,
        inserted: 0,
        resolved: 0,
        updated: 0,
        unresolved: 0,
        incompleteFixtures: 0,
        applied: false,
      };
    }

    const sql = createImportClient();
    try {
      let resolved = 0;
      let unresolved = 0;
      let incompleteFixtures = 0;
      for (const match of matches) {
        const homeClubId = await resolveClub(sql, match.homeTeamRaw, match.season);
        const awayClubId = await resolveClub(sql, match.awayTeamRaw, match.season);
        const localMatchId = await resolveLocalMatch(sql, match, homeClubId, awayClubId);
        if (localMatchId !== null) {
          resolved += 1;
        } else if (match.completePercent === 100 && match.matchDate !== null) {
          unresolved += 1;
        } else {
          incompleteFixtures += 1;
        }
      }
      return {
        fetched,
        sourceCounts,
        complete,
        withScores,
        staged: matches.length,
        inserted: 0,
        resolved,
        updated: 0,
        unresolved,
        incompleteFixtures,
        applied: false,
      };
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  const sql = createImportClient();
  try {
    const result = await writeMatches(
      sql,
      matches,
      options.updateMatches,
      options.insertMissingMatches,
    );
    return {
      fetched,
      sourceCounts,
      complete,
      withScores,
      staged: result.staged,
      inserted: result.inserted,
      resolved: result.resolved,
      updated: result.updated,
      unresolved: result.unresolved,
      incompleteFixtures: result.incompleteFixtures,
      applied: true,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function getCurrentSeasonReport(year: number): Promise<CurrentSeasonReport> {
  validateCurrentSeasonYear(year);
  const sql = createImportClient();
  try {
    return await reportStaging(sql, year);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function createImportClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

function sourceKey(source: ExternalSource): string {
  return source === 'squiggle' ? 'squiggle_api' : 'kali_afl_stats';
}

function roundCodes(match: ExternalCurrentMatch): string[] {
  if (match.roundNumber !== null) return [String(match.roundNumber)];
  const label = match.roundLabel?.trim().toUpperCase();
  if (!label) return [];
  if (['EF', 'QF', 'SF', 'PF', 'GF'].includes(label)) return [label];
  return [];
}

function localRoundCodes(match: ExternalCurrentMatch): string[] {
  const codes = roundCodes(match);
  if (match.roundNumber !== null && match.season >= 2024) {
    codes.push(String(match.roundNumber + 1));
  }
  return [...new Set(codes)];
}

function primaryLocalRoundCode(match: ExternalCurrentMatch): string | null {
  return localRoundCodes(match)[0] ?? null;
}

function localRoundNumber(match: ExternalCurrentMatch): number | null {
  const code = primaryLocalRoundCode(match);
  return code !== null && /^\d+$/.test(code) ? Number(code) : null;
}

function localRoundType(match: ExternalCurrentMatch): 'home_and_away' | 'elimination_final' | 'qualifying_final' | 'semi_final' | 'preliminary_final' | 'grand_final' | null {
  const code = primaryLocalRoundCode(match);
  if (code === null) return null;
  if (/^\d+$/.test(code)) return 'home_and_away';
  if (code === 'EF') return 'elimination_final';
  if (code === 'QF') return 'qualifying_final';
  if (code === 'SF') return 'semi_final';
  if (code === 'PF') return 'preliminary_final';
  if (code === 'GF') return 'grand_final';
  return null;
}

function resultFromScores(match: ExternalCurrentMatch): 'home_win' | 'away_win' | 'draw' | null {
  if (match.homeScore === null || match.awayScore === null) return null;
  if (match.homeScore === match.awayScore) return 'draw';
  return match.homeScore > match.awayScore ? 'home_win' : 'away_win';
}

function clubAliasKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function localClubNameCandidate(raw: string): string {
  const key = clubAliasKey(raw);
  if (key === 'not recorded' || key === 'tbd') return '';
  return EXTERNAL_CLUB_NAME_ALIASES.get(key) ?? raw;
}

async function resolveClub(sql: Db, raw: string | null, season: number): Promise<number | null> {
  if (!raw) return null;
  const candidateRaw = localClubNameCandidate(raw);
  const [row] = await sql<{ id: number }[]>`
    WITH candidate AS (
      SELECT c.id, c.organization_id
        FROM clubs c
       WHERE afldb_normalise_name(c.name) = afldb_normalise_name(${candidateRaw})
          OR afldb_normalise_name(c.slug) = afldb_normalise_name(${candidateRaw})
      UNION
      SELECT c.id, c.organization_id
        FROM club_aliases a JOIN clubs c ON c.id = a.club_id
       WHERE afldb_normalise_name(a.alias) = afldb_normalise_name(${candidateRaw})
    )
    SELECT c.id
      FROM candidate cand
      JOIN clubs c ON c.organization_id = cand.organization_id
     WHERE c.first_season <= ${season}
       AND (c.last_season IS NULL OR c.last_season >= ${season})
     ORDER BY c.first_season DESC NULLS LAST
     LIMIT 1
  `;
  return row?.id ?? null;
}

async function resolveLocalMatch(
  sql: Db,
  match: ExternalCurrentMatch,
  homeClubId: number | null,
  awayClubId: number | null,
): Promise<number | null> {
  if (homeClubId === null || awayClubId === null) return null;
  const codes = localRoundCodes(match);
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM matches
     WHERE season = ${match.season}
       AND (${match.matchDate}::date IS NULL OR match_date = ${match.matchDate}::date)
       AND (${codes.length === 0}::boolean OR round_code = ANY(${codes}))
       AND ((home_club_id = ${homeClubId} AND away_club_id = ${awayClubId})
         OR (home_club_id = ${awayClubId} AND away_club_id = ${homeClubId}))
  `;
  return rows.length === 1 ? rows[0].id : null;
}

async function clubName(sql: Db, clubId: number): Promise<string> {
  const [row] = await sql<{ name: string }[]>`SELECT name FROM clubs WHERE id = ${clubId}`;
  if (!row) throw new Error(`Club ${clubId} no longer exists.`);
  return row.name;
}

async function refreshSeasonMetadata(sql: Db, season: number): Promise<void> {
  await sql`
    UPDATE seasons s
       SET status = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM matches m
                WHERE m.season = s.year
                  AND m.round_type = 'grand_final'
                  AND m.result <> 'draw')
             THEN 'in_progress'::season_status
             ELSE 'complete'::season_status
           END,
           data_through_date = (SELECT max(match_date) FROM matches WHERE season = s.year),
           last_loaded_round = (
             SELECT m.round_code FROM matches m
              WHERE m.season = s.year
              ORDER BY m.match_date DESC, m.id DESC LIMIT 1),
           completed_at = CASE
             WHEN EXISTS (
               SELECT 1 FROM matches m
                WHERE m.season = s.year
                  AND m.round_type = 'grand_final'
                  AND m.result <> 'draw')
             THEN (SELECT max(match_date) FROM matches WHERE season = s.year)
             ELSE NULL
           END
     WHERE s.year = ${season}
  `;
}

async function writeMatches(sql: postgres.Sql, matches: ExternalCurrentMatch[], updateMatches: boolean, insertMissingMatches: boolean): Promise<{
  staged: number;
  inserted: number;
  resolved: number;
  updated: number;
  unresolved: number;
  incompleteFixtures: number;
}> {
  let staged = 0;
  let inserted = 0;
  let resolved = 0;
  let updated = 0;
  let unresolved = 0;
  let incompleteFixtures = 0;
  const touchedSeasons = new Set<number>();

  await sql.begin(async (tx) => {
    const sourceIds = new Map<ExternalSource, number>();
    for (const source of new Set(matches.map((m) => m.source))) {
      const [row] = await tx<{ id: number }[]>`
        SELECT id FROM sources WHERE key = ${sourceKey(source)}
      `;
      if (!row) throw new Error(`Source ${sourceKey(source)} is missing; run migrations.`);
      sourceIds.set(source, row.id);
    }

    const firstSourceId = sourceIds.get(matches[0].source);
    if (!firstSourceId) throw new Error(`No source id for ${matches[0].source}`);

    const [batch] = await tx<{ id: number }[]>`
      INSERT INTO import_batches (source_id, tool, target_table, records_read, notes)
      VALUES (${firstSourceId}, 'current-season external refresh',
              'staging.external_current_matches', ${matches.length},
              ${`sources=${[...new Set(matches.map((m) => m.source))].join(',')}`})
      RETURNING id
    `;

    for (const match of matches) {
      const sourceId = sourceIds.get(match.source);
      if (!sourceId) throw new Error(`No source id for ${match.source}`);

      const homeClubId = await resolveClub(tx, match.homeTeamRaw, match.season);
      const awayClubId = await resolveClub(tx, match.awayTeamRaw, match.season);
      const localMatchId = await resolveLocalMatch(tx, match, homeClubId, awayClubId);
      if (localMatchId !== null) {
        resolved += 1;
      } else if (match.completePercent === 100 && match.matchDate !== null) {
        unresolved += 1;
      } else {
        incompleteFixtures += 1;
      }

      await tx`
        INSERT INTO staging.external_current_matches (
          source_id, external_game_id, season, round_label, round_number,
          complete_percent, match_date, venue_raw, home_team_raw, away_team_raw,
          home_club_id, away_club_id, local_match_id,
          home_goals, home_behinds, home_score, away_goals, away_behinds, away_score,
          raw_payload
        ) VALUES (
          ${sourceId}, ${match.externalGameId}, ${match.season}, ${match.roundLabel},
          ${match.roundNumber}, ${match.completePercent}, ${match.matchDate},
          ${match.venueRaw}, ${match.homeTeamRaw}, ${match.awayTeamRaw},
          ${homeClubId}, ${awayClubId}, ${localMatchId},
          ${match.homeGoals}, ${match.homeBehinds}, ${match.homeScore},
          ${match.awayGoals}, ${match.awayBehinds}, ${match.awayScore},
          ${tx.json(match.rawPayload as never)}
        )
        ON CONFLICT (source_id, external_game_id) DO UPDATE SET
          season = EXCLUDED.season,
          round_label = EXCLUDED.round_label,
          round_number = EXCLUDED.round_number,
          complete_percent = EXCLUDED.complete_percent,
          match_date = EXCLUDED.match_date,
          venue_raw = EXCLUDED.venue_raw,
          home_team_raw = EXCLUDED.home_team_raw,
          away_team_raw = EXCLUDED.away_team_raw,
          home_club_id = EXCLUDED.home_club_id,
          away_club_id = EXCLUDED.away_club_id,
          local_match_id = EXCLUDED.local_match_id,
          home_goals = EXCLUDED.home_goals,
          home_behinds = EXCLUDED.home_behinds,
          home_score = EXCLUDED.home_score,
          away_goals = EXCLUDED.away_goals,
          away_behinds = EXCLUDED.away_behinds,
          away_score = EXCLUDED.away_score,
          raw_payload = EXCLUDED.raw_payload,
          last_seen_at = now()
      `;
      staged += 1;

      if (!updateMatches || localMatchId === null || match.completePercent !== 100) continue;
      const result = resultFromScores(match);
      if (result === null || match.homeScore === null || match.awayScore === null) continue;

      const [current] = await tx<{
        homeClubId: number;
        awayClubId: number;
        homeScore: number;
        awayScore: number;
      }[]>`
        SELECT home_club_id AS "homeClubId", away_club_id AS "awayClubId",
               home_score AS "homeScore", away_score AS "awayScore"
          FROM matches WHERE id = ${localMatchId}
      `;
      if (!current) continue;
      const localHomeScore = current.homeClubId === homeClubId ? match.homeScore : match.awayScore;
      const localAwayScore = current.homeClubId === homeClubId ? match.awayScore : match.homeScore;
      if (localHomeScore === null || localAwayScore === null) continue;

      await tx`
        UPDATE matches
           SET home_score = ${localHomeScore},
               away_score = ${localAwayScore},
               home_goals = ${current.homeClubId === homeClubId ? match.homeGoals : match.awayGoals},
               home_behinds = ${current.homeClubId === homeClubId ? match.homeBehinds : match.awayBehinds},
               away_goals = ${current.homeClubId === homeClubId ? match.awayGoals : match.homeGoals},
               away_behinds = ${current.homeClubId === homeClubId ? match.awayBehinds : match.homeBehinds},
               result = CASE
                 WHEN ${localHomeScore} = ${localAwayScore} THEN 'draw'::match_result
                 WHEN ${localHomeScore} > ${localAwayScore} THEN 'home_win'::match_result
                 ELSE 'away_win'::match_result
               END,
               winner_club_id = CASE
                 WHEN ${localHomeScore} = ${localAwayScore} THEN NULL
                 WHEN ${localHomeScore} > ${localAwayScore} THEN home_club_id
                 ELSE away_club_id
               END,
               margin = abs(${localHomeScore} - ${localAwayScore}),
               source_id = ${sourceId},
               source_record_id = ${match.externalGameId},
               import_batch_id = ${batch.id}
         WHERE id = ${localMatchId}
      `;
      updated += 1;
      touchedSeasons.add(match.season);
    }

    if (insertMissingMatches) {
      for (const match of matches) {
        if (match.completePercent !== 100 || match.matchDate === null) continue;
        const sourceId = sourceIds.get(match.source);
        if (!sourceId) throw new Error(`No source id for ${match.source}`);
        const homeClubId = await resolveClub(tx, match.homeTeamRaw, match.season);
        const awayClubId = await resolveClub(tx, match.awayTeamRaw, match.season);
        if (homeClubId === null || awayClubId === null) continue;
        const existing = await resolveLocalMatch(tx, match, homeClubId, awayClubId);
        if (existing !== null) continue;

        const result = resultFromScores(match);
        const roundCode = primaryLocalRoundCode(match);
        const roundType = localRoundType(match);
        if (result === null || roundCode === null || roundType === null
          || match.homeScore === null || match.awayScore === null) {
          continue;
        }
        const homeName = await clubName(tx, homeClubId);
        const awayName = await clubName(tx, awayClubId);
        const matchKey = `${match.season}|${roundCode}|${match.matchDate}|${homeName}|${awayName}`;
        const winnerClubId = result === 'draw' ? null : result === 'home_win' ? homeClubId : awayClubId;
        const [insertedRow] = await tx<{ id: number }[]>`
          INSERT INTO matches (
            match_key, season, round_code, round_number, round_type, is_final,
            match_date, venue_raw, home_club_id, away_club_id,
            home_goals, home_behinds, home_score,
            away_goals, away_behinds, away_score,
            result, winner_club_id, margin,
            attendance, attendance_status, attendance_source_id,
            source_id, source_record_id, import_batch_id
          ) VALUES (
            ${matchKey}, ${match.season}, ${roundCode}, ${localRoundNumber(match)},
            ${roundType}::round_type, ${roundType !== 'home_and_away'},
            ${match.matchDate}, ${match.venueRaw ?? 'Unknown'},
            ${homeClubId}, ${awayClubId},
            ${match.homeGoals}, ${match.homeBehinds}, ${match.homeScore},
            ${match.awayGoals}, ${match.awayBehinds}, ${match.awayScore},
            ${result}::match_result, ${winnerClubId}, ${Math.abs(match.homeScore - match.awayScore)},
            NULL, 'not_collected'::coverage_status, NULL,
            ${sourceId}, ${match.externalGameId}, ${batch.id}
          )
          ON CONFLICT (match_key) DO NOTHING
          RETURNING id
        `;
        if (insertedRow) {
          inserted += 1;
          unresolved -= 1;
          touchedSeasons.add(match.season);
          await tx`
            UPDATE staging.external_current_matches
               SET local_match_id = ${insertedRow.id}
             WHERE source_id = ${sourceId}
               AND external_game_id = ${match.externalGameId}
          `;
        }
      }
    }

    for (const season of touchedSeasons) {
      await refreshSeasonMetadata(tx, season);
    }

    await tx`
      UPDATE import_batches
         SET completed_at = now(), status = 'completed',
             records_inserted = ${staged + inserted}, records_updated = ${updated},
             records_rejected = ${unresolved},
             validation_result = ${tx.json({ staged, inserted, resolved, updated, unresolved, incompleteFixtures } as never)}
       WHERE id = ${batch.id}
    `;
  });

  return { staged, inserted, resolved, updated, unresolved, incompleteFixtures };
}

async function reportStaging(sql: postgres.Sql, year: number): Promise<CurrentSeasonReport> {
  const rows = await sql<CurrentSeasonReportRow[]>`
    SELECT s.key AS source,
           count(*)::int AS staged,
           count(*) FILTER (WHERE e.local_match_id IS NOT NULL)::int AS resolved,
           count(*) FILTER (WHERE e.complete_percent = 100)::int AS complete,
           count(*) FILTER (WHERE e.home_score IS NOT NULL AND e.away_score IS NOT NULL)::int AS "withScores",
           count(*) FILTER (WHERE (e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))::int AS "unresolvedTeams"
      FROM staging.external_current_matches e
      JOIN sources s ON s.id = e.source_id
     WHERE e.season = ${year}
     GROUP BY s.key
     ORDER BY s.key
  `;

  const incompleteSamples = await sql<CurrentSeasonUnresolvedSample[]>`
    SELECT s.key AS source,
           e.external_game_id AS "externalGameId",
           e.match_date::text AS "matchDate",
           e.round_number AS round,
           e.home_team_raw AS home,
           e.away_team_raw AS away,
           e.home_club_id AS "homeClubId",
           e.away_club_id AS "awayClubId"
      FROM staging.external_current_matches e
      JOIN sources s ON s.id = e.source_id
     WHERE e.season = ${year} AND e.local_match_id IS NULL
       AND (e.complete_percent IS NULL OR e.complete_percent < 100 OR e.match_date IS NULL)
       AND NOT ((e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))
     ORDER BY s.key, e.match_date NULLS LAST, e.external_game_id
     LIMIT 10
  `;

  const unresolvedMatchSamples = await sql<CurrentSeasonUnresolvedSample[]>`
    SELECT s.key AS source,
           e.external_game_id AS "externalGameId",
           e.match_date::text AS "matchDate",
           e.round_number AS round,
           e.home_team_raw AS home,
           e.away_team_raw AS away,
           e.home_club_id AS "homeClubId",
           e.away_club_id AS "awayClubId"
      FROM staging.external_current_matches e
      JOIN sources s ON s.id = e.source_id
     WHERE e.season = ${year} AND e.local_match_id IS NULL
       AND e.complete_percent = 100 AND e.match_date IS NOT NULL
       AND NOT ((e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))
     ORDER BY s.key, e.match_date NULLS LAST, e.external_game_id
     LIMIT 10
  `;

  const unresolvedTeamSamples = await sql<CurrentSeasonUnresolvedSample[]>`
    SELECT s.key AS source,
           e.external_game_id AS "externalGameId",
           e.match_date::text AS "matchDate",
           e.round_number AS round,
           e.home_team_raw AS home,
           e.away_team_raw AS away,
           e.home_club_id AS "homeClubId",
           e.away_club_id AS "awayClubId"
      FROM staging.external_current_matches e
      JOIN sources s ON s.id = e.source_id
     WHERE e.season = ${year} AND e.local_match_id IS NULL
       AND ((e.home_club_id IS NULL AND lower(e.home_team_raw) NOT IN ('not recorded', 'tbd', '')) OR (e.away_club_id IS NULL AND lower(e.away_team_raw) NOT IN ('not recorded', 'tbd', '')))
     ORDER BY s.key, e.match_date NULLS LAST, e.external_game_id
     LIMIT 10
  `;

  return { year, rows, incompleteSamples, unresolvedMatchSamples, unresolvedTeamSamples };
}
