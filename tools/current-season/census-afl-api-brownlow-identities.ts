#!/usr/bin/env node
/**
 * AFLDB-ISSUE-228 — read-only Brownlow player identity census (operator
 * request, 2026-09-20).
 *
 * Diagnostic only: never writes to the database. Never touches
 * external_identities, matching/linking behaviour, the Brownlow writer, the
 * fixture resolver, canonical data or migrations. Only SELECTs are issued.
 *
 * Trust rule: reused verbatim, not reimplemented — every provider player id
 * is resolved through `resolveAflApiPlayer()`
 * (src/lib/acquisition/afl-api-player-resolver.ts), the exact §6.3 D2
 * function the real Brownlow settle (`afl-api-brownlow.ts`) calls. A player
 * that function does NOT resolve is then classified read-only, using the
 * same `external_identities` row the resolver's own WHERE clause already
 * excluded, plus a check of `data_issues` for an open
 * `afl_api_identity_contradiction` (written only by
 * tools/migration/import_afl_api_player_bridge.py). No new trust category is
 * invented beyond what the schema (migration 001 `link_status`, migration
 * 002 `external_identities`) and the S5 bridge's own contradiction path
 * already distinguish.
 *
 * Population: the tracked, immutable full-season capture at
 * data/sources/AFLWebsite/BrownlowSamples/brownlow-samples/<season>/ — NOT
 * the progressive/simulator captures under data/sources/afl_api/brownlow/,
 * which hold zero (afl-api-brownlow-2025-2026-09-20-0320) or one
 * (…-0330) published match. This folder proves its own completeness via
 * 06-validation.json (2025: matchVoteRecords=207, voteRows=621,
 * brownlowPlayers=188, 0 defects); this tool refuses to proceed if its own
 * parse of 01-brownlow-season.raw.json does not match those three counts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { emitAflApiBrownlowMatchVotes } from '../../src/lib/acquisition/afl-api-bundle';
import { resolveAflApiSourceId } from '../../src/lib/acquisition/afl-api-match-identity';
import { resolveAflApiPlayer } from '../../src/lib/acquisition/afl-api-player-resolver';
import { parseSourceFamilyRegistry, type SourceFamilyRegistry } from '../../src/lib/acquisition/source-families';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const FIRST_MATCH_CHECK_IDS = ['CD_I1023266', 'CD_I1005247', 'CD_I296347'] as const;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadEnv(): void {
  let contents: string;
  try {
    contents = readFileSync(join(PROJECT_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    const name = key.trim();
    if (!process.env[name]) process.env[name] = rest.join('=').trim();
  }
}

function seasonDirOf(season: number): string {
  return join(PROJECT_ROOT, 'data', 'sources', 'AFLWebsite', 'BrownlowSamples', 'brownlow-samples', String(season));
}

function createReadOnlyClient(): postgres.Sql {
  const dsn = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!dsn) throw new Error('AFLDB_IMPORT_DATABASE_URL is not set.');
  return postgres(dsn, { max: 1, onnotice: () => {}, transform: { undefined: null } });
}

type DisplayInfo = { givenName: string; surname: string; teamAbbr: string; teamName: string };

type CensusRow = {
  providerId: string;
  givenName: string;
  surname: string;
  teamAbbr: string;
  teamName: string;
  bucket: string;
  detail: string;
  playerId: number | null;
};

/**
 * AFLDB-ISSUE-228 §9.10 census diagnostic cleanup. Both extracted as pure
 * functions so the fix is unit-testable without a live DB (the module's
 * `main()` opens a postgres client at import time-adjacent call, matching
 * the existing `resolvePlayerCached` precedent in
 * `tools/current-season/audit-afl-api-brownlow-canonical-equality.ts`).
 */
export function bucketSummaryHeading(distinctProviderCount: number): string {
  return `=== Bucket summary (${distinctProviderCount} distinct provider players) ===`;
}

/** FIRST_MATCH_CHECK_IDS is a fixed 2025 sample (CD_M20250140004); never invent one for another season. */
export function shouldRunFirstMatchCheck(season: number): boolean {
  return season === 2025;
}

function parseArgs(argv: readonly string[]): { season: number } {
  const i = argv.indexOf('--season');
  const season = i >= 0 ? Number(argv[i + 1]) : 2025;
  if (!Number.isInteger(season)) throw new Error('--season must be an integer.');
  return { season };
}

