import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import {
  fetchKaliCurrentMatches,
  fetchSquiggleCurrentMatches,
  type ExternalCurrentMatch,
  type ExternalSource,
} from '../../src/lib/external-afl/current-matches';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

type Args = {
  year: number;
  sources: ExternalSource[];
  apply: boolean;
  updateMatches: boolean;
};

type Db = postgres.Sql | postgres.TransactionSql;

function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

function parseArgs(argv: string[]): Args {
  const sourceArg = valueFor(argv, '--source') ?? 'squiggle';
  const sources = sourceArg === 'all'
    ? ['squiggle', 'kali'] as ExternalSource[]
    : sourceArg.split(',').map((s) => s.trim()).filter(Boolean) as ExternalSource[];
  for (const source of sources) {
    if (source !== 'squiggle' && source !== 'kali') {
      throw new Error(`Unknown --source "${source}". Use squiggle, kali, or all.`);
    }
  }
  const year = Number(valueFor(argv, '--year') ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('--year must be a whole season year from 2000 to 2100.');
  }
  return {
    year,
    sources,
    apply: argv.includes('--apply'),
    updateMatches: argv.includes('--update-matches'),
  };
}

function valueFor(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

async function fetchSource(source: ExternalSource, year: number): Promise<ExternalCurrentMatch[]> {
  if (source === 'squiggle') return fetchSquiggleCurrentMatches(year);
  return fetchKaliCurrentMatches(year);
}

function sourceKey(source: ExternalSource): string {
  return source === 'squiggle' ? 'squiggle_api' : 'kali_afl_stats';
}

function roundCode(match: ExternalCurrentMatch): string | null {
  if (match.roundNumber !== null) return String(match.roundNumber);
  const label = match.roundLabel?.trim().toUpperCase();
  if (!label) return null;
  if (['EF', 'QF', 'SF', 'PF', 'GF'].includes(label)) return label;
  return null;
}

function resultFromScores(match: ExternalCurrentMatch): 'home_win' | 'away_win' | 'draw' | null {
  if (match.homeScore === null || match.awayScore === null) return null;
  if (match.homeScore === match.awayScore) return 'draw';
  return match.homeScore > match.awayScore ? 'home_win' : 'away_win';
}

async function resolveClub(sql: Db, raw: string | null, season: number): Promise<number | null> {
  if (!raw) return null;
  const [row] = await sql<{ id: number }[]>`
    WITH candidate AS (
      SELECT c.id, c.organization_id
        FROM clubs c
       WHERE afldb_normalise_name(c.name) = afldb_normalise_name(${raw})
          OR afldb_normalise_name(c.slug) = afldb_normalise_name(${raw})
      UNION
      SELECT c.id, c.organization_id
        FROM club_aliases a JOIN clubs c ON c.id = a.club_id
       WHERE afldb_normalise_name(a.alias) = afldb_normalise_name(${raw})
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
  const code = roundCode(match);
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM matches
     WHERE season = ${match.season}
       AND (${match.matchDate}::date IS NULL OR match_date = ${match.matchDate}::date)
       AND (${code}::text IS NULL OR round_code = ${code})
       AND ((home_club_id = ${homeClubId} AND away_club_id = ${awayClubId})
         OR (home_club_id = ${awayClubId} AND away_club_id = ${homeClubId}))
  `;
  return rows.length === 1 ? rows[0].id : null;
}

async function writeMatches(sql: postgres.Sql, matches: ExternalCurrentMatch[], updateMatches: boolean): Promise<{
  staged: number;
  resolved: number;
  updated: number;
  rejected: number;
}> {
  let staged = 0;
  let resolved = 0;
  let updated = 0;
  let rejected = 0;

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
      VALUES (${firstSourceId}, 'tools/current-season/update-current-season.ts',
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
      if (localMatchId !== null) resolved += 1;

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
    }

    rejected = matches.length - resolved;
    await tx`
      UPDATE import_batches
         SET completed_at = now(), status = 'completed',
             records_inserted = ${staged}, records_updated = ${updated},
             records_rejected = ${rejected},
             validation_result = ${tx.json({ staged, resolved, updated, rejected } as never)}
       WHERE id = ${batch.id}
    `;
  });

  return { staged, resolved, updated, rejected };
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const bySource: ExternalCurrentMatch[][] = [];
  for (const source of args.sources) bySource.push(await fetchSource(source, args.year));
  const matches = bySource.flat();

  console.log(`Fetched ${matches.length} external match rows for ${args.year}.`);
  for (const source of args.sources) {
    console.log(`  ${source}: ${matches.filter((m) => m.source === source).length}`);
  }
  console.log(`  complete: ${matches.filter((m) => m.completePercent === 100).length}`);
  console.log(`  with scores: ${matches.filter((m) => m.homeScore !== null && m.awayScore !== null).length}`);

  if (!args.apply) {
    console.log('\nDry run. Nothing was written. Re-run with --apply to stage snapshots.');
    console.log('Add --update-matches with --apply to update local final scores for unambiguously resolved completed matches.');
    return;
  }
  if (matches.length === 0) return;

  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  const sql = postgres(dsn, { max: 1, onnotice: () => {} });
  try {
    const result = await writeMatches(sql, matches, args.updateMatches);
    console.log(`\nStaged ${result.staged}; resolved ${result.resolved}; updated matches ${result.updated}; unresolved ${result.rejected}.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
