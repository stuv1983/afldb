/**
 * QUARANTINED OFFLINE DIAGNOSTIC -- Squiggle / Kali current-season refresh CLI.
 *
 * Status: RETIRED from runtime by AFLDB V2 plan D10 / ADR 0010 (see docs/v2/legacy-disposition.md).
 * Squiggle and Kali are retired sources: AFLDB-ISSUE-122/128 already made them staging,
 * observation and diagnostic only, and V2 removes them from every runtime path.
 *
 * Rules for this file (enforced by tests/v2-module-boundaries.test.ts):
 *   - offline only: it is run by hand, deliberately, never by a scheduler;
 *   - no scheduler, systemd unit, deploy script or package.json script may reference legacy/;
 *   - nothing under src/, packages/ or the rest of tools/ may import it;
 *   - it is never wired to an admin button (the admin current-season controls are Stage 5's).
 *
 * Why it is kept: it is the only reader of the staged Squiggle/Kali observations
 * (staging.external_current_matches and its versions). The staged rows are diagnostic evidence
 * for ISSUE-122/128 and stay readable through `--report` until the owner retires the evidence.
 *
 * It cannot write canonical matches. `--update-matches` and `--insert-missing-matches` are
 * refused, and a refresh without an explicit `--source` is refused (AFLDB V2 finding F-001:
 * the old default silently selected the retired Squiggle source).
 *
 * Deliberate run (needs DATABASE_URL in .env; stages observations only):
 *   npx tsx legacy/offline/tools/current-season/update-current-season.ts --report --year 2026
 *   npx tsx legacy/offline/tools/current-season/update-current-season.ts --source squiggle --year 2026
 * `npm run current-season:update` now only prints the retirement notice (tools/v2/retired-entry.ts).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getCurrentSeasonReport,
  parseCurrentSeasonSources,
  runCurrentSeasonRefresh,
  validateCurrentSeasonYear,
  type CurrentSeasonRunOptions,
} from '../../../../src/lib/external-afl/current-season-import';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');

type Args = CurrentSeasonRunOptions & {
  report: boolean;
};

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

function valueFor(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function parseArgs(argv: string[]): Args {
  if (argv.includes('--update-matches')) {
    throw new Error(
      '--update-matches is deprecated by AFLDB-ISSUE-122: Squiggle/Kali refreshes are staging, observation, and diagnostic only and cannot write canonical matches.',
    );
  }
  if (argv.includes('--insert-missing-matches')) {
    throw new Error(
      '--insert-missing-matches is disabled: current API observations do not own the complete canonical match family.',
    );
  }
  const report = argv.includes('--report');
  const sourceValue = valueFor(argv, '--source');
  // F-001: no default source. Squiggle and Kali are retired, so a refresh must name its source.
  if (!report && (sourceValue === null || sourceValue.startsWith('--') || !sourceValue.trim())) {
    throw new Error(
      '--source is required for a refresh: name squiggle, kali or all explicitly. There is no default '
      + 'because Squiggle and Kali are retired sources; this is an offline diagnostic quarantined by '
      + 'AFLDB V2 plan D10 (see docs/v2/legacy-disposition.md). --report needs no --source.',
    );
  }
  // --report is read-only and never fetches, so it carries no sources.
  const sources = report ? [] : parseCurrentSeasonSources(sourceValue ?? '');
  const year = validateCurrentSeasonYear(Number(valueFor(argv, '--year') ?? new Date().getFullYear()));
  return {
    year,
    sources,
    apply: argv.includes('--apply'),
    insertMissingMatches: false,
    report,
  };
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.report) {
    const report = await getCurrentSeasonReport(args.year);
    if (report.rows.length === 0) {
      console.log(`No staged external current-match rows found for ${args.year}.`);
      return;
    }
    console.log(`Staged external current-match rows for ${args.year}:`);
    for (const row of report.rows) {
      console.log(`  ${row.source}: current observations ${row.staged}, observations resolving to canonical matches ${row.resolved}, complete observations ${row.complete}, observations with score fields ${row.withScores}, unresolved teams ${row.unresolvedTeams}`);
    }
    if (report.incompleteSamples.length > 0) {
      console.log('\nIncomplete fixture samples:');
      for (const sample of report.incompleteSamples) {
        console.log(`  ${sample.source} ${sample.externalGameId}: ${sample.matchDate ?? 'no date'} R${sample.round ?? '?'} ${sample.home ?? '?'} (${sample.homeClubId ?? 'unresolved'}) v ${sample.away ?? '?'} (${sample.awayClubId ?? 'unresolved'})`);
      }
    }
    if (report.unresolvedMatchSamples.length > 0) {
      console.log('\nUnresolved match samples:');
      for (const sample of report.unresolvedMatchSamples) {
        console.log(`  ${sample.source} ${sample.externalGameId}: ${sample.matchDate ?? 'no date'} R${sample.round ?? '?'} ${sample.home ?? '?'} (${sample.homeClubId ?? 'unresolved'}) v ${sample.away ?? '?'} (${sample.awayClubId ?? 'unresolved'})`);
      }
    }
    if (report.unresolvedTeamSamples.length > 0) {
      console.log('\nUnresolved team samples:');
      for (const sample of report.unresolvedTeamSamples) {
        console.log(`  ${sample.source} ${sample.externalGameId}: ${sample.matchDate ?? 'no date'} R${sample.round ?? '?'} ${sample.home ?? '?'} (${sample.homeClubId ?? 'unresolved'}) v ${sample.away ?? '?'} (${sample.awayClubId ?? 'unresolved'})`);
      }
    }
    return;
  }

  const result = await runCurrentSeasonRefresh(args);
  console.log(`Fetched ${result.observationsFetched} external match observations for ${args.year}.`);
  for (const source of args.sources) {
    console.log(`  ${source}: ${result.sourceCounts[source]}`);
  }
  for (const [group, count] of Object.entries(result.independenceGroupCounts).sort()) {
    console.log(`  independence group ${group}: ${count}`);
  }
  console.log(`  complete observations: ${result.completeObservations}`);
  console.log(`  observations with score fields: ${result.observationsWithScores}`);

  if (!args.apply) {
    console.log(`\nStaged observations ${result.observationsStaged}; resolved canonical matches ${result.canonicalMatchesResolved}; inserted canonical rows ${result.canonicalRowsInserted}; updated canonical rows ${result.canonicalRowsUpdated}; unresolved observations ${result.unresolvedObservations}; incomplete source records ${result.incompleteSourceRecords}; rejected/conflicted work ${result.rejectedOrConflicted}.`);
    console.log(`Source disagreements: ${result.sourceDisagreements}`);
    console.log(`Within-group source conflicts: ${result.sameGroupConflicts}`);
    console.log('\nDry run. Nothing was written. Re-run with --apply to stage snapshots.');
    console.log('Missing canonical matches remain unresolved until a complete, authorised match-family importer supplies them.');
    return;
  }

  console.log(`\nStaged observations ${result.observationsStaged} (${result.observationVersionsInserted} new versions); marked absent ${result.observationsMarkedAbsent}; resolved canonical matches ${result.canonicalMatchesResolved}; inserted canonical rows ${result.canonicalRowsInserted}; updated canonical rows ${result.canonicalRowsUpdated}; unresolved observations ${result.unresolvedObservations}; incomplete source records ${result.incompleteSourceRecords}; rejected/conflicted work ${result.rejectedOrConflicted}.`);
  console.log(`Source disagreements: ${result.sourceDisagreements}`);
  console.log(`Within-group source conflicts: ${result.sameGroupConflicts}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