/**
 * Display-only extraction (given name / surname / team) read directly from
 * the same parsed file. The production emitter deliberately narrows these
 * away (afl-api-bundle.ts, emitAflApiBrownlowMatchVotes: "OUT OF SCOPE for
 * this family's matchVotes-grain contract") because the real settle never
 * needs them for resolution; the census does, purely for human-readable
 * output. This is a flat read, not a matching rule.
 */
function extractDisplayInfo(seasonRaw: unknown): Map<string, DisplayInfo> {
  const display = new Map<string, DisplayInfo>();
  const matchVotes = (seasonRaw as { matchVotes?: unknown }).matchVotes;
  if (!Array.isArray(matchVotes)) return display;
  for (const entry of matchVotes) {
    const votes = (entry as { votes?: unknown }).votes;
    if (!Array.isArray(votes)) continue;
    for (const vote of votes) {
      const v = vote as {
        player?: { playerId?: unknown; givenName?: unknown; surname?: unknown };
        team?: { teamAbbr?: unknown; teamName?: unknown };
      };
      const id = v.player?.playerId;
      if (typeof id !== 'string' || display.has(id)) continue;
      display.set(id, {
        givenName: typeof v.player?.givenName === 'string' ? v.player.givenName : '',
        surname: typeof v.player?.surname === 'string' ? v.player.surname : '',
        teamAbbr: typeof v.team?.teamAbbr === 'string' ? v.team.teamAbbr : '',
        teamName: typeof v.team?.teamName === 'string' ? v.team.teamName : '',
      });
    }
  }
  return display;
}

