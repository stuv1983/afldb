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
  const sources = parseCurrentSeasonSources(valueFor(argv, '--source') ?? 'squiggle');
  const year = validateCurrentSeasonYear(Number(valueFor(argv, '--year') ?? new Date().getFullYear()));
  return {
    year,
    sources,
    apply: argv.includes('--apply'),
    insertMissingMatches: argv.includes('--insert-missing-matches'),
    report: argv.includes('--report'),
    updateMatches: argv.includes('--update-matches'),
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
      console.log(`  ${row.source}: staged ${row.staged}, resolved ${row.resolved}, complete ${row.complete}, with scores ${row.withScores}, unresolved teams ${row.unresolvedTeams}`);
    }
    if (report.unresolvedSamples.length > 0) {
      console.log('\nFirst unresolved samples:');
      for (const sample of report.unresolvedSamples) {
        console.log(`  ${sample.source} ${sample.externalGameId}: ${sample.matchDate ?? 'no date'} R${sample.round ?? '?'} ${sample.home ?? '?'} (${sample.homeClubId ?? 'unresolved'}) v ${sample.away ?? '?'} (${sample.awayClubId ?? 'unresolved'})`);
      }
    }
    return;
  }

  const result = await runCurrentSeasonRefresh(args);
  console.log(`Fetched ${result.fetched} external match rows for ${args.year}.`);
  for (const source of args.sources) {
    console.log(`  ${source}: ${result.sourceCounts[source]}`);
  }
  console.log(`  complete: ${result.complete}`);
  console.log(`  with scores: ${result.withScores}`);

  if (!args.apply) {
    console.log('\nDry run. Nothing was written. Re-run with --apply to stage snapshots.');
    console.log('Add --insert-missing-matches with --apply to insert completed matches missing from AFLDB.');
    console.log('Add --update-matches with --apply only to overwrite local final scores for unambiguously resolved completed matches.');
    return;
  }

  console.log(`\nStaged ${result.staged}; inserted matches ${result.inserted}; resolved ${result.resolved}; updated matches ${result.updated}; unresolved ${result.unresolved}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
