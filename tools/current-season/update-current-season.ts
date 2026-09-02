import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getCurrentSeasonReport,
  parseCurrentSeasonSources,
  runCurrentSeasonRefresh,
  validateCurrentSeasonYear,
  type CurrentSeasonRunOptions,
} from '../../src/lib/external-afl/current-season-import';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

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
  const sources = parseCurrentSeasonSources(valueFor(argv, '--source') ?? 'squiggle');
  const year = validateCurrentSeasonYear(Number(valueFor(argv, '--year') ?? new Date().getFullYear()));
  return {
    year,
    sources,
    apply: argv.includes('--apply'),
    insertMissingMatches: false,
    report: argv.includes('--report'),
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