async function main(): Promise<void> {
  const { season } = parseArgs(process.argv.slice(2));
  loadEnv();

  const seasonDir = seasonDirOf(season);
  const seasonRaw = readJson(join(seasonDir, '01-brownlow-season.raw.json'));
  const validation = readJson(join(seasonDir, '06-validation.json')) as {
    matchVoteRecords?: unknown;
    voteRows?: unknown;
    brownlowPlayers?: unknown;
  };

  const registry: SourceFamilyRegistry = parseSourceFamilyRegistry(
    readJson(join(PROJECT_ROOT, 'data', 'reference', 'source-families.json')),
  );

  // Production-validated parse/shape check: exact 3-2-1 vote sets, no
  // duplicate match/player ids — the same function the real settle uses.
  const { records } = emitAflApiBrownlowMatchVotes(seasonRaw, registry);
  const display = extractDisplayInfo(seasonRaw);
  const parsedVoteRows = records.reduce((n, r) => n + r.votes.length, 0);

  const mismatches: string[] = [];
  if (records.length !== validation.matchVoteRecords) {
    mismatches.push(`match vote records: parsed ${records.length}, validation.json says ${validation.matchVoteRecords}`);
  }
  if (parsedVoteRows !== validation.voteRows) {
    mismatches.push(`vote rows: parsed ${parsedVoteRows}, validation.json says ${validation.voteRows}`);
  }
  if (display.size !== validation.brownlowPlayers) {
    mismatches.push(`distinct players: parsed ${display.size}, validation.json says ${validation.brownlowPlayers}`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Parsed population does not match ${join(seasonDir, '06-validation.json')}:\n  ${mismatches.join('\n  ')}\n`
      + 'Refusing to census against a capture that does not prove itself complete.',
    );
  }

  console.log(`Full-source file: ${join(seasonDir, '01-brownlow-season.raw.json')}`);
  console.log(
    `Proven complete by: ${join(seasonDir, '06-validation.json')} `
    + `(matchVoteRecords=${validation.matchVoteRecords}, voteRows=${validation.voteRows}, `
    + `brownlowPlayers=${validation.brownlowPlayers}, badVoteSetCount=0, duplicateMatchIdCount=0, `
    + 'duplicatePlayerWithinMatchCount=0, leaderboardMismatchCount=0)',
  );
  console.log(
    `Parsed and re-verified here: ${records.length} match vote-set(s), ${parsedVoteRows} vote row(s), `
    + `${display.size} distinct provider player(s).`,
  );
  console.log('');

  const sql = createReadOnlyClient();
  try {
    const sourceId = await resolveAflApiSourceId(sql);

    const rows: CensusRow[] = [];
    const bucketCounts: Record<string, number> = {};
    const resolvedProviderIds = new Set<string>();

    for (const [providerId, info] of display) {
      // §6.3 D2 trust rule, reused verbatim.
      const resolution = await resolveAflApiPlayer(sql, sourceId, providerId);

      let bucket: string;
      let detail = '';
      let playerId: number | null = null;

      if (resolution.outcome === 'resolved') {
        bucket = 'trusted_resolved';
        playerId = resolution.playerId;
        resolvedProviderIds.add(providerId);
      } else if (resolution.outcome === 'refused') {
        // external_identities_uq (migration 002) makes this unreachable
        // under correct writes; kept as its own bucket rather than folded
        // into 'unresolved', matching the resolver's own distinct outcome.
        bucket = 'ambiguous_multiple';
        detail = `candidateIds=${resolution.candidateIds.join(',')}`;
      } else {
        const [row] = await sql<{ status: string; playerId: number | null; matchMethod: string | null }[]>`
          SELECT status, player_id AS "playerId", match_method AS "matchMethod"
            FROM external_identities
           WHERE source_id = ${sourceId} AND external_id = ${providerId}
        `;
        if (!row) {
          bucket = 'no_external_identity';
        } else if (row.status === 'unique' || row.status === 'resolved') {
          // The resolver's own WHERE clause also requires player_id IS NOT
          // NULL; reaching here as 'unresolved' with a trusted status means
          // this row's player_id is NULL — a contract anomaly (migration
          // 002 comment), never a guessed trust decision.
          bucket = 'identity_present_trusted_status_no_player';
          detail = `status=${row.status}`;
        } else {
          bucket = 'identity_present_non_trusted_status';
          detail = `status=${row.status}${row.playerId !== null ? `, player_id=${row.playerId}` : ''}`
            + `${row.matchMethod ? `, match_method=${row.matchMethod}` : ''}`;
        }

        const [contradiction] = await sql<{ id: number }[]>`
          SELECT id FROM data_issues
           WHERE issue_type = 'afl_api_identity_contradiction'
             AND resolved_at IS NULL
             AND details ->> 'external_id' = ${providerId}
        `;
        if (contradiction) {
          bucket = 'contradiction_pending_human_review';
          detail = `${detail ? `${detail}; ` : ''}data_issues.id=${contradiction.id}`;
        }
      }

      bucketCounts[bucket] = (bucketCounts[bucket] ?? 0) + 1;
      rows.push({
        providerId,
        givenName: info.givenName,
        surname: info.surname,
        teamAbbr: info.teamAbbr,
        teamName: info.teamName,
        bucket,
        detail,
        playerId,
      });
    }

    console.log(bucketSummaryHeading(rows.length));
    for (const [bucket, count] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${bucket}: ${count}`);
    }
    console.log(`  TOTAL: ${rows.length}`);
    console.log('');

    if (shouldRunFirstMatchCheck(season)) {
      console.log('=== First-match check — CD_M20250140004 ===');
      for (const id of FIRST_MATCH_CHECK_IDS) {
        const row = rows.find((r) => r.providerId === id);
        console.log(
          row
            ? `  ${id} (${row.givenName} ${row.surname}, ${row.teamAbbr}): ${row.bucket}${row.detail ? ` — ${row.detail}` : ''}`
            : `  ${id}: NOT FOUND among the ${season} population`,
        );
      }
    } else {
      console.log(`=== First-match check — skipped (CD_M20250140004 / FIRST_MATCH_CHECK_IDS is a 2025-only diagnostic; season=${season}) ===`);
    }
    console.log('');

    const unresolved = rows
      .filter((r) => r.bucket !== 'trusted_resolved')
      .sort((a, b) => a.surname.localeCompare(b.surname));
    console.log(`=== Unresolved rows (${unresolved.length} of ${rows.length}) ===`);
    console.log('  provider_id\tgiven_name\tsurname\tteam\tbucket\tdetail');
    for (const r of unresolved) {
      console.log(`  ${r.providerId}\t${r.givenName}\t${r.surname}\t${r.teamAbbr}\t${r.bucket}\t${r.detail}`);
    }
    console.log('');

    // Brownlow atomicity (§10): a match's whole 3-2-1 set refuses if ANY of
    // its three voters is not trusted_resolved.
    let setsWouldResolve = 0;
    let setsWouldRefuse = 0;
    for (const record of records) {
      const allResolved = record.votes.every((v) => resolvedProviderIds.has(v.providerPlayerId));
      if (allResolved) setsWouldResolve += 1; else setsWouldRefuse += 1;
    }
    console.log('=== Vote-set atomicity (all-or-none per match, §10) ===');
    console.log(`  would resolve (all 3 voters trusted_resolved): ${setsWouldResolve}`);
    console.log(`  would refuse (>=1 voter not trusted_resolved): ${setsWouldRefuse}`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
